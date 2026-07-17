output "wake_api_url" {
  description = "Server-to-server lifecycle endpoint. Every request still requires HMAC authentication."
  value       = aws_apigatewayv2_api.wake.api_endpoint
}
output "origin_ipv4" {
  description = "Elastic IPv4 address for direct-origin proof before DNS cutover."
  value       = aws_eip.origin.public_ip
}

output "instance_id" {
  description = "Lite EC2 instance controlled by the lifecycle Lambda."
  value       = aws_instance.origin.id
}

output "app_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "monthly_cost_formula" {
  value = "fixed: 30 GiB gp3 + 1 public IPv4; variable: ${var.instance_type} running hours + low-volume serverless/storage usage"
}
