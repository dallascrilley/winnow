locals {
  backup_bucket_name = "${local.name}-golden-state-${data.aws_caller_identity.current.account_id}"
  backup_prefix      = "golden-state"
  runtime_prefix     = "runtime"
}

data "archive_file" "runtime" {
  type        = "zip"
  output_path = "${path.module}/runtime-bundle.zip"

  dynamic "source" {
    for_each = local.runtime_files
    content {
      content  = source.value
      filename = trimprefix(source.key, "/")
    }
  }
}

resource "aws_s3_object" "runtime" {
  bucket                 = aws_s3_bucket.backup.id
  key                    = "${local.runtime_prefix}/runtime-bundle.zip"
  source                 = data.archive_file.runtime.output_path
  source_hash            = data.archive_file.runtime.output_base64sha256
  server_side_encryption = "AES256"

  depends_on = [aws_s3_bucket_server_side_encryption_configuration.backup]
}

resource "aws_s3_bucket" "backup" {
  bucket        = local.backup_bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    id     = "expire-noncurrent-golden-state"
    status = "Enabled"

    filter {
      prefix = "${local.backup_prefix}/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "expire-noncurrent-runtime-bundle"
    status = "Enabled"

    filter {
      prefix = "${local.runtime_prefix}/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  depends_on = [aws_s3_bucket_versioning.backup]
}

data "aws_iam_policy_document" "backup_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    actions = [
      "s3:*",
    ]
    resources = [
      aws_s3_bucket.backup.arn,
      "${aws_s3_bucket.backup.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "backup" {
  bucket = aws_s3_bucket.backup.id
  policy = data.aws_iam_policy_document.backup_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.backup]
}
