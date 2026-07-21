data "aws_vpc" "default" {
  default = true
}
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "origin" {
  name_prefix = "${local.name}-"
  description = "Public HTTP/S only; administration uses SSM Session Manager"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP for direct proof and ACME"
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS origin traffic"
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Runtime package, ECR, SSM, logs, and model API access"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_eip" "origin" {
  domain = "vpc"
}

resource "aws_eip_association" "origin" {
  allocation_id = aws_eip.origin.id
  instance_id   = aws_instance.origin.id
}
