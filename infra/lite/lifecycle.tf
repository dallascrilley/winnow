resource "aws_dynamodb_table" "control" {
  name         = "${local.name}-control"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }
}
resource "aws_scheduler_schedule_group" "lifecycle" {
  name = local.name
}

data "archive_file" "wake" {
  type        = "zip"
  source_file = "${path.module}/wake/handler.mjs"
  output_path = "${path.module}/wake-handler.zip"
}

resource "aws_lambda_function" "wake" {
  function_name    = "${local.name}-wake"
  role             = aws_iam_role.wake.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.wake.output_path
  source_code_hash = data.archive_file.wake.output_base64sha256

  memory_size                    = 128
  timeout                        = 15
  reserved_concurrent_executions = 1

  environment {
    variables = {
      CONTROL_TABLE_NAME     = aws_dynamodb_table.control.name
      FUNCTION_ARN           = "arn:${data.aws_partition.current.partition}:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${local.name}-wake"
      INSTANCE_ID            = aws_instance.origin.id
      STOP_SCHEDULE_GROUP    = aws_scheduler_schedule_group.lifecycle.name
      STOP_SCHEDULE_NAME     = "${local.name}-stop"
      STOP_SCHEDULE_ROLE_ARN = aws_iam_role.scheduler.arn
      WAKE_SECRET_PARAMETER  = aws_ssm_parameter.wake_secret.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.wake,
    aws_iam_role_policy.wake,
  ]
}

resource "aws_apigatewayv2_api" "wake" {
  name          = "${local.name}-wake"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "wake" {
  api_id                 = aws_apigatewayv2_api.wake.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.wake.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 15000
}

resource "aws_apigatewayv2_route" "wake" {
  api_id    = aws_apigatewayv2_api.wake.id
  route_key = "POST /wake"
  target    = "integrations/${aws_apigatewayv2_integration.wake.id}"
}

resource "aws_apigatewayv2_route" "status" {
  api_id    = aws_apigatewayv2_api.wake.id
  route_key = "GET /status"
  target    = "integrations/${aws_apigatewayv2_integration.wake.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.wake.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 2
    throttling_rate_limit  = 1
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.wake_api.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
    })
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowWakeHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.wake.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.wake.execution_arn}/*/*"
}
