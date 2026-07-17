resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public ALB - 443 from anywhere"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group_rule" "alb_https_in" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.alb.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "alb_http_in" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.alb.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "alb_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.alb.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_acm_certificate" "demo" {
  domain_name       = var.demo_hostname
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb" "app" {
  name               = local.name
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
}

resource "aws_lb_target_group" "app" {
  name        = local.name
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id
  health_check {
    path                = "/healthz"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
  # Cold boots (migrations + ollama model load) can outlast a short deregistration delay.
  deregistration_delay = 60
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  # Before the cert validates (operator DNS step), serve the app over plain
  # HTTP on the ALB dns name. After, redirect everything to HTTPS.
  dynamic "default_action" {
    for_each = var.cert_validated ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
  dynamic "default_action" {
    for_each = var.cert_validated ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.app.arn
    }
  }
}

# ACM rejects pending certs on listeners, so HTTPS exists only after the cert
# validates: apply once (HTTP), add the DNS records from
# `terraform output dns_records_to_create`, wait for the cert to issue in the
# ACM console, then re-apply with `-var cert_validated=true`.
resource "aws_lb_listener" "https" {
  count             = var.cert_validated ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.demo.arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      status_code  = "404"
      message_body = "no demo mounted at this path"
    }
  }
}

resource "aws_lb_listener_rule" "inbound_http" {
  count        = var.cert_validated ? 0 : 1
  listener_arn = aws_lb_listener.http.arn
  priority     = 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
  condition {
    path_pattern {
      values = ["${var.public_prefix}", "${var.public_prefix}/*"]
    }
  }
}

resource "aws_lb_listener_rule" "inbound_https" {
  count        = var.cert_validated ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
  condition {
    path_pattern {
      values = ["${var.public_prefix}", "${var.public_prefix}/*"]
    }
  }
}
