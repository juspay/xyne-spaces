locals {
  azs = length(var.availability_zones) > 0 ? slice(var.availability_zones, 0, var.az_count) : slice(data.aws_availability_zones.available.names, 0, var.az_count)

  private_cidrs = length(var.private_subnet_cidrs) > 0 ? var.private_subnet_cidrs : [
    for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, var.subnet_newbits, i)
  ]

  public_cidrs = length(var.public_subnet_cidrs) > 0 ? var.public_subnet_cidrs : [
    for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, var.subnet_newbits, var.az_count + i)
  ]

  private_subnets = { for i, az in local.azs : az => local.private_cidrs[i] }
  public_subnets  = { for i, az in local.azs : az => local.public_cidrs[i] }

  nat_azs = var.single_nat_gateway ? [local.azs[0]] : local.azs

  cluster_tag = "kubernetes.io/cluster/${var.name}"

  interface_endpoints = var.enable_vpc_endpoints ? toset(["ecr.api", "ecr.dkr", "sts", "logs"]) : toset([])
}

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = merge(var.tags, {
    Name                     = "${var.name}-public-${each.key}"
    "kubernetes.io/role/elb" = "1"
    (local.cluster_tag)      = "shared"
  })
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = each.value

  tags = merge(var.tags, {
    Name                              = "${var.name}-private-${each.key}"
    "kubernetes.io/role/internal-elb" = "1"
    (local.cluster_tag)               = "shared"
  })
}

resource "aws_eip" "nat" {
  for_each = toset(local.nat_azs)

  domain = "vpc"

  tags = merge(var.tags, { Name = "${var.name}-nat-${each.key}" })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  for_each = toset(local.nat_azs)

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id

  tags = merge(var.tags, { Name = "${var.name}-${each.key}" })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  for_each = local.private_subnets

  vpc_id = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-private-${each.key}" })
}

resource "aws_route" "private_nat" {
  for_each = local.private_subnets

  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[var.single_nat_gateway ? local.azs[0] : each.key].id
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = [for s in aws_subnet.private : s.id]

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = [for s in aws_subnet.private : s.id]

  tags = merge(var.tags, { Name = var.name })
}

resource "aws_security_group" "cluster" {
  name        = "${var.name}-cluster"
  description = "EKS control plane for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-cluster" })
}

resource "aws_security_group" "nodes" {
  name        = "${var.name}-nodes"
  description = "EKS nodes for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, {
    Name                = "${var.name}-nodes"
    (local.cluster_tag) = "owned"
  })
}

resource "aws_security_group" "postgres" {
  name        = "${var.name}-postgres"
  description = "RDS PostgreSQL for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-postgres" })
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "ElastiCache Redis for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-redis" })
}

resource "aws_security_group" "livekit" {
  name        = "${var.name}-livekit"
  description = "LiveKit instances for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-livekit" })
}

resource "aws_security_group" "bastion" {
  name        = "${var.name}-bastion"
  description = "Bastion for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-bastion" })
}

resource "aws_vpc_security_group_ingress_rule" "cluster_from_nodes" {
  security_group_id            = aws_security_group.cluster.id
  referenced_security_group_id = aws_security_group.nodes.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "cluster_to_nodes" {
  security_group_id            = aws_security_group.cluster.id
  referenced_security_group_id = aws_security_group.nodes.id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "nodes_from_cluster" {
  security_group_id            = aws_security_group.nodes.id
  referenced_security_group_id = aws_security_group.cluster.id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "nodes_self" {
  security_group_id            = aws_security_group.nodes.id
  referenced_security_group_id = aws_security_group.nodes.id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_egress_rule" "nodes_all" {
  for_each = toset(var.internet_egress_cidrs)

  security_group_id = aws_security_group.nodes.id
  cidr_ipv4         = each.value
  ip_protocol       = "-1"
  description       = "outbound internet for image pulls and AWS APIs"
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  for_each = {
    nodes   = aws_security_group.nodes.id
    livekit = aws_security_group.livekit.id
    bastion = aws_security_group.bastion.id
  }

  security_group_id            = aws_security_group.postgres.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  for_each = {
    nodes   = aws_security_group.nodes.id
    livekit = aws_security_group.livekit.id
    bastion = aws_security_group.bastion.id
  }

  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_vpc_security_group_egress_rule" "livekit_all" {
  for_each = toset(var.internet_egress_cidrs)

  security_group_id = aws_security_group.livekit.id
  cidr_ipv4         = each.value
  ip_protocol       = "-1"
  description       = "outbound internet for media, image pulls and AWS APIs"
}

resource "aws_vpc_security_group_egress_rule" "bastion_all" {
  for_each = toset(var.internet_egress_cidrs)

  security_group_id = aws_security_group.bastion.id
  cidr_ipv4         = each.value
  ip_protocol       = "-1"
  description       = "outbound internet for package installs and SSM"
}

resource "aws_security_group" "endpoints" {
  count = var.enable_vpc_endpoints ? 1 : 0

  name        = "${var.name}-endpoints"
  description = "VPC interface endpoints for ${var.name}"
  vpc_id      = aws_vpc.this.id

  tags = merge(var.tags, { Name = "${var.name}-endpoints" })
}

resource "aws_vpc_security_group_ingress_rule" "endpoints" {
  count = var.enable_vpc_endpoints ? 1 : 0

  security_group_id = aws_security_group.endpoints[0].id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_endpoint" "s3" {
  count = var.enable_vpc_endpoints ? 1 : 0

  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat([aws_route_table.public.id], [for rt in aws_route_table.private : rt.id])

  tags = merge(var.tags, { Name = "${var.name}-s3" })
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.private : s.id]
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name}-${each.key}" })
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name              = "/aws/vpc/${var.name}/flow-logs"
  retention_in_days = var.flow_logs_retention_days

  tags = var.tags
}

data "aws_iam_policy_document" "flow_logs_trust" {
  count = var.enable_flow_logs ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.flow_logs[0].arn}:*"]
  }
}

resource "aws_iam_role" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name               = "${var.name}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_trust[0].json

  tags = var.tags
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0

  name   = "flow-logs"
  role   = aws_iam_role.flow_logs[0].id
  policy = data.aws_iam_policy_document.flow_logs[0].json
}

resource "aws_flow_log" "this" {
  count = var.enable_flow_logs ? 1 : 0

  vpc_id               = aws_vpc.this.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow_logs[0].arn
  iam_role_arn         = aws_iam_role.flow_logs[0].arn

  tags = merge(var.tags, { Name = var.name })
}
