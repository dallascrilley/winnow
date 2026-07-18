variable "aws_region" {
  description = "AWS region for the lite Terraform state bucket."
  type        = string
  default     = "us-east-1"
}

variable "operator_principal_arn" {
  description = "Exact IAM user or role ARN allowed to read and write lite state. STS assumed-role ARNs are not accepted."
  type        = string

  validation {
    condition     = can(regex("^arn:(aws|aws-us-gov|aws-cn):iam::[0-9]{12}:(user|role)/[A-Za-z0-9+=,.@_/-]+$", var.operator_principal_arn))
    error_message = "operator_principal_arn must be an IAM user or role ARN, not an STS session ARN."
  }
}
