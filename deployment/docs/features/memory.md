# Long-term memory (Hindsight)

Hindsight gives claw memory across sessions: after a session it extracts facts with an LLM, and
at the start of the next one claw recalls what is relevant. Without it, claw remembers nothing
between sessions.

## Two ways to get it

| Option | Set | claw uses |
|---|---|---|
| deploy it in the cluster | `enable_hindsight = true` | `http://hindsight-api.hindsight:8888` |
| use one you already run | `hindsight = { url = "https://hindsight.example.com", tenant = "default" }` | that URL; it wins over the deployed one |

With neither, memory is off.

## Deploy it

`enable_hindsight = true` in `02-platform.tfvars` installs the upstream `vectorize-io/hindsight`
chart (v0.10.1) in its own `hindsight` namespace. It brings its own pgvector Postgres, separate
from the install's database.

Hindsight needs an LLM to extract facts, and `hindsight-api` exits at start without a key. In
`02-platform.secrets.tfvars`, inside `app_secrets`:

```hcl
hindsight_llm_api_key = "…"
```

and the provider, model and endpoint in `02-platform.tfvars`:

```hcl
addon_values = {
  hindsight = <<-YAML
    api:
      env:
        HINDSIGHT_API_LLM_PROVIDER: openai
        HINDSIGHT_API_LLM_MODEL: gpt-4.1-mini
        HINDSIGHT_API_LLM_BASE_URL: https://llm-gateway.example.com/v1
  YAML
}
```

Any OpenAI-compatible gateway works with provider `openai`. `02-platform` writes the key to
`hindsight-secrets` in the `hindsight` namespace, and the doctor fails while it is missing.

| Optional | Where |
|---|---|
| `hindsight_api_key`, the key claw presents to the Hindsight API | `app_secrets`; leave empty when the API needs no auth |
| an external Postgres instead of the bundled one | `addon_values["hindsight"]`: `postgresql.enabled: false`, `postgresql.external.*` |
| the bundled database's password | the chart default is the literal `hindsight`; change it through the same values |

## Check it works

```bash
kubectl -n hindsight get pods
kubectl -n hindsight logs deploy/hindsight-api | grep -i llm              # the provider and model it uses
kubectl -n xyne-apps get deploy xyne-claw \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="HINDSIGHT_URL")].value}'
```

The last line prints the address claw uses; nothing means memory is off. If Hindsight is up but
stores nothing, its LLM key or provider settings are wrong: the API logs say which.
