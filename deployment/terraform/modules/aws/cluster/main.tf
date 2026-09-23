locals {
  endpoint_public_access = var.endpoint_public_access && length(var.public_access_cidrs) > 0

  pool_fixed = {
    general = {
      taints              = []
      ami_type            = var.node_pools.general.ami_type
      root_device_name    = "/dev/xvda"
      local_storage_raid0 = false
      custom_ami          = false
    }
    zero = {
      taints = [
        { key = "storage-type", value = "local-ssd", effect = "NO_SCHEDULE" },
      ]
      ami_type            = var.node_pools.zero.ami_type
      root_device_name    = "/dev/xvda"
      local_storage_raid0 = var.node_pools.zero.local_storage_raid0
      custom_ami          = false
    }
    vespa = {
      taints = [
        { key = "pool", value = "vespa", effect = "NO_SCHEDULE" },
      ]
      ami_type            = var.node_pools.vespa.ami_type
      root_device_name    = "/dev/xvda"
      local_storage_raid0 = false
      custom_ami          = false
    }
    sandbox = {
      taints = [
        { key = "workload", value = "sandbox", effect = "NO_SCHEDULE" },
      ]
      ami_type            = "CUSTOM"
      root_device_name    = "/dev/sda1"
      local_storage_raid0 = false
      custom_ami          = true
    }
  }

  pools = {
    for key, fixed in local.pool_fixed : key => merge(
      {
        enabled       = var.node_pools[key].enabled
        instance_type = var.node_pools[key].instance_type
        min_count     = var.node_pools[key].min_count
        max_count     = var.node_pools[key].max_count
        desired_count = var.node_pools[key].desired_count != null ? var.node_pools[key].desired_count : var.node_pools[key].min_count
        disk_size_gb  = var.node_pools[key].disk_size_gb
        disk_type     = var.node_pools[key].disk_type
        spot          = var.node_pools[key].spot
        labels        = merge(var.node_pools[key].labels, { pool = key })
      },
      fixed,
    )
  }

  enabled_pools = { for key, pool in local.pools : key => pool if pool.enabled }

  sandbox_enabled = local.pools.sandbox.enabled

  sandbox_ami_ssm_parameter = var.sandbox_ami_ssm_parameter != "" ? var.sandbox_ami_ssm_parameter : "/aws/service/canonical/ubuntu/eks/24.04/${aws_eks_cluster.this.version}/stable/current/amd64/hvm/ebs-gp3/ami-id"

  effect_names = {
    NO_SCHEDULE        = "NoSchedule"
    PREFER_NO_SCHEDULE = "PreferNoSchedule"
    NO_EXECUTE         = "NoExecute"
  }

  node_policies = [
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ]

  oidc_issuer = aws_eks_cluster.this.identity[0].oidc[0].issuer
  oidc_host   = trimprefix(local.oidc_issuer, "https://")

  addons_before_nodes = {
    vpc-cni    = { role_arn = null }
    kube-proxy = { role_arn = null }
  }

  addons_after_nodes = {
    coredns                = { role_arn = null }
    eks-pod-identity-agent = { role_arn = null }
    aws-ebs-csi-driver     = { role_arn = aws_iam_role.ebs_csi.arn }
  }

  user_data = {
    for key, pool in local.enabled_pools : key => (
      pool.custom_ami ? templatefile("${path.module}/templates/sandbox-user-data.yaml.tftpl", {
        cluster_name = aws_eks_cluster.this.name
        endpoint     = aws_eks_cluster.this.endpoint
        ca           = aws_eks_cluster.this.certificate_authority[0].data
        labels       = join(",", [for k, v in pool.labels : "${k}=${v}"])
        taints       = join(",", [for t in pool.taints : "${t.key}=${t.value}:${local.effect_names[t.effect]}"])
        }) : (
        pool.local_storage_raid0 ? file("${path.module}/templates/nodeadm-local-storage.mime.tftpl") : ""
      )
    )
  }
}

data "aws_iam_policy_document" "cluster_trust" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.name}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.cluster_trust.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

