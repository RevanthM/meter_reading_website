#!/usr/bin/env bash
# Print the newest Elastic Beanstalk solution stack for Node.js on Amazon Linux 2023.
# Usage: eb-resolve-platform.sh [22|24] [region]
set -euo pipefail

NODE_MAJOR="${1:-22}"
REGION="${2:-us-west-2}"

STACK=$(aws elasticbeanstalk list-available-solution-stacks \
  --region "${REGION}" \
  --query "SolutionStacks[?contains(@, \`64bit Amazon Linux 2023\`) && contains(@, \`Node.js ${NODE_MAJOR}\`)] | [0]" \
  --output text)

if [ -z "${STACK}" ] || [ "${STACK}" = "None" ]; then
  echo "No solution stack found for Node.js ${NODE_MAJOR} on AL2023 in ${REGION}." >&2
  exit 1
fi

echo "${STACK}"
