#!/usr/bin/env bash
# Read-only inventory of residual inbound-lite AWS leftovers.
# Does not create, modify, or destroy anything. Companion to RESIDUAL-AWS.md.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PREFIX="inbound-lite"

say() { printf '%s\n' "$*"; }
section() { printf '\n==> %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'ERROR: required command not found: %s\n' "$1" >&2
    exit 2
  }
}

require_cmd aws
require_cmd python3

section "caller"
aws sts get-caller-identity --output json

section "EC2 instances (Name contains ${PREFIX})"
aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=*${PREFIX}*" \
  --query 'Reservations[].Instances[].{id:InstanceId,state:State.Name,type:InstanceType,name:Tags[?Key==`Name`].Value|[0],launch:LaunchTime}' \
  --output table

section "Elastic IPs tagged project=${PREFIX}"
aws ec2 describe-addresses --region "$REGION" \
  --filters "Name=tag:project,Values=${PREFIX}" \
  --query 'Addresses[].{ip:PublicIp,alloc:AllocationId,instance:InstanceId,assoc:AssociationId}' \
  --output table

section "ECR repositories matching inbound"
aws ecr describe-repositories --region "$REGION" \
  --query 'repositories[?contains(repositoryName, `inbound`)].{name:repositoryName,uri:repositoryUri,created:createdAt}' \
  --output table

section "SSM parameters under /${PREFIX}"
aws ssm describe-parameters --region "$REGION" \
  --parameter-filters "Key=Name,Option=BeginsWith,Values=/${PREFIX}" \
  --query 'Parameters[].{Name:Name,Type:Type,LastModified:LastModifiedDate}' \
  --output table

section "Lambda functions matching inbound"
aws lambda list-functions --region "$REGION" \
  --query 'Functions[?contains(FunctionName, `inbound`)].{Name:FunctionName,Runtime:Runtime,LastModified:LastModified,Memory:MemorySize}' \
  --output table

section "API Gateway HTTP APIs matching inbound"
aws apigatewayv2 get-apis --region "$REGION" \
  --query 'Items[?contains(Name, `inbound`)].{Name:Name,ApiId:ApiId,Endpoint:ApiEndpoint}' \
  --output table

section "DynamoDB tables matching inbound"
aws dynamodb list-tables --region "$REGION" \
  --query 'TableNames[?contains(@, `inbound`)]' --output table

section "S3 buckets matching inbound"
aws s3api list-buckets --query 'Buckets[?contains(Name, `inbound`)].Name' --output table

section "CloudWatch log groups /${PREFIX} and /aws/lambda/${PREFIX}"
aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "/${PREFIX}" \
  --query 'logGroups[].{name:logGroupName,stored:storedBytes}' --output table
aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "/aws/lambda/${PREFIX}" \
  --query 'logGroups[].{name:logGroupName,stored:storedBytes}' --output table

section "IAM roles matching ${PREFIX}"
aws iam list-roles --query "Roles[?contains(RoleName, \`${PREFIX}\`)].RoleName" --output table

section "Security groups name contains ${PREFIX}"
aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=*${PREFIX}*" \
  --query 'SecurityGroups[].{id:GroupId,name:GroupName,vpc:VpcId}' --output table

section "Budgets matching ${PREFIX}"
aws budgets describe-budgets --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --query "Budgets[?contains(BudgetName, \`${PREFIX}\`)].{Name:BudgetName,Limit:BudgetLimit.Amount,Unit:BudgetLimit.Unit}" \
  --output table 2>/dev/null || say "(budgets API unavailable or none)"

section "interview-mode (inbound-demo) quick pulse — should be empty when down"
aws ecs list-clusters --region "$REGION" \
  --query 'clusterArns[?contains(@, `inbound-demo`)]' --output text || true
aws elbv2 describe-load-balancers --region "$REGION" \
  --query 'LoadBalancers[?contains(LoadBalancerName, `inbound`)].LoadBalancerName' --output text || true
aws rds describe-db-instances --region "$REGION" \
  --query 'DBInstances[?contains(DBInstanceIdentifier, `inbound`)].DBInstanceIdentifier' --output text || true

section "summary"
python3 - <<'PY'
print("Read-only inventory complete.")
print("Full teardown notes: infra/RESIDUAL-AWS.md")
print("Interview stack lifecycle: infra/interview.sh (inbound-demo only)")
PY