data "aws_iam_policy_document" "cluster_kms" {
  count = var.kms_key_arn != "" ? 1 : 0

  statement {
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ListGrants",
      "kms:DescribeKey",
    ]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "cluster_kms" {
  count = var.kms_key_arn != "" ? 1 : 0

  name   = "secrets-kms"
  role   = aws_iam_role.cluster.id
  policy = data.aws_iam_policy_document.cluster_kms[0].json
}

resource "aws_cloudwatch_log_group" "cluster" {
  count = length(var.cluster_log_types) > 0 ? 1 : 0

  name              = "/aws/eks/${var.name}/cluster"
  retention_in_days = var.cluster_log_retention_days

  tags = var.tags
}

resource "aws_eks_cluster" "this" {
  name                          = var.name
  role_arn                      = aws_iam_role.cluster.arn
  version                       = var.kubernetes_version != "" ? var.kubernetes_version : null
  enabled_cluster_log_types     = var.cluster_log_types
  bootstrap_self_managed_addons = false

  tags = var.tags

  vpc_config {
    subnet_ids              = var.subnet_ids
    security_group_ids      = [var.cluster_security_group_id]
    endpoint_private_access = var.endpoint_private_access
    endpoint_public_access  = local.endpoint_public_access
    public_access_cidrs     = local.endpoint_public_access ? var.public_access_cidrs : null
  }

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  kubernetes_network_config {
    ip_family         = "ipv4"
    service_ipv4_cidr = var.services_cidr != "" ? var.services_cidr : null
  }

  upgrade_policy {
    support_type = var.support_type
  }

  dynamic "encryption_config" {
    for_each = var.kms_key_arn != "" ? [1] : []
    content {
      resources = ["secrets"]

      provider {
        key_arn = var.kms_key_arn
      }
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster,
    aws_iam_role_policy.cluster_kms,
    aws_cloudwatch_log_group.cluster,
  ]

  lifecycle {
    precondition {
      condition     = !var.endpoint_public_access || length(var.public_access_cidrs) > 0
      error_message = "public_access_cidrs is empty, so the API server would have no public endpoint and kubectl would only work from inside the VPC. List the ranges allowed to reach it, or set enable_private_endpoint = true to confirm that is what you want."
    }
  }
}

resource "aws_iam_openid_connect_provider" "this" {
  url            = local.oidc_issuer
  client_id_list = ["sts.amazonaws.com"]

  tags = var.tags
}

resource "aws_eks_access_entry" "deployer" {
  count = var.deployer_principal_arn != "" ? 1 : 0

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = var.deployer_principal_arn
  type          = "STANDARD"

  tags = var.tags
}

resource "aws_eks_access_policy_association" "deployer" {
  count = var.deployer_principal_arn != "" ? 1 : 0

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = aws_eks_access_entry.deployer[0].principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}

data "aws_iam_policy_document" "node_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "nodes" {
  name               = "${var.name}-eks-nodes"
  assume_role_policy = data.aws_iam_policy_document.node_trust.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "nodes" {
  for_each = toset(local.node_policies)

  role       = aws_iam_role.nodes.name
  policy_arn = each.key
}

data "aws_iam_policy_document" "ebs_csi_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.this.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${var.name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_trust.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

data "aws_iam_policy_document" "ebs_csi_kms" {
  count = var.kms_key_arn != "" ? 1 : 0

  statement {
    actions = [
      "kms:CreateGrant",
      "kms:ListGrants",
      "kms:RevokeGrant",
    ]
    resources = [var.kms_key_arn]

    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }

  statement {
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "ebs_csi_kms" {
  count = var.kms_key_arn != "" ? 1 : 0

  name   = "volume-kms"
  role   = aws_iam_role.ebs_csi.id
  policy = data.aws_iam_policy_document.ebs_csi_kms[0].json
}

resource "aws_eks_addon" "before_nodes" {
  for_each = local.addons_before_nodes

  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = each.key
  addon_version               = lookup(var.addon_versions, each.key, null)
  service_account_role_arn    = each.value.role_arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  tags = var.tags
}

data "aws_ssm_parameter" "sandbox_ami" {
  count = local.sandbox_enabled ? 1 : 0

  name = local.sandbox_ami_ssm_parameter
}

resource "aws_launch_template" "this" {
  for_each = local.enabled_pools

  name                   = "${var.name}-${each.key}"
  update_default_version = true
  image_id               = each.value.custom_ami ? data.aws_ssm_parameter.sandbox_ami[0].value : null
  vpc_security_group_ids = [var.node_security_group_id]
  user_data              = local.user_data[each.key] != "" ? base64encode(local.user_data[each.key]) : null

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }

  block_device_mappings {
    device_name = each.value.root_device_name

    ebs {
      volume_type           = each.value.disk_type
      volume_size           = each.value.disk_size_gb
      encrypted             = true
      kms_key_id            = var.kms_key_arn != "" ? var.kms_key_arn : null
      delete_on_termination = true
    }
  }

  monitoring {
    enabled = true
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(var.tags, {
      Name                                = "${var.name}-${each.key}"
      pool                                = each.key
      "kubernetes.io/cluster/${var.name}" = "owned"
    })
  }

  tag_specifications {
    resource_type = "volume"
    tags          = merge(var.tags, { Name = "${var.name}-${each.key}", pool = each.key })
  }

  tags = merge(var.tags, { pool = each.key })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_eks_node_group" "this" {
  for_each = local.enabled_pools

  cluster_name           = aws_eks_cluster.this.name
  node_group_name_prefix = "${each.key}-"
  node_role_arn          = aws_iam_role.nodes.arn
  subnet_ids             = var.subnet_ids
  ami_type               = each.value.ami_type
  capacity_type          = each.value.spot ? "SPOT" : "ON_DEMAND"
  instance_types         = [each.value.instance_type]
  version                = each.value.custom_ami ? null : aws_eks_cluster.this.version
  labels                 = each.value.labels

  launch_template {
    id      = aws_launch_template.this[each.key].id
    version = aws_launch_template.this[each.key].latest_version
  }

  scaling_config {
    min_size     = each.value.min_count
    max_size     = each.value.max_count
    desired_size = each.value.desired_count
  }

  update_config {
    max_unavailable = 1
  }

  dynamic "taint" {
    for_each = each.value.taints
    content {
      key    = taint.value.key
      value  = taint.value.value
      effect = taint.value.effect
    }
  }

  tags = merge(var.tags, { pool = each.key })

  lifecycle {
    ignore_changes        = [scaling_config[0].desired_size]
    create_before_destroy = true
  }

  depends_on = [
    aws_iam_role_policy_attachment.nodes,
    aws_eks_addon.before_nodes,
  ]
}

resource "aws_eks_addon" "after_nodes" {
  for_each = local.addons_after_nodes

  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = each.key
  addon_version               = lookup(var.addon_versions, each.key, null)
  service_account_role_arn    = each.value.role_arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  tags = var.tags

  depends_on = [aws_eks_node_group.this]
}
