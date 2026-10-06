locals {
  count      = var.enabled ? 1 : 0
  eip_count  = var.enabled ? length(var.public_subnet_ids) : 0
  http_count = var.enabled && var.http_listener ? 1 : 0
  dns_count  = var.enabled && var.dns_zone != "" && var.create_dns_records ? 1 : 0

  create_certificate = var.enabled && var.certificate_arn == "" && length(var.certificate_domains) > 0 && var.dns_zone != ""
  certificate_count  = local.create_certificate ? 1 : 0
  certificate_arn    = var.certificate_arn != "" ? var.certificate_arn : (local.create_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : "")

  backend_groups = var.enabled ? { for key, group in var.backend_autoscaling_groups : tostring(key) => group } : {}

  http_backend_groups = var.enabled && var.http_listener ? local.backend_groups : {}

  source_cidrs = var.enabled ? toset(var.allowed_cidrs) : toset([])

  http_source_cidrs = var.enabled && var.http_listener ? local.source_cidrs : toset([])

  validation_records = local.create_certificate ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}
}

resource "terraform_data" "inputs" {
  count = local.count

  lifecycle {
    precondition {
      condition     = var.certificate_arn != "" || local.create_certificate
      error_message = "ingress_certificate_arn is required, unless dns_zone is set and ingress_certificate_domains resolves to at least one domain so that ACM can issue and validate the edge certificate."
    }

    precondition {
      condition     = var.certificate_arn != "" || var.dns_zone != ""
      error_message = "dns_zone is required so that ACM can validate the edge certificate through DNS; set ingress_certificate_arn instead when the certificate already exists."
    }
  }
}

resource "aws_eip" "this" {
  count = local.eip_count

  domain = "vpc"

  tags = merge(var.tags, { Name = "${var.name}-ingress-${count.index}" })
}

resource "aws_lb" "this" {
  count = local.count

  name                             = "${var.name}-ingress"
  load_balancer_type               = "network"
  internal                         = false
  enable_cross_zone_load_balancing = true
  enable_deletion_protection       = false

  dynamic "subnet_mapping" {
    for_each = range(local.eip_count)

    content {
      subnet_id     = var.public_subnet_ids[subnet_mapping.value]
      allocation_id = aws_eip.this[subnet_mapping.value].id
    }
  }

  tags = var.tags
}

resource "aws_acm_certificate" "this" {
  count = local.certificate_count

  domain_name               = var.certificate_domains[0]
  subject_alternative_names = slice(var.certificate_domains, 1, length(var.certificate_domains))
  validation_method         = "DNS"

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

resource "aws_acm_certificate_validation" "this" {
  count = local.certificate_count

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}

resource "aws_lb_target_group" "https" {
  count = local.count

  name               = "${var.name}-ingress-https"
  vpc_id             = var.vpc_id
  port               = var.node_ports.https
  protocol           = var.backend_protocol == "TCP" ? "TCP" : "TLS"
  target_type        = "instance"
  preserve_client_ip = var.preserve_client_ip

  health_check {
    enabled             = true
    protocol            = "HTTP"
    port                = tostring(var.node_ports.status)
    path                = "/healthz/ready"
    matcher             = "200"
    interval            = 10
    timeout             = 6
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_target_group" "http" {
  count = local.http_count

  name               = "${var.name}-ingress-http"
  vpc_id             = var.vpc_id
  port               = var.node_ports.http
  protocol           = "TCP"
  target_type        = "instance"
  preserve_client_ip = var.preserve_client_ip

  health_check {
    enabled             = true
    protocol            = "HTTP"
    port                = tostring(var.node_ports.status)
    path                = "/healthz/ready"
    matcher             = "200"
    interval            = 10
    timeout             = 6
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  count = local.count

  load_balancer_arn = aws_lb.this[0].arn
  port              = 443
  protocol          = "TLS"
  certificate_arn   = local.certificate_arn
  ssl_policy        = var.ssl_policy
  alpn_policy       = "HTTP2Preferred"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.https[0].arn
  }

  tags = var.tags

  depends_on = [terraform_data.inputs]
}

resource "aws_lb_listener" "http" {
  count = local.http_count

  load_balancer_arn = aws_lb.this[0].arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.http[0].arn
  }

  tags = var.tags
}

resource "aws_autoscaling_attachment" "https" {
  for_each = local.backend_groups

  autoscaling_group_name = each.value
  lb_target_group_arn    = aws_lb_target_group.https[0].arn
}

resource "aws_autoscaling_attachment" "http" {
  for_each = local.http_backend_groups

  autoscaling_group_name = each.value
  lb_target_group_arn    = aws_lb_target_group.http[0].arn
}

resource "aws_vpc_security_group_ingress_rule" "nodes_https" {
  for_each = local.source_cidrs

  security_group_id = var.node_security_group_id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.node_ports.https
  to_port           = var.node_ports.https
}

resource "aws_vpc_security_group_ingress_rule" "nodes_http" {
  for_each = local.http_source_cidrs

  security_group_id = var.node_security_group_id
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = var.node_ports.http
  to_port           = var.node_ports.http
}

resource "aws_vpc_security_group_ingress_rule" "nodes_status" {
  count = local.count

  security_group_id = var.node_security_group_id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = var.node_ports.status
  to_port           = var.node_ports.status
}

resource "aws_route53_record" "apex" {
  count = local.dns_count

  zone_id = var.dns_zone
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_lb.this[0].dns_name
    zone_id                = aws_lb.this[0].zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "wildcard" {
  count = local.dns_count

  zone_id = var.dns_zone
  name    = "*.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.this[0].dns_name
    zone_id                = aws_lb.this[0].zone_id
    evaluate_target_health = false
  }
}
