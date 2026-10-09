project = "example-project"
region  = "asia-south1"
name    = "xyne"
domain  = "spaces.example.com"

dns_zone     = "spaces-example-com"
worker_names = ["default"]

ingress_mode      = "gateway"
ingress_static_ip = true

master_authorized_networks = [
  { cidr_block = "203.0.113.0/24", display_name = "office" },
]

zero_pool_enabled = false
vespa_enabled     = false
sandbox_enabled   = false
bastion_enabled   = false

postgres_mode     = "managed"
postgres_password = "replace-with-a-long-random-password"

redis_mode = "managed"

storage_mode = "managed"

livekit_enabled    = false
livekit_api_key    = "APIexamplekey"
livekit_api_secret = "replace-with-the-livekit-api-secret"
