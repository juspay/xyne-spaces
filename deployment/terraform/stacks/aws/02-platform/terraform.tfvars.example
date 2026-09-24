region       = "ap-south-1"
state_bucket = "example-account-tfstate"
state_key    = "xyne/01-infra/terraform.tfstate"

namespace      = "xyne"
domain         = "spaces.example.com"
chart_revision = "chart-1.356.0"
root_revision  = "main"
image_registry = ""
image_tag      = ""
acme_email     = "ops@example.com"

enable_vespa      = false
enable_monitoring = false
enable_sandbox    = false
enable_hindsight  = false

hindsight = {
  url    = ""
  tenant = "default"
}

apps = {
  xyne-claw = { enabled = false }
}

workers = [
  { name = "default" },
]

app_secrets = {
  jwt_secret                  = "replace-with-32-or-more-random-characters"
  zero_auth_secret            = "replace-with-32-or-more-random-characters"
  zero_admin_password         = "replace-with-16-or-more-chars"
  encryption_key              = "replace-with-64-hex-characters"
  internal_s2s_key            = "replace-with-32-or-more-random-characters"
  claw_s2s_key                = "replace-with-32-or-more-random-characters"
  claw_auth_encryption_key    = "replace-with-64-hex-characters"
  ysweet_auth                 = "replace-with-private_key-from-y-sweet-gen-auth"
  ysweet_server_token         = "replace-with-server_token-from-y-sweet-gen-auth"
  transcription_agent_api_key = "replace-with-32-or-more-random-characters"
}
