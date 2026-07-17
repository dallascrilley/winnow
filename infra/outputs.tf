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
