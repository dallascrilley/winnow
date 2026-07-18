resource "random_password" "database" {
  length  = 40
  special = false
}
resource "random_password" "better_auth" {
  length  = 64
  special = false
}

resource "random_password" "a2a" {
  length  = 64
  special = false
}

resource "random_password" "analytics_public_key" {
  length  = 40
  special = false
}

resource "random_password" "wake" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "database_password" {
  name  = "/${local.name}/DATABASE_PASSWORD"
  type  = "SecureString"
  value = random_password.database.result
}

resource "aws_ssm_parameter" "better_auth_secret" {
  name  = "/${local.name}/BETTER_AUTH_SECRET"
  type  = "SecureString"
  value = random_password.better_auth.result
}

resource "aws_ssm_parameter" "a2a_secret" {
  name  = "/${local.name}/A2A_SECRET"
  type  = "SecureString"
  value = random_password.a2a.result
}

resource "aws_ssm_parameter" "analytics_public_key" {
  name  = "/${local.name}/ANALYTICS_PUBLIC_KEY"
  type  = "SecureString"
  value = "pk_${random_password.analytics_public_key.result}"
}

resource "aws_ssm_parameter" "wake_secret" {
  name  = "/${local.name}/WAKE_SECRET"
  type  = "SecureString"
  value = random_password.wake.result
}

resource "aws_ssm_parameter" "app_image_ref" {
  name  = "/${local.name}/APP_IMAGE_REF"
  type  = "String"
  value = var.initial_app_image_ref

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "app_git_sha" {
  name  = "/${local.name}/APP_GIT_SHA"
  type  = "String"
  value = var.initial_app_git_sha

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "openai_api_key" {
  count = var.openai_api_key == "" ? 0 : 1
  name  = "/${local.name}/OPENAI_API_KEY"
  type  = "SecureString"
  value = var.openai_api_key
}
