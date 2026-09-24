locals {
  count = var.enabled ? 1 : 0
}

data "aws_ssm_parameter" "ami" {
  count = local.count

  name = var.ami_ssm_parameter
}

data "aws_iam_policy_document" "trust" {
  count = local.count

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  count = local.count

  name               = "${var.name}-bastion"
  assume_role_policy = data.aws_iam_policy_document.trust[0].json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  count = local.count

  role       = aws_iam_role.this[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "this" {
  count = local.count

  name = "${var.name}-bastion"
  role = aws_iam_role.this[0].name

  tags = var.tags
}

resource "aws_instance" "this" {
  count = local.count

  ami                         = data.aws_ssm_parameter.ami[0].value
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = var.security_group_ids
  iam_instance_profile        = aws_iam_instance_profile.this[0].name
  associate_public_ip_address = true
  user_data                   = file("${path.module}/templates/cloud-init.yaml")
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_size_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = merge(var.tags, { Name = "${var.name}-bastion" })

  lifecycle {
    ignore_changes = [ami]
  }
}
