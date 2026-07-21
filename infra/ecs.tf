resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "ECS Fargate tasks - ALB inbound, all egress (ECR pull, RDS, LLM-free egress)"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group_rule" "tasks_from_alb" {
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  security_group_id        = aws_security_group.tasks.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "tasks_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.tasks.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_ssm" {
  name = "read-ssm-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["ssm:GetParameters"]
      Resource = concat(
        [for k, v in aws_ssm_parameter.secrets : v.arn],
        var.openai_api_key != "" ? [aws_ssm_parameter.openai_api_key[0].arn] : [],
      )
    }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 8192
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  lifecycle {
    precondition {
      condition = var.bootstrap_images || (
        startswith(var.app_image_ref, "${aws_ecr_repository.app.repository_url}@sha256:") &&
        startswith(var.ollama_image_ref, "${aws_ecr_repository.ollama.repository_url}@sha256:")
      )
      error_message = "Running ECS requires immutable refs from this stack's app and Ollama ECR repositories. Use bootstrap_images=true only while ECS is scaled to zero before the first push."
    }
  }

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = local.app_image_ref
      essential = true
      portMappings = [{
        containerPort = 8080
        protocol      = "tcp"
      }]
      environment = [
        { name = "WORKSPACE_PORT", value = "8080" },
        { name = "WORKSPACE_PUBLIC_PREFIX", value = var.public_prefix },
        { name = "WORKSPACE_GATEWAY_URL", value = "http://127.0.0.1:8080" },
        { name = "DATABASE_SSLMODE", value = "require" },
        { name = "APP_URL", value = local.public_url },
        { name = "BETTER_AUTH_URL", value = local.public_url },
        { name = "PUBLIC_URL", value = local.public_url },
        { name = "WORKSPACE_ORG_NAME", value = "Inbound Demo" },
        { name = "WORKSPACE_ORG_DOMAIN", value = "inbound-demo.test" },
        { name = "WORKSPACE_ORG_OWNER_EMAIL", value = "demo@inbound-demo.test" },
        { name = "DISPATCH_DEFAULT_OWNER_EMAIL", value = "demo@inbound-demo.test" },
        { name = "AGENT_USER_EMAIL", value = "demo@inbound-demo.test" },
        { name = "AGENT_ENGINE", value = "ai-sdk:ollama" },
        { name = "QUALIFY_LLM_PROVIDER", value = "ollama" },
        { name = "QUALIFY_LLM_MODEL", value = "qwen3:4b" },
        { name = "OLLAMA_BASE_URL", value = "http://localhost:11434" },
        { name = "ANALYTICS_TRACK_URL", value = "http://127.0.0.1:8080/analytics/track" },
      ]
      secrets = concat(
        [for k, v in aws_ssm_parameter.secrets : { name = k, valueFrom = v.arn }],
        var.openai_api_key != "" ? [{ name = "OPENAI_API_KEY", valueFrom = aws_ssm_parameter.openai_api_key[0].arn }] : [],
      )
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "app"
        }
      }
      dependsOn = [{
        containerName = "ollama"
        condition     = "START"
      }]
    },
    {
      name      = "ollama"
      image     = local.ollama_image_ref
      essential = false
      # Model is baked into the image at build time (scripts/push-images.sh);
      # qwen3:4b Q4 needs ~4 GB of the task's 8 GB.
      portMappings = [{
        containerPort = 11434
        protocol      = "tcp"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ollama"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name            = local.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.bootstrap_images ? 0 : 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 8080
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]
}
