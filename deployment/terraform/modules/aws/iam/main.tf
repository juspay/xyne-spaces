locals {
  all_buckets = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]

  identities = {
    backend = {
      role_name = "${var.name}-backend"
      ksa_names = ["xyne-backend"]
      buckets   = { for b in local.all_buckets : b => "rw" }
    }
    worker = {
      role_name = "${var.name}-worker"
      ksa_names = [for w in var.worker_names : "xyne-worker-${w}"]
      buckets   = { for b in local.all_buckets : b => "rw" }
    }
    dashboard_edge = {
      role_name = "${var.name}-dashboard-edge"
      ksa_names = ["xyne-dashboard-edge"]
      buckets   = { bundles = "ro" }
    }
    ysweet = {
      role_name = "${var.name}-ysweet"
      ksa_names = ["xyne-ysweet"]
      buckets   = { main = "rw" }
    }
    claw = {
      role_name = "${var.name}-claw"
      ksa_names = ["xyne-claw"]
      buckets   = { claw = "rw" }
    }
    claw_auth = {
      role_name = "${var.name}-claw-auth"
      ksa_names = ["xyne-claw-auth"]
      buckets   = { claw = "rw" }
    }
    transcription = {
      role_name = "${var.name}-transcription"
      ksa_names = ["xyne-transcription-agent"]
      buckets   = { transcription = "rw" }
    }
  }

  bucket_grants = {
    for identity, spec in local.identities : identity => {
      rw = [for bucket, access in spec.buckets : var.buckets[bucket] if access == "rw" && contains(keys(var.buckets), bucket)]
      ro = [for bucket, access in spec.buckets : var.buckets[bucket] if access == "ro" && contains(keys(var.buckets), bucket)]
    }
  }

  identities_with_buckets = {
    for identity, grants in local.bucket_grants : identity => grants if length(grants.rw) + length(grants.ro) > 0
  }

  pod_identity_bindings = var.use_pod_identity ? merge([
    for identity, spec in local.identities : {
      for ksa in spec.ksa_names : "${identity}:${ksa}" => {
        identity = identity
        ksa      = ksa
      }
    }
  ]...) : {}

  object_actions_rw = [
    "s3:GetObject",
    "s3:GetObjectVersion",
    "s3:PutObject",
    "s3:DeleteObject",
    "s3:DeleteObjectVersion",
    "s3:AbortMultipartUpload",
    "s3:ListMultipartUploadParts",
  ]

  object_actions_ro = [
    "s3:GetObject",
    "s3:GetObjectVersion",
  ]

  bucket_actions = [
    "s3:ListBucket",
    "s3:ListBucketMultipartUploads",
    "s3:GetBucketLocation",
  ]
}

data "aws_partition" "current" {}

data "aws_iam_policy_document" "trust" {
  for_each = local.identities

  statement {
    sid     = "Irsa"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = length(each.value.ksa_names) > 0 ? "StringEquals" : "StringLike"
      variable = "${var.oidc_provider_url}:sub"
      values   = length(each.value.ksa_names) > 0 ? [for ksa in each.value.ksa_names : "system:serviceaccount:${var.namespace}:${ksa}"] : ["system:serviceaccount:${var.namespace}:xyne-${replace(each.key, "_", "-")}-*"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }

  dynamic "statement" {
    for_each = var.use_pod_identity ? [1] : []
    content {
      sid     = "PodIdentity"
      actions = ["sts:AssumeRole", "sts:TagSession"]

      principals {
        type        = "Service"
        identifiers = ["pods.eks.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role" "this" {
  for_each = local.identities

  name               = each.value.role_name
  assume_role_policy = data.aws_iam_policy_document.trust[each.key].json

  tags = merge(var.tags, { identity = each.key })
}

data "aws_iam_policy_document" "buckets" {
  for_each = local.identities_with_buckets

  statement {
    sid       = "Buckets"
    actions   = local.bucket_actions
    resources = [for b in concat(each.value.rw, each.value.ro) : "arn:${data.aws_partition.current.partition}:s3:::${b}"]
  }

  dynamic "statement" {
    for_each = length(each.value.rw) > 0 ? [1] : []
    content {
      sid       = "ObjectsReadWrite"
      actions   = local.object_actions_rw
      resources = [for b in each.value.rw : "arn:${data.aws_partition.current.partition}:s3:::${b}/*"]
    }
  }

  dynamic "statement" {
    for_each = length(each.value.ro) > 0 ? [1] : []
    content {
      sid       = "ObjectsReadOnly"
      actions   = local.object_actions_ro
      resources = [for b in each.value.ro : "arn:${data.aws_partition.current.partition}:s3:::${b}/*"]
    }
  }
}

resource "aws_iam_role_policy" "buckets" {
  for_each = local.identities_with_buckets

  name   = "buckets"
  role   = aws_iam_role.this[each.key].id
  policy = data.aws_iam_policy_document.buckets[each.key].json
}

resource "aws_eks_pod_identity_association" "this" {
  for_each = local.pod_identity_bindings

  cluster_name    = var.cluster_name
  namespace       = var.namespace
  service_account = each.value.ksa
  role_arn        = aws_iam_role.this[each.value.identity].arn

  tags = var.tags
}

data "aws_iam_policy_document" "lb_controller_trust" {
  count = var.lb_controller_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:${var.lb_controller_namespace}:${var.lb_controller_service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lb_controller" {
  count = var.lb_controller_enabled ? 1 : 0

  name               = "${var.name}-lb-controller"
  assume_role_policy = data.aws_iam_policy_document.lb_controller_trust[0].json

  tags = var.tags
}

resource "aws_iam_role_policy" "lb_controller" {
  count = var.lb_controller_enabled ? 1 : 0

  name   = "lb-controller"
  role   = aws_iam_role.lb_controller[0].id
  policy = file("${path.module}/policies/lb-controller.json")
}

data "aws_iam_policy_document" "external_dns_trust" {
  count = var.external_dns_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:${var.external_dns_namespace}:${var.external_dns_service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "external_dns" {
  count = var.external_dns_enabled ? 1 : 0

  statement {
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [for zone in var.external_dns_hosted_zone_ids : "arn:${var.partition}:route53:::hostedzone/${zone}"]
  }

  statement {
    actions = [
      "route53:ListHostedZones",
      "route53:ListResourceRecordSets",
      "route53:ListTagsForResource",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "external_dns" {
  count = var.external_dns_enabled ? 1 : 0

  name               = "${var.name}-external-dns"
  assume_role_policy = data.aws_iam_policy_document.external_dns_trust[0].json

  tags = var.tags
}

resource "aws_iam_role_policy" "external_dns" {
  count = var.external_dns_enabled ? 1 : 0

  name   = "external-dns"
  role   = aws_iam_role.external_dns[0].id
  policy = data.aws_iam_policy_document.external_dns[0].json
}
