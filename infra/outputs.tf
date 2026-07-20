output "app_image" {
  value = "${aws_ecr_repository.app.repository_url}:latest"
}

output "ollama_image" {
  value = "${aws_ecr_repository.ollama.repository_url}:latest"
}

output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "public_url" {
  value = local.public_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service" {
  value = aws_ecs_service.app.name
}

output "public_prefix" {
  description = "URL path prefix the demo is served under (e.g. /inbound) — used to build health-check and smoke URLs against the raw ALB DNS name before cert_validated=true."
  value       = var.public_prefix
}

output "task_subnets" {
  description = "Default-VPC subnet ids the ECS service's tasks run in — required by `aws ecs run-task` (e.g. the one-off prod-seed task); these change on every destroy/re-apply, never hardcode them."
  value       = data.aws_subnets.default.ids
}

output "tasks_security_group" {
  description = "Security group id attached to ECS tasks — required by `aws ecs run-task`'s network-configuration; changes on every destroy/re-apply, never hardcode it."
  value       = aws_security_group.tasks.id
}

output "dns_records_to_create" {
  description = "Operator step when manage_dns=false: ACM validation CNAME(s) + the demos CNAME to the ALB."
  value = merge(
    {
      for dvo in aws_acm_certificate.demo.domain_validation_options :
      "cert-validation (${dvo.domain_name})" => "${dvo.resource_record_type} ${dvo.resource_record_name} -> ${dvo.resource_record_value}"
    },
    { "demo" = "CNAME ${var.demo_hostname} -> ${aws_lb.app.dns_name}" },
  )
}
