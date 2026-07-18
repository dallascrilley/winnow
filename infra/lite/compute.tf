data "aws_ssm_parameter" "al2023_arm64_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  runtime_files = {
    "/opt/inbound-lite/compose.yaml"            = file("${path.module}/runtime/compose.yaml")
    "/opt/inbound-lite/Caddyfile"               = file("${path.module}/runtime/Caddyfile")
    "/opt/inbound-lite/app-entrypoint.sh"       = file("${path.module}/runtime/app-entrypoint.sh")
    "/opt/inbound-lite/deploy.sh"               = file("${path.module}/deploy.sh")
    "/opt/inbound-lite/healthcheck.sh"          = file("${path.module}/runtime/healthcheck.sh")
    "/opt/inbound-lite/backup-golden-state.sh"  = file("${path.module}/../../scripts/backup-golden-state.sh")
    "/opt/inbound-lite/restore-golden-state.sh" = file("${path.module}/../../scripts/restore-golden-state.sh")
    "/opt/inbound-lite/verify-golden-state.mjs" = file("${path.module}/../../scripts/verify-golden-state.mjs")
    "/etc/inbound-lite/config.env" = join("\n", [
      "INBOUND_LITE_ORIGIN_ADDRESS=${var.origin_hostname}",
      "INBOUND_LITE_PUBLIC_URL=https://${var.origin_hostname}",
      "BACKUP_BUCKET=${aws_s3_bucket.backup.bucket}",
      "BACKUP_PREFIX=${local.backup_prefix}",
      "BACKUP_DATA_CLASSIFICATION=synthetic-demo-only",
      "",
    ])
    "/etc/systemd/system/inbound-lite.service"        = file("${path.module}/runtime/inbound-lite.service")
    "/etc/systemd/system/inbound-lite-health.service" = file("${path.module}/runtime/inbound-lite-health.service")
    "/etc/systemd/system/inbound-lite-health.timer"   = file("${path.module}/runtime/inbound-lite-health.timer")
    "/etc/systemd/system/inbound-backup.service"      = file("${path.module}/runtime/inbound-backup.service")
    "/etc/systemd/system/inbound-backup.timer"        = file("${path.module}/runtime/inbound-backup.timer")
  }
}

resource "aws_instance" "origin" {
  ami                                  = data.aws_ssm_parameter.al2023_arm64_ami.value
  instance_type                        = var.instance_type
  subnet_id                            = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids               = [aws_security_group.origin.id]
  iam_instance_profile                 = aws_iam_instance_profile.origin.name
  associate_public_ip_address          = false
  monitoring                           = false
  instance_initiated_shutdown_behavior = "stop"

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    aws_region     = var.aws_region
    runtime_bucket = aws_s3_bucket.backup.bucket
    runtime_key    = aws_s3_object.runtime.key
  })
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gib
    encrypted             = true
    delete_on_termination = true
  }

  credit_specification {
    cpu_credits = "standard"
  }

  # Until U5 proves backup/restore, reviewed runtime assets and the AMI must not
  # cause an implicit host replacement that deletes the root PostgreSQL volume.
  # Runtime updates use SSM; an intentional replacement requires a fresh backup.
  lifecycle {
    ignore_changes = [ami, user_data, associate_public_ip_address]

    precondition {
      condition = (
        var.bootstrap_only ||
        (var.openai_api_key != "" && var.initial_app_image_ref != "UNSET")
      )
      error_message = "Set bootstrap_only=false only with a funded OpenAI key and immutable app image ref."
    }
  }

  tags = {
    Name = local.name
  }

  depends_on = [
    aws_iam_role_policy.origin_runtime,
    aws_iam_role_policy_attachment.ssm_core,
    aws_s3_object.runtime,
  ]
}
