#!/usr/bin/env bash
# Apply EB option-settings only when values differ (avoids post-deploy restarts).
# Usage: eb-sync-env-if-changed.sh <env_name> <region> <application_name> <settings.json>
set -euo pipefail

ENV_NAME="${1:?environment name}"
REGION="${2:?region}"
APP_NAME="${3:?application name}"
SETTINGS_FILE="${4:?settings json path}"

if [ ! -f "${SETTINGS_FILE}" ]; then
  echo "Settings file not found: ${SETTINGS_FILE}" >&2
  exit 1
fi

CURRENT_JSON=$(aws elasticbeanstalk describe-configuration-settings \
  --region "${REGION}" \
  --application-name "${APP_NAME}" \
  --environment-name "${ENV_NAME}" \
  --output json)

CHANGES=$(jq -c --argjson current "${CURRENT_JSON}" --slurpfile desired "${SETTINGS_FILE}" '
  ($current.ConfigurationSettings[0].OptionSettings // []) as $opts |
  [ $desired[0][] | . as $d |
      ($opts | map(select(.Namespace == $d.Namespace and .OptionName == $d.OptionName)) | .[0].Value // "") as $cur |
      select($cur != $d.Value) | $d
    ]
')

if [ "$(echo "${CHANGES}" | jq length)" -eq 0 ]; then
  echo "All environment variables already match — skipping update-environment (no extra restart)."
  exit 0
fi

echo "Updating $(echo "${CHANGES}" | jq length) environment variable(s):"
echo "${CHANGES}" | jq -r '.[] | "- \(.OptionName): \(.Value)"'

CHANGES_FILE="$(mktemp)"
echo "${CHANGES}" | jq '.' > "${CHANGES_FILE}"

aws elasticbeanstalk update-environment \
  --region "${REGION}" \
  --environment-name "${ENV_NAME}" \
  --option-settings "file://${CHANGES_FILE}"

rm -f "${CHANGES_FILE}"

aws elasticbeanstalk wait environment-updated \
  --region "${REGION}" \
  --environment-names "${ENV_NAME}"

echo "Environment variables synced."
