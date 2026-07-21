output "bucket_name" {
  description = "Deterministic private bucket used by the lite S3 backend."
  value       = aws_s3_bucket.state.id
}

output "aws_account_id" {
  description = "Account allowed by the generated backend configuration."
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Region hosting the state bucket."
  value       = var.aws_region
}
