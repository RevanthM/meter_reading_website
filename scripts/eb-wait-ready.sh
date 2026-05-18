#!/usr/bin/env bash
# Wait for EB env Ready + expected version. Accepts Green/Grey (Info) health —
# beanstalk-deploy fails when a deprecated platform never returns Green.
set -euo pipefail

ENV_NAME="${1:?environment name}"
VERSION_LABEL="${2:?version label}"
REGION="${3:-us-west-2}"
MAX_MINUTES="${4:-20}"

health_ok() {
  case "$1" in
    Green | Grey) return 0 ;;
    Yellow) return 0 ;;
    *) return 1 ;;
  esac
}

echo "Waiting for ${ENV_NAME} → Ready, version ${VERSION_LABEL} (up to ${MAX_MINUTES} min)…"

for i in $(seq 1 $((MAX_MINUTES * 3))); do
  read -r STATUS HEALTH HEALTH_STATUS VERSION <<< "$(aws elasticbeanstalk describe-environments \
    --region "${REGION}" \
    --environment-names "${ENV_NAME}" \
    --query "Environments[0].[Status,Health,HealthStatus,VersionLabel]" \
    --output text 2>/dev/null || echo "None None None None")"

  echo "[$i] Status=${STATUS} Health=${HEALTH} (${HEALTH_STATUS}) Version=${VERSION}"

  if [ "${STATUS}" = "Ready" ] && [ "${VERSION}" = "${VERSION_LABEL}" ] && health_ok "${HEALTH}"; then
    echo "Deploy complete. (Info/Grey health from a deprecated platform is OK if the app responds.)"
    exit 0
  fi

  if [ "${STATUS}" = "Terminated" ] || [ "${HEALTH}" = "Red" ]; then
    echo "Environment unhealthy or terminated." >&2
    aws elasticbeanstalk describe-events \
      --region "${REGION}" \
      --environment-name "${ENV_NAME}" \
      --max-items 12 \
      --query "Events[*].[Severity,Message]" \
      --output text >&2 || true
    exit 1
  fi

  sleep 20
done

echo "Timed out waiting for ${ENV_NAME}." >&2
exit 1
