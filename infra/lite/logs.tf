resource "aws_cloudwatch_log_group" "runtime" {
  name              = "/${local.name}/runtime"
  retention_in_days = 14
}
resource "aws_cloudwatch_log_group" "wake" {
  name              = "/aws/lambda/${local.name}-wake"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "wake_api" {
  name              = "/${local.name}/wake-api"
  retention_in_days = 14
}
