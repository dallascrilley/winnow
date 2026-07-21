variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "demo_hostname" {
  type    = string
  default = "inbound-standard-origin.dallascrilley.com"
}

variable "public_prefix" {
  description = "URL path prefix the demo is served under (ALB forwards it; the container proxy strips it)."
  type        = string
  default     = "/inbound"
}

variable "cloudflare_zone_name" {
  type    = string
  default = "dallascrilley.com"
}

variable "cloudflare_api_token" {
  # The provider schema validates token format (and non-emptiness) even when
  # no zone resources exist — the default dummy satisfies it; pass the real
  # token via TF_VAR_cloudflare_api_token only with manage_dns=true.
  type      = string
  sensitive = true
  default   = "unused_dummy_token_0000000000000000000000000"
}

variable "manage_dns" {
  description = "Set true only with a Cloudflare token that can see the zone; otherwise DNS records are printed as outputs for manual creation."
  type        = bool
  default     = false
}

variable "cert_validated" {
  description = "Flip to true after the operator DNS records validate the ACM cert (see dns_records_to_create output). Creates the HTTPS listener and redirects HTTP."
  type        = bool
  default     = false
}

variable "db_password" {
  type      = string
  sensitive = true
  # Interpolated raw into the postgres:// URL in ssm.tf — URL-reserved chars
  # (@ : / ? # % &) would corrupt it.
  validation {
    condition     = can(regex("^[A-Za-z0-9._~!$'()*+,;=-]+$", var.db_password))
    error_message = "db_password must be URL-safe: letters, digits, and ._~!$'()*+,;=- only."
  }
}

variable "openai_api_key" {
  description = "Optional — funding a key flips scoring from local ollama to hosted gpt-5-mini (QUALIFY_LLM_PROVIDER=openai)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "app_image_ref" {
  description = "Immutable ECR app reference from scripts/push-app-image.sh. Empty is bootstrap-only before the first image push."
  type        = string
  default     = ""
  validation {
    condition     = var.app_image_ref == "" || can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", var.app_image_ref))
    error_message = "app_image_ref must be empty for bootstrap or an immutable ECR @sha256 reference."
  }
}

variable "ollama_image_ref" {
  description = "Immutable ECR Ollama reference from infra/push-images.sh. Empty is bootstrap-only before the first image push."
  type        = string
  default     = ""
  validation {
    condition     = var.ollama_image_ref == "" || can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", var.ollama_image_ref))
    error_message = "ollama_image_ref must be empty for bootstrap or an immutable ECR @sha256 reference."
  }
}

variable "bootstrap_images" {
  description = "Create infrastructure and ECR repositories with ECS scaled to zero before the first image push. Never use for a running deployment."
  type        = bool
  default     = false
}
