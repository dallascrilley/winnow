resource "random_password" "better_auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "a2a_secret" {
  length  = 48
  special = false
}

# Pre-generated analytics write key: the prod seed inserts this exact value
# into analytics_public_keys, and qualify reads it from env — no chicken-egg.
resource "random_password" "analytics_public_key" {
  length  = 48
  special = false
}

locals {
  secret_values = {
    BETTER_AUTH_SECRET   = random_password.better_auth_secret.result
    A2A_SECRET           = random_password.a2a_secret.result
    ANALYTICS_PUBLIC_KEY = "anpk_${random_password.analytics_public_key.result}"
    DATABASE_URL_BASE    = "postgres://inbound:${var.db_password}@${aws_db_instance.main.address}:5432"
  }
}

resource "aws_ssm_parameter" "secrets" {
  for_each = local.secret_values
  name     = "/${local.name}/${each.key}"
  type     = "SecureString"
  value    = each.value
}

# Optional: only created (and injected) when a funded key exists.
resource "aws_ssm_parameter" "openai_api_key" {
  count = var.openai_api_key != "" ? 1 : 0
  name  = "/${local.name}/OPENAI_API_KEY"
  type  = "SecureString"
  value = var.openai_api_key
}
