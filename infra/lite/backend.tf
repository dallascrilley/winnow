terraform {
  backend "s3" {
    key          = "lite/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
