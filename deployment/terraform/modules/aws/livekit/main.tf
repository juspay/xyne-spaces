locals {
  count = var.enabled ? 1 : 0

  url       = var.enabled ? "wss://livekit.${var.domain}" : ""
  http_url  = var.enabled ? "https://livekit.${var.domain}" : ""
  turn_host = var.enabled ? "turn.${var.domain}" : ""
  turn_tls  = var.turn_cert_secret != ""

  turn_count = var.enabled && local.turn_tls ? 1 : 0
  dns_count  = var.enabled && var.dns_zone != "" ? 1 : 0

  create_certificate = var.enabled && var.certificate_arn == "" && var.create_certificate && var.dns_zone != ""
  certificate_count  = local.create_certificate ? 1 : 0
  certificate_arn    = var.certificate_arn != "" ? var.certificate_arn : (local.create_certificate ? aws_acm_certificate_validation.signal[0].certificate_arn : "")

  roles = {
    server = {
      config_secret  = "${var.name}/livekit/server-config"
      image          = var.server_image
      docker_flags   = "-v /etc/livekit:/etc/livekit:ro"
      container_args = "--config /etc/livekit/config.yaml"
      turn_cert      = var.turn_cert_secret
      instance_type  = var.instance_type
      public_ip      = true
    }
    egress = {
      config_secret  = "${var.name}/livekit/egress-config"
      image          = var.egress_image
      docker_flags   = "--cap-add SYS_ADMIN -e EGRESS_CONFIG_FILE=/etc/livekit/config.yaml -v /etc/livekit:/etc/livekit:ro"
      container_args = ""
      turn_cert      = ""
      instance_type  = var.egress_instance_type
      public_ip      = false
    }
  }

  enabled_roles = { for role, spec in local.roles : role => spec if var.enabled }

  configs = {
    server = module.config.server_config
    egress = module.config.egress_config
  }

  validation_records = local.create_certificate ? {
    for dvo in aws_acm_certificate.signal[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}
}

module "config" {
  source = "../../livekit-config"

  api_key          = var.api_key
  api_secret       = var.api_secret
  domain           = var.domain
  ws_url           = local.url
  redis            = var.redis
  redis_auth       = var.redis_auth
  port_range_start = var.port_range_start
  port_range_end   = var.port_range_end
  turn = {
    tls = local.turn_tls
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_ssm_parameter" "ami" {
  count = local.count

  name = var.ami_ssm_parameter
}

resource "aws_secretsmanager_secret" "config" {
  for_each = local.enabled_roles

  name                    = each.value.config_secret
  recovery_window_in_days = var.secret_recovery_window_days

  tags = merge(var.tags, { role = "livekit-${each.key}" })
}

resource "aws_secretsmanager_secret_version" "config" {
  for_each = local.enabled_roles

  secret_id     = aws_secretsmanager_secret.config[each.key].id
  secret_string = local.configs[each.key]
}

data "aws_iam_policy_document" "instance_trust" {
  count = local.count

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "instance" {
  count = local.count

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [for secret in aws_secretsmanager_secret.config : secret.arn],
      local.turn_tls ? ["arn:${data.aws_partition.current.partition}:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.turn_cert_secret}-*"] : [],
    )
  }
}

resource "aws_iam_role" "instances" {
  count = local.count

  name               = "${var.name}-livekit-instances"
  assume_role_policy = data.aws_iam_policy_document.instance_trust[0].json

  tags = var.tags
}

resource "aws_iam_role_policy" "instances" {
  count = local.count

  name   = "secrets"
  role   = aws_iam_role.instances[0].id
  policy = data.aws_iam_policy_document.instance[0].json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  count = local.count

  role       = aws_iam_role.instances[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "instances" {
  count = local.count

  name = "${var.name}-livekit-instances"
  role = aws_iam_role.instances[0].name

  tags = var.tags
}

resource "aws_security_group" "alb" {
  count = local.count

  name        = "${var.name}-livekit-alb"
  description = "LiveKit signaling load balancer for ${var.name}"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name}-livekit-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = var.enabled ? toset(["80", "443"]) : toset([])

  security_group_id = aws_security_group.alb[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "alb" {
  count = local.count

  security_group_id            = aws_security_group.alb[0].id
  referenced_security_group_id = aws_security_group.server[0].id
  ip_protocol                  = "tcp"
  from_port                    = 7880
  to_port                      = 7880
}

resource "aws_security_group" "nlb" {
  count = local.turn_count

  name        = "${var.name}-livekit-nlb"
  description = "LiveKit TURN TLS load balancer for ${var.name}"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name}-livekit-nlb" })
}

resource "aws_vpc_security_group_ingress_rule" "nlb" {
  count = local.turn_count

  security_group_id = aws_security_group.nlb[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 5349
  to_port           = 5349
}

resource "aws_vpc_security_group_egress_rule" "nlb" {
  count = local.turn_count

  security_group_id            = aws_security_group.nlb[0].id
  referenced_security_group_id = aws_security_group.server[0].id
  ip_protocol                  = "tcp"
  from_port                    = 5349
  to_port                      = 5349
}

resource "aws_vpc_security_group_egress_rule" "nlb_health" {
  count = local.turn_count

  security_group_id            = aws_security_group.nlb[0].id
  referenced_security_group_id = aws_security_group.server[0].id
  ip_protocol                  = "tcp"
  from_port                    = 7880
  to_port                      = 7880
}

resource "aws_security_group" "server" {
  count = local.count

  name        = "${var.name}-livekit-server"
  description = "LiveKit servers for ${var.name}"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name}-livekit-server" })
}

resource "aws_vpc_security_group_ingress_rule" "server_signal" {
  count = local.count

  security_group_id            = aws_security_group.server[0].id
  referenced_security_group_id = aws_security_group.alb[0].id
  ip_protocol                  = "tcp"
  from_port                    = 7880
  to_port                      = 7880
}

resource "aws_vpc_security_group_ingress_rule" "server_turn_tls" {
  count = local.turn_count

  security_group_id            = aws_security_group.server[0].id
  referenced_security_group_id = aws_security_group.nlb[0].id
  ip_protocol                  = "tcp"
  from_port                    = 5349
  to_port                      = 5349
}

resource "aws_vpc_security_group_ingress_rule" "server_turn_health" {
  count = local.turn_count

  security_group_id            = aws_security_group.server[0].id
  referenced_security_group_id = aws_security_group.nlb[0].id
  ip_protocol                  = "tcp"
  from_port                    = 7880
  to_port                      = 7880
}

resource "aws_vpc_security_group_ingress_rule" "server_rtc_tcp" {
  count = local.count

  security_group_id = aws_security_group.server[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 7881
  to_port           = 7881
}

resource "aws_vpc_security_group_ingress_rule" "server_turn_udp" {
  count = local.count

  security_group_id = aws_security_group.server[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = 3478
  to_port           = 3478
}

resource "aws_vpc_security_group_ingress_rule" "server_rtc_udp" {
  count = local.count

  security_group_id = aws_security_group.server[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = var.port_range_start
  to_port           = var.port_range_end
}

resource "aws_vpc_security_group_egress_rule" "server" {
  count = local.count

  security_group_id = aws_security_group.server[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "egress" {
  count = local.count

  name        = "${var.name}-livekit-egress"
  description = "LiveKit egress workers for ${var.name}"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name}-livekit-egress" })
}

resource "aws_vpc_security_group_egress_rule" "egress" {
  count = local.count

  security_group_id = aws_security_group.egress[0].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_launch_template" "this" {
  for_each = local.enabled_roles

  name                   = "${var.name}-livekit-${each.key}"
  update_default_version = true
  image_id               = data.aws_ssm_parameter.ami[0].value
  instance_type          = each.value.instance_type

  user_data = base64encode(templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    region           = var.region
    role             = each.key
    config_secret    = each.value.config_secret
    turn_cert_secret = each.value.turn_cert
    image            = each.value.image
    docker_flags     = each.value.docker_flags
    container_args   = each.value.container_args
  }))

  iam_instance_profile {
    name = aws_iam_instance_profile.instances[0].name
  }

  network_interfaces {
    device_index                = 0
    associate_public_ip_address = each.value.public_ip
    delete_on_termination       = true
    security_groups             = [var.security_group_id, each.key == "server" ? aws_security_group.server[0].id : aws_security_group.egress[0].id]
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = var.root_device_name

    ebs {
      volume_type           = "gp3"
      volume_size           = var.disk_size_gb
      encrypted             = true
      delete_on_termination = true
    }
  }

  monitoring {
    enabled = true
  }

  tag_specifications {
    resource_type = "instance"
    tags          = merge(var.tags, { Name = "${var.name}-livekit-${each.key}", role = "livekit-${each.key}" })
  }

  tag_specifications {
    resource_type = "volume"
    tags          = merge(var.tags, { Name = "${var.name}-livekit-${each.key}", role = "livekit-${each.key}" })
  }

  tags = merge(var.tags, { role = "livekit-${each.key}" })

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_secretsmanager_secret_version.config]
}

resource "aws_lb_target_group" "signal" {
  count = local.count

  name                 = "${var.name}-livekit-signal"
  vpc_id               = var.vpc_id
  port                 = 7880
  protocol             = "HTTP"
  target_type          = "instance"
  deregistration_delay = 300

  health_check {
    enabled             = true
    protocol            = "HTTP"
    port                = "7880"
    path                = "/"
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_target_group" "turn" {
  count = local.turn_count

  name                 = "${var.name}-livekit-turn"
  vpc_id               = var.vpc_id
  port                 = 5349
  protocol             = "TCP"
  target_type          = "instance"
  deregistration_delay = 300
  preserve_client_ip   = true

  health_check {
    enabled             = true
    protocol            = "HTTP"
    port                = "7880"
    path                = "/"
    matcher             = "200"
    interval            = 10
    timeout             = 6
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_autoscaling_group" "server" {
  count = local.count

  name                      = "${var.name}-livekit-server"
  min_size                  = var.min_replicas
  max_size                  = var.max_replicas
  desired_capacity          = var.min_replicas
  vpc_zone_identifier       = var.public_subnet_ids
  health_check_type         = "ELB"
  health_check_grace_period = 300
  default_cooldown          = 120
  target_group_arns         = concat([aws_lb_target_group.signal[0].arn], local.turn_tls ? [aws_lb_target_group.turn[0].arn] : [])

  launch_template {
    id      = aws_launch_template.this["server"].id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"

    preferences {
      min_healthy_percentage = 100
      max_healthy_percentage = 200
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.name}-livekit-server"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }

  lifecycle {
    ignore_changes = [desired_capacity]

    precondition {
      condition     = var.redis.mode != "incluster"
      error_message = "LiveKit shares state through Redis reachable from outside the cluster; redis_mode must be managed or external when livekit_enabled is true."
    }

    precondition {
      condition     = var.api_key != "" && var.api_secret != ""
      error_message = "livekit_api_key and livekit_api_secret are required when livekit_enabled is true."
    }

    precondition {
      condition     = var.domain != ""
      error_message = "domain is required when livekit_enabled is true."
    }

    precondition {
      condition     = var.certificate_arn != "" || (var.create_certificate && var.dns_zone != "")
      error_message = "livekit_certificate_arn is required when livekit_enabled is true, unless dns_zone is set and livekit_create_certificate is true so that ACM can issue and validate the certificate for livekit.<domain>."
    }
  }
}

resource "aws_autoscaling_policy" "server" {
  count = local.count

  name                      = "${var.name}-livekit-server-cpu"
  autoscaling_group_name    = aws_autoscaling_group.server[0].name
  policy_type               = "TargetTrackingScaling"
  estimated_instance_warmup = 300

  target_tracking_configuration {
    target_value = var.target_cpu_utilization * 100

    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
  }
}

resource "aws_autoscaling_group" "egress" {
  count = local.count

  name                      = "${var.name}-livekit-egress"
  min_size                  = var.egress_min_replicas
  max_size                  = var.egress_max_replicas
  desired_capacity          = var.egress_min_replicas
  vpc_zone_identifier       = var.private_subnet_ids
  health_check_type         = "EC2"
  health_check_grace_period = 300
  default_cooldown          = 120

  launch_template {
    id      = aws_launch_template.this["egress"].id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"

    preferences {
      min_healthy_percentage = 100
      max_healthy_percentage = 200
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.name}-livekit-egress"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}

resource "aws_autoscaling_policy" "egress" {
  count = local.count

  name                      = "${var.name}-livekit-egress-cpu"
  autoscaling_group_name    = aws_autoscaling_group.egress[0].name
  policy_type               = "TargetTrackingScaling"
  estimated_instance_warmup = 300

  target_tracking_configuration {
    target_value = var.target_cpu_utilization * 100

    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
  }
}

resource "aws_acm_certificate" "signal" {
  count = local.certificate_count

  domain_name       = "livekit.${var.domain}"
  validation_method = "DNS"

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = local.validation_records

  zone_id         = var.dns_zone
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "signal" {
  count = local.certificate_count

  certificate_arn         = aws_acm_certificate.signal[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}

resource "aws_lb" "signal" {
  count = local.count

  name                       = "${var.name}-livekit-signal"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb[0].id]
  subnets                    = var.public_subnet_ids
  idle_timeout               = 3600
  drop_invalid_header_fields = true
  enable_deletion_protection = false

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  count = local.count

  load_balancer_arn = aws_lb.signal[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.signal[0].arn
  }

  tags = var.tags
}

resource "aws_lb_listener" "http" {
  count = local.count

  load_balancer_arn = aws_lb.signal[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = var.tags
}

resource "aws_lb" "turn" {
  count = local.turn_count

  name                             = "${var.name}-livekit-turn"
  load_balancer_type               = "network"
  internal                         = false
  security_groups                  = [aws_security_group.nlb[0].id]
  subnets                          = var.public_subnet_ids
  enable_cross_zone_load_balancing = true
  enable_deletion_protection       = false

  tags = var.tags
}

resource "aws_lb_listener" "turn" {
  count = local.turn_count

  load_balancer_arn = aws_lb.turn[0].arn
  port              = 5349
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.turn[0].arn
  }

  tags = var.tags
}

resource "aws_route53_record" "signal" {
  count = local.dns_count

  zone_id = var.dns_zone
  name    = "livekit.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.signal[0].dns_name
    zone_id                = aws_lb.signal[0].zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "turn" {
  count = var.enabled && var.dns_zone != "" && local.turn_tls ? 1 : 0

  zone_id = var.dns_zone
  name    = "turn.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.turn[0].dns_name
    zone_id                = aws_lb.turn[0].zone_id
    evaluate_target_health = false
  }
}
