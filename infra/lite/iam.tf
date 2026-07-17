data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}
resource "aws_iam_role" "origin" {
  name_prefix        = "${local.name}-origin-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_instance_profile" "origin" {
  name_prefix = "${local.name}-"
  role        = aws_iam_role.origin.name
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.origin.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "origin_runtime" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PullAppImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid     = "ReadRuntimeParameters"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = concat([
      aws_ssm_parameter.database_password.arn,
      aws_ssm_parameter.better_auth_secret.arn,
      aws_ssm_parameter.a2a_secret.arn,
      aws_ssm_parameter.analytics_public_key.arn,
      aws_ssm_parameter.app_image_ref.arn,
    ], aws_ssm_parameter.openai_api_key[*].arn)
  }

  statement {
    sid = "WriteRuntimeLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.runtime.arn}:*"]
  }
}

resource "aws_iam_role_policy" "origin_runtime" {
  name_prefix = "runtime-"
  role        = aws_iam_role.origin.id
  policy      = data.aws_iam_policy_document.origin_runtime.json
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "wake" {
  name_prefix        = "${local.name}-wake-"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "wake" {
  statement {
    sid       = "WriteFunctionLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.wake.arn}:*"]
  }

  statement {
    sid       = "DescribeExactInstance"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  statement {
    sid     = "ControlTaggedLiteInstance"
    actions = ["ec2:StartInstances", "ec2:StopInstances"]
    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.origin.id}",
    ]
    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/project"
      values   = [local.name]
    }
  }

  statement {
    sid       = "UseReplayAndLeaseTable"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.control.arn]
  }

  statement {
    sid       = "ReadWakeSecret"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.wake_secret.arn]
  }

  statement {
    sid       = "RenewNamedStopSchedule"
    actions   = ["scheduler:CreateSchedule", "scheduler:UpdateSchedule"]
    resources = ["arn:${data.aws_partition.current.partition}:scheduler:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.lifecycle.name}/${local.name}-stop"]
  }

  statement {
    sid       = "PassOnlySchedulerRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.scheduler.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "wake" {
  name_prefix = "control-"
  role        = aws_iam_role.wake.id
  policy      = data.aws_iam_policy_document.wake.json
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name_prefix        = "${local.name}-scheduler-"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.wake.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name_prefix = "invoke-"
  role        = aws_iam_role.scheduler.id
  policy      = data.aws_iam_policy_document.scheduler_invoke.json
}
