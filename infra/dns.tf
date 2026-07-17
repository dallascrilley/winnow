# DNS is OPTIONAL (var.manage_dns): no 1Password Cloudflare credential can see
# the dallascrilley.com zone (checked all four CF items — zone lives in a
# separate personal account). With manage_dns=false the apply completes with
# the ACM cert pending and `terraform output dns_records_to_create` prints the
# two records for the operator; the site goes live when they're added. With a
# zone-capable token, set manage_dns=true for full automation.

data "cloudflare_zone" "main" {
  count = var.manage_dns ? 1 : 0
  name  = var.cloudflare_zone_name
}

resource "cloudflare_record" "cert_validation" {
  for_each = var.manage_dns ? {
    for dvo in aws_acm_certificate.demo.domain_validation_options :
    dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}
  zone_id = data.cloudflare_zone.main[0].id
  name    = each.value.name
  type    = each.value.type
  content = each.value.value
  ttl     = 60
  proxied = false
}

resource "aws_acm_certificate_validation" "demo" {
  count                   = var.manage_dns ? 1 : 0
  certificate_arn         = aws_acm_certificate.demo.arn
  validation_record_fqdns = [for r in cloudflare_record.cert_validation : r.hostname]
}

# DNS-only (grey cloud): TLS terminates at the ALB with the ACM cert, so the
# demo has no Cloudflare plan dependency and no proxy header semantics.
resource "cloudflare_record" "demo" {
  count   = var.manage_dns ? 1 : 0
  zone_id = data.cloudflare_zone.main[0].id
  name    = var.demo_hostname
  type    = "CNAME"
  content = aws_lb.app.dns_name
  ttl     = 60
  proxied = false
}
