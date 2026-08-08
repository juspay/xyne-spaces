# Local Sandbox Router Debugging

Use this runbook when an SDLC repository baseline cannot create or reach its Kata sandbox from local development.

## Known failure signature

The affected SDLC run showed this sequence:

1. `sandbox-repo-setup` timed out connecting to the Kubernetes API.
2. A retry reached sandbox provisioning but failed runtime-grant redemption because the `xyne-claw` process did not have `SPACES_BACKEND_URL` or `XYNE_SPACES_URL`.
3. `sandbox-create` returned a reused session.
4. `sandbox-run` returned `Error: fetch failed` before producing command stdout or stderr.
5. Web search was unavailable because `BRAVE_SEARCH_API_KEY` was not configured.
6. The agent persisted an unfinished baseline draft and submitted `created: false`.
7. Claw marked its run `completed`, but the Spaces backend correctly marked setup `FAILURE` because the canvas remained `generationStatus: GENERATING`.

Important distinction: a fast `sandbox-run` result of `Error: fetch failed` can mean the local process could not reach the sandbox router. It does not prove that `git clone` ran inside the sandbox or that GitHub was unreachable.

## Local router recovery

S1. Check whether the expected port is listening.

```bash
lsof -nP -iTCP:18080 -sTCP:LISTEN
```

Expected: a `kubectl` process listens on `127.0.0.1:18080` and `[::1]:18080`. No output means the port-forward is absent.

S2. Confirm the active Kubernetes context.

```bash
kubectl config current-context
```

Expected: the sandbox GKE context, currently `gke_xyne-spaces-sbx_asia-south1_gke-xyne-spaces-sandbox-01`.

S3. Confirm the router service exists.

```bash
kubectl get svc -n xyne-apps sandbox-router-svc
```

Expected: `sandbox-router-svc` exposes port `8080/TCP`.

S4. Start the local port-forward and keep this terminal open.

```bash
kubectl -n xyne-apps port-forward svc/sandbox-router-svc 18080:8080
```

Expected:

```text
Forwarding from 127.0.0.1:18080 -> 8080
Forwarding from [::1]:18080 -> 8080
```

S5. From another terminal, probe the router.

```bash
curl -i --max-time 5 http://127.0.0.1:18080/
```

Expected: an HTTP response such as `400` with `X-Sandbox-ID header is required`. That response is healthy for this probe: it proves the local listener reached the router service.

S6. Retry the failed SDLC setup from the hub.

Expected: repository setup reaches the sandbox instead of returning an immediate `fetch failed` transport error.

## Separate PAT runtime configuration

Router recovery does not fix runtime-grant redemption. Authenticated clone setup executes inside the `xyne-claw` process and reads:

- `XYNE_CLAW_S2S_KEY`
- `SPACES_BACKEND_URL` or `XYNE_SPACES_URL`

For local development, ensure both are configured for `apps/xyne-claw`. Restart `xyne-claw` after changing its environment. Never write secret values into this document or commit local `.env` files.

The PAT changes introduced the Spaces backend URL dependency in the sandbox tool path. The current `apps/xyne-claw/.env.example` does not document that URL, so its absence does not imply somebody removed an existing setting.

## Canvas state interpretation

A visible canvas does not mean baseline generation succeeded:

- `generationStatus: GENERATING` means resumable draft.
- `generationStatus: READY` means finalized baseline.
- Missing sections render as `Pending repository inspection`, so a draft can visually contain the full document outline while only one section is persisted.

If Claw reports `completed` but the current baseline is not `READY`, the backend raises `Claw completed without creating <BASELINE_KIND>` and preserves the draft for retry.

## Follow-up engineering gaps

- Add the Spaces backend URL to the `xyne-claw` environment example and local setup flow.
- Add startup validation when SDLC runtime-grant tools are enabled.
- Do not accept baseline `submit-result` unless the baseline was finalized.
- Distinguish a blocked/partial result from a successful Claw completion.
- Add a regression test covering partial canvas creation followed by `created: false`.
