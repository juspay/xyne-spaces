locals {
  redis = {
    address  = "${var.redis.host}:${var.redis.port}"
    password = var.redis_auth
    use_tls  = var.redis.tls
  }

  logging = {
    level = "info"
    json  = true
  }

  turn = {
    for k, v in {
      enabled   = true
      udp_port  = 3478
      domain    = "turn.${var.domain}"
      tls_port  = var.turn.tls_port
      cert_file = var.turn.cert_file
      key_file  = var.turn.key_file
    } : k => v if var.turn.tls || contains(["enabled", "udp_port"], k)
  }

  server_settings = yamlencode({
    port           = 7880
    bind_addresses = ["0.0.0.0"]
    rtc = {
      tcp_port         = 7881
      port_range_start = var.port_range_start
      port_range_end   = var.port_range_end
      use_external_ip  = true
    }
    redis   = local.redis
    turn    = local.turn
    logging = local.logging
  })

  server_config = join("\n", [
    trimsuffix(local.server_settings, "\n"),
    "keys:",
    "  ${jsonencode(var.api_key)}: ${jsonencode(var.api_secret)}",
    "",
  ])

  egress_config = yamlencode({
    api_key    = var.api_key
    api_secret = var.api_secret
    ws_url     = var.ws_url
    redis      = local.redis
    logging    = local.logging
  })
}
