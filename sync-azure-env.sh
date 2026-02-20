#!/usr/bin/env bash
#
# Syncs env vars from .env to arvaya-prod and arvaya-dev Azure Web Apps.
# Loads .env, builds app settings from whitelist, sets AUTH_URL per app.
#
# Usage: ./sync-azure-env.sh [.env] [app]
#   Default: .env, both arvaya-prod and arvaya-dev
#   Examples:
#     ./sync-azure-env.sh              # sync all from .env to both apps
#     ./sync-azure-env.sh .env arvaya-dev   # sync to dev only

set -euo pipefail

RG="${RG:-arvaya-rg}"
ENV_FILE="${1:-.env}"
TARGET_APP="${2:-}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# Whitelist of vars to sync (add/remove as needed)
VARS=(
  AUTH_SECRET
  AUTH_MICROSOFT_ENTRA_ID_ID
  AUTH_MICROSOFT_ENTRA_ID_SECRET
  AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
  AUTH_MICROSOFT_ENTRA_ID_ISSUER
  COHERE_API_KEY
  PINECONE_API_KEY
  PINECONE_INDEX_NAME
  BILLI_WEBHOOK_URL
  BILLI_DEV_WEBHOOK_URL
  PUBLIC_SUPABASE_URL
  PUBLIC_SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  AZERO_DATABASE_URL
  FF_API_KEY
  VECTOR_DATABASE_URL
  OPENAI_API_KEY
  PUBLIC_N8N_CHAT_WH_URL
  N8N_INGESTION_URL
  N8N_TEST_BILLI_WEBHOOK_URL
  AZURE_ENDPOINT
  AZURE_API_KEY
  AZURE_EXISTING_AGENT_ID
  AZURE_ENV_NAME
  AZURE_LOCATION
  AZURE_EXISTING_AIPROJECT_ENDPOINT
  AZURE_EXISTING_AIPROJECT_RESOURCE_ID
  AZURE_EXISTING_RESOURCE_ID
  AZURE_SUBSCRIPTION_ID
  AZD_ALLOW_NON_EMPTY_FOLDER
  AZURE_BOX_AGENT_ID
)

sync_app() {
  local app="$1"
  local host
  host=$(az webapp show -g "$RG" -n "$app" --query defaultHostName -o tsv)
  echo "Syncing to $app (https://${host})..."

  SETTINGS=()
  for key in "${VARS[@]}"; do
    val="${!key:-}"
    [[ -z "$val" ]] && continue
    SETTINGS+=("${key}=${val}")
  done
  SETTINGS+=("AUTH_URL=https://${host}")

  az webapp config appsettings set -g "$RG" -n "$app" --settings "${SETTINGS[@]}" --output none
  echo "  Synced ${#SETTINGS[@]} settings."
}

if [[ -n "$TARGET_APP" ]]; then
  sync_app "$TARGET_APP"
else
  sync_app arvaya-prod
  sync_app arvaya-dev
fi

echo "Done."
