# Calls (LiveKit) and transcription

Audio and video calls run on LiveKit, and the transcription agent joins them to transcribe.
LiveKit runs on virtual machines, not in the cluster.

- [Why virtual machines](#why-virtual-machines)
- [What gets deployed](#what-gets-deployed)
- [Turn it on](#turn-it-on)
- [Transcription](#transcription)
- [TURN over TLS](#turn-over-tls)
- [How the pieces talk](#how-the-pieces-talk)
- [Check it works](#check-it-works)
- [Changing the configuration or the keys](#changing-the-configuration-or-the-keys)

## Why virtual machines

WebRTC media needs a routable public IP per media server and a wide UDP port range (50000 to
60000 by default) plus TURN on UDP 3478. A Kubernetes `LoadBalancer` Service cannot give a pod its
own public address or expose ten thousand UDP ports well on any of the three clouds, so `01-infra`
builds the LiveKit tier out of autoscaling VM groups instead.

## What gets deployed

| Piece | GCP | AWS | Azure |
|---|---|---|---|
| media servers, public IP each, 1 to 3 on 60% CPU | managed instance group `xyne-livekit-server` | Auto Scaling group `xyne-livekit-server` | VM scale set `xyne-livekit-server` |
| egress workers (recordings), private | `xyne-livekit-egress` | `xyne-livekit-egress` | `xyne-livekit-egress` |
| signalling at `wss://livekit.<domain>` | global HTTPS load balancer, Google-managed certificate | ALB with an ACM certificate | Application Gateway with a Key Vault certificate |
| TURN over TLS at `turn.<domain>:5349`, optional | TCP proxy | NLB, TCP pass-through | Application Gateway listener |
| configuration | Secret Manager | Secrets Manager | Key Vault |

Each VM runs Ubuntu 24.04. At boot, cloud-init installs Docker and the cloud CLI, fetches the
rendered LiveKit configuration from the secret store, and runs `livekit/livekit-server` (or
`livekit/egress`) under systemd. The configuration is rendered once, in
`terraform/modules/livekit-config`, for all three clouds: the API key, the Redis the servers share
room state through, the RTC ports, TURN, room defaults (auto-create, 120-second empty timeout,
100 participants) and the webhook to the backend.

## Turn it on

LiveKit shares room state through the install's Redis, which must therefore be reachable from the
VMs: `redis_mode` must be `managed` or `external`.

`01-infra.tfvars`:

```hcl
livekit_enabled = true
```

`deployment/scripts/secrets.sh --env prod` then appends `livekit_api_key` and
`livekit_api_secret` to `01-infra.secrets.tfvars` (it only adds what is missing). The signalling
certificate: automatic on GCP, automatic on AWS with `dns_zone` (otherwise
`livekit_certificate_arn`), and prepared in Key Vault on Azure
([install/azure.md](../install/azure.md#certificates)).

`02-platform.tfvars`, for transcription:

```hcl
apps = {
  xyne-transcription-agent = { enabled = true }
}
```

Run `deployment/scripts/setup.sh --env prod` (both stages: the VMs are `01-infra`, the keys reach
the backend and the agent through `02-platform`).

## Transcription

The transcription agent (`xyne-transcription-agent`) joins calls through LiveKit and sends audio
to a speech-to-text provider, which needs its key; without one, calls work but produce no
transcript. Three variables pick the provider, and normally all three name the same one:
`STT_MODEL` for live calls, `STT_PROVIDER` for recorded audio, and `VOICE_INPUT_STT_MODEL` for
voice input in the app. All default to `azure`, except voice input, which defaults to `google`.

```hcl
extra_secret_data = {
  xyne-transcription-agent-secrets = {
    AZURE_OPENAI_STT_API_KEY = "…"
  }
}

apps = {
  xyne-transcription-agent = {
    enabled = true
    values  = <<-YAML
      env:
        STT_MODEL: azure
        STT_PROVIDER: azure
        VOICE_INPUT_STT_MODEL: azure
        AZURE_OPENAI_STT_ENDPOINT: https://<resource>.openai.azure.com
    YAML
  }
}
```

| Provider | Value of the three variables | Key in `xyne-transcription-agent-secrets` | Other settings |
|---|---|---|---|
| Azure OpenAI | `azure` | `AZURE_OPENAI_STT_API_KEY` | `AZURE_OPENAI_STT_ENDPOINT`, `AZURE_OPENAI_STT_MODEL` (`gpt-4o-transcribe`) |
| Google Speech-to-Text | `google` | `GOOGLE_VOICE_CREDENTIALS_JSON` (a service-account key) | `GOOGLE_STT_MODEL` (`chirp_3`), `GOOGLE_STT_LANGUAGE` |
| Deepgram | `deepgram` | `DEEPGRAM_API_KEY` | |

Put keys in the secrets file (`02-platform.secrets.tfvars`), not in `02-platform.tfvars`.

## TURN over TLS

Clients behind corporate firewalls often cannot use UDP. TURN over TLS on port 5349 lets them
relay over TCP. It is optional and needs a certificate for `turn.<domain>`, stored as one PEM
bundle (the full chain, then the private key) in the cloud's secret store:

| Cloud | Store the bundle | Then set |
|---|---|---|
| GCP | `gcloud secrets create xyne-livekit-turn-cert --data-file=turn-bundle.pem --replication-policy=automatic` | `livekit_turn_cert_secret = "xyne-livekit-turn-cert"` |
| AWS | `aws secretsmanager create-secret --name xyne/livekit/turn-cert --secret-string file://turn-bundle.pem` | `livekit_turn_cert_secret = "xyne/livekit/turn-cert"` |
| Azure | `az keyvault secret set --vault-name <livekit vault> --name livekit-turn-cert --file turn-bundle.pem` | `livekit_turn_cert_secret = "livekit-turn-cert"` |

## How the pieces talk

| From | To | Why |
|---|---|---|
| browser | `wss://livekit.<domain>` | signalling |
| browser | a server VM's public IP, UDP 50000 to 60000 (or TCP 7881, or TURN) | media |
| backend | `https://livekit.<domain>` with `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | create rooms, issue join tokens |
| LiveKit servers | `https://<domain>/api/livekit/webhook` | room and participant events (a call starting and ending), signed with the API key |
| transcription agent | LiveKit, then the STT provider | transcripts |
| LiveKit servers | the install's Redis | shared room state |

The keys reach the cluster in `xyne-backend-secrets` and `xyne-transcription-agent-secrets`.

## Check it works

The signalling endpoint answers `OK`, and a room created from the backend produces a webhook the
backend accepts:

```bash
curl -s https://livekit.xyne.example.com/                     # OK

kubectl -n xyne-apps exec deploy/xyne-backend -c xyne-backend -- sh -c 'cd /repo/apps/backend && node -e "
const {RoomServiceClient}=require(\"livekit-server-sdk\");
const c=new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^wss/,\"https\"),process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
c.createRoom({name:\"check\",emptyTimeout:30}).then(()=>c.deleteRoom(\"check\")).then(()=>console.log(\"room ok\"));"'

kubectl -n xyne-apps logs deploy/xyne-backend -c xyne-backend --since=2m | grep 'LiveKit Webhook'
```

Expected: `room ok`, then `webhook_parsed` with `event: room_finished`. `Call not found: check` is
normal for a room the app did not create.

On a server VM (SSM on AWS, IAP on GCP, Azure Bastion): `sudo systemctl status livekit` and
`sudo journalctl -u livekit -n 100`.

## Changing the configuration or the keys

The VMs read their configuration only at boot, so a change to the keys, the Redis settings or the
webhook needs the VMs replaced or restarted:

- **AWS** does it for you. Each launch template carries a hash of the rendered configuration, so a
  change creates a new template version; the Auto Scaling groups follow the latest version and an
  instance refresh replaces one VM at a time while keeping one healthy.
- **GCP and Azure** need a restart after `01-infra` applies:
  `gcloud compute instance-groups managed rolling-action restart xyne-livekit-server --region <region>`
  or `az vmss restart --resource-group xyne --name xyne-livekit-server`, and the same for
  `xyne-livekit-egress`.

A key change also rewrites the two Kubernetes Secrets, and Argo CD restarts the backend and the
agent on its own ([secrets](../reference/secrets.md#rotation)).
