variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "demo_hostname" {
  type    = string
  default = "demos.dallascrilley.com"
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
}

variable "openai_api_key" {
  description = "Optional — funding a key flips scoring from local ollama to hosted gpt-5-mini (QUALIFY_LLM_PROVIDER=openai)."
  type        = string
  sensitive   = true
  default     = ""
}
