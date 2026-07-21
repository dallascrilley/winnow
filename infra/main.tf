terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # Local state — demo project. `terraform apply` from a clean checkout is the
  # acceptance bar; state lives at infra/terraform.tfstate (gitignored).
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      project = "inbound-lead-router"
      demo    = "true"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  name             = "inbound-demo"
  public_url       = "https://${var.demo_hostname}${var.public_prefix}"
  apps             = ["analytics", "dispatch", "forms", "qualify", "scheduler"]
  app_image_ref    = var.app_image_ref != "" ? var.app_image_ref : "${aws_ecr_repository.app.repository_url}:latest"
  ollama_image_ref = var.ollama_image_ref != "" ? var.ollama_image_ref : "${aws_ecr_repository.ollama.repository_url}:latest"
}
