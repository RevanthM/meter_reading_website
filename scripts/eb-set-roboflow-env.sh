#!/usr/bin/env bash
# Set Roboflow env vars on Elastic Beanstalk (requires elasticbeanstalk:UpdateEnvironment).
# Usage:
#   export ROBOFLOW_API_KEY='your_key'
#   export ROBOFLOW_WORKSPACE='analoggasmeter'   # optional
#   ./scripts/eb-set-roboflow-env.sh meter-reading-prod
set -euo pipefail

ENV_NAME="${1:-meter-reading-prod}"
REGION="${AWS_REGION:-us-west-2}"

if [ -z "${ROBOFLOW_API_KEY:-}" ]; then
  echo "Set ROBOFLOW_API_KEY in the environment (same as src/.env)." >&2
  exit 1
fi

WORKSPACE="${ROBOFLOW_WORKSPACE:-analoggasmeter}"

aws elasticbeanstalk update-environment \
  --region "$REGION" \
  --environment-name "$ENV_NAME" \
  --option-settings \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ROBOFLOW_API_KEY,Value=${ROBOFLOW_API_KEY}" \
    "Namespace=aws:elasticbeanstalk:application:environment,OptionName=ROBOFLOW_WORKSPACE,Value=${WORKSPACE}"

echo "Waiting for $ENV_NAME…"
aws elasticbeanstalk wait environment-updated --region "$REGION" --environment-names "$ENV_NAME"

CNAME=$(aws elasticbeanstalk describe-environments \
  --region "$REGION" \
  --environment-names "$ENV_NAME" \
  --query 'Environments[0].CNAME' --output text)

echo "Check: curl -sS http://${CNAME}/api/health"
