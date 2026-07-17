variable "aws_region" {
  description = "AWS region for the isolated lite stack."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "ARM64 burstable host. Downsize only after the measured U4a memory gate passes."
  type        = string
  default     = "t4g.medium"

  validation {
    condition     = contains(["t4g.small", "t4g.medium"], var.instance_type)
    error_message = "instance_type must be t4g.medium or the explicitly qualified t4g.small."
  }
}

variable "root_volume_gib" {
  description = "Encrypted gp3 root volume size."
  type        = number
  default     = 30

  validation {
    condition     = var.root_volume_gib >= 30 && var.root_volume_gib <= 64
    error_message = "root_volume_gib must be between 30 and 64 GiB."
  }
}

variable "origin_hostname" {
  description = "Dedicated HTTPS origin hostname. This stack does not create or mutate its DNS record."
  type        = string
  default     = "inbound-origin.dallascrilley.com"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.origin_hostname))
    error_message = "origin_hostname must be a valid lowercase DNS hostname."
  }
}

variable "bootstrap_only" {
  description = "Permit an additive infrastructure bootstrap before a funded model key and immutable app image are ready."
  type        = bool
  default     = true
}

variable "openai_api_key" {
  description = "Optional hosted-inference key. Omit until the U2 credential and quota gate passes."
  type        = string
  sensitive   = true
  default     = ""
}

variable "initial_app_image_ref" {
  description = "Optional immutable app image ref. push-image.sh owns later updates to the SSM pointer."
  type        = string
  default     = "UNSET"

  validation {
    condition = (
      var.initial_app_image_ref == "UNSET" ||
      can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", var.initial_app_image_ref))
    )
    error_message = "initial_app_image_ref must be UNSET or an immutable ECR @sha256 reference."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly cost ceiling used for the project-tagged AWS Budget."
  type        = number
  default     = 10

  validation {
    condition     = var.monthly_budget_usd >= 5 && var.monthly_budget_usd <= 25
    error_message = "monthly_budget_usd must remain between $5 and $25."
  }
}

variable "budget_notification_email" {
  description = "Optional explicit budget subscriber. Leave blank to avoid external notifications during bootstrap."
  type        = string
  default     = ""

  validation {
    condition     = var.budget_notification_email == "" || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.budget_notification_email))
    error_message = "budget_notification_email must be blank or a valid email address."
  }
}
