#!/usr/bin/env bash
set -euo pipefail

# Rotate the Firebase Admin SDK service-account key for EMS.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated as a project owner/editor
#   - IAM permission: Service Account Key Admin (or Owner) on emss-4fd81
#
# This script:
#   1. Creates a new key for firebase-adminsdk-fbsvc@emss-4fd81.iam.gserviceaccount.com
#   2. Prints the new JSON so it can be pasted into Render (FIREBASE_SERVICE_ACCOUNT_JSON)
#   3. Revokes the leaked key 6b0da3db14
#   4. Lists remaining active keys for verification
#
# Security notes:
#   - Never commit the new JSON to git.
#   - Delete the local file immediately after updating Render.
#   - The old key is revoked only after the new key has been created.

PROJECT_ID="emss-4fd81"
SERVICE_ACCOUNT="firebase-adminsdk-fbsvc@emss-4fd81.iam.gserviceaccount.com"
OLD_KEY_ID="6b0da3db14"
NEW_KEY_FILE="emss-4fd81-firebase-adminsdk-fbsvc-new.json"

echo "==> Target project: ${PROJECT_ID}"
echo "==> Target service account: ${SERVICE_ACCOUNT}"
echo "==> Leaked key to revoke: ${OLD_KEY_ID}"
echo ""

# Safety guard: require explicit project confirmation for production IAM mutation.
if [[ "${GOOGLE_CLOUD_PROJECT:-}" != "${PROJECT_ID}" ]]; then
  echo "WARNING: This script mutates production IAM for project '${PROJECT_ID}'."
  echo "Set GOOGLE_CLOUD_PROJECT=${PROJECT_ID} to skip this prompt, or confirm below."
  read -r -p "Are you sure you want to continue? [y/N] " confirm
  if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Verify gcloud is available
if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI not found. Install it first: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Verify authentication
echo "==> Checking gcloud authentication..."
gcloud auth list --filter=status:ACTIVE --format="value(account)"
echo ""

# List existing keys
echo "==> Current keys for ${SERVICE_ACCOUNT}:"
gcloud iam service-accounts keys list \
  --iam-account="${SERVICE_ACCOUNT}" \
  --project="${PROJECT_ID}" \
  --managed-by="user" \
  --format="table(keyId, validAfterTime, validBeforeTime)"
echo ""

# Create new key FIRST to avoid a credential gap.
echo "==> Creating new private key: ${NEW_KEY_FILE}"
gcloud iam service-accounts keys create "${NEW_KEY_FILE}" \
  --iam-account="${SERVICE_ACCOUNT}" \
  --project="${PROJECT_ID}"
echo ""

# Show the new key JSON (one line) for Render env var
echo "==> New FIREBASE_SERVICE_ACCOUNT_JSON value (one-line, for Render):"
python3 -c "import json,sys; print(json.dumps(json.load(open('${NEW_KEY_FILE}'))))"
echo ""

# Revoke old key only after the new key has been created and printed.
echo "==> Revoking leaked key ${OLD_KEY_ID}..."
if gcloud iam service-accounts keys list \
     --iam-account="${SERVICE_ACCOUNT}" \
     --project="${PROJECT_ID}" \
     --managed-by="user" \
     --format="value(keyId)" | grep -qx "${OLD_KEY_ID}"; then
  gcloud iam service-accounts keys delete "${OLD_KEY_ID}" \
    --iam-account="${SERVICE_ACCOUNT}" \
    --project="${PROJECT_ID}" \
    --quiet
  echo "Key ${OLD_KEY_ID} revoked."
else
  echo "Key ${OLD_KEY_ID} not found (already revoked or ID changed)."
fi
echo ""

echo "==> Next steps:"
echo "  1. Copy the one-line JSON above."
echo "  2. Open Render Dashboard > school-backend > Environment > FIREBASE_SERVICE_ACCOUNT_JSON"
echo "  3. Paste the new value and save."
echo "  4. Repeat for any other Render services that use Firebase (cron jobs, etc.)."
echo "  5. Trigger a manual deploy or push to main to restart the services."
echo "  6. Verify /health returns 200 and parent OTP/push notifications work."
echo "  7. Securely delete ${NEW_KEY_FILE}:"
case "$(uname -s)" in
  Darwin)
    echo "       rm -P ${NEW_KEY_FILE}"
    ;;
  Linux)
    echo "       shred -u ${NEW_KEY_FILE}"
    ;;
  *)
    echo "       rm ${NEW_KEY_FILE}   (then empty the trash/recycle bin)"
    ;;
esac
echo ""

echo "==> Remaining active keys:"
gcloud iam service-accounts keys list \
  --iam-account="${SERVICE_ACCOUNT}" \
  --project="${PROJECT_ID}" \
  --managed-by="user" \
  --format="table(keyId, validAfterTime, validBeforeTime)"
