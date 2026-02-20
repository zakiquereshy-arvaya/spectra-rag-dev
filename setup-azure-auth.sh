#!/usr/bin/env bash
#
# Configures Entra ID auth for arvaya-prod and/or arvaya-dev Azure Web Apps.
# Loads AUTH_* from .env. Run from project root after web apps exist.
#
# Usage: ./setup-azure-auth.sh [.env] [app]
#   Default: configures both arvaya-prod and arvaya-dev
#   Examples:
#     ./setup-azure-auth.sh              # both apps
#     ./setup-azure-auth.sh .env arvaya-dev   # dev only

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

for key in AUTH_MICROSOFT_ENTRA_ID_ID AUTH_MICROSOFT_ENTRA_ID_SECRET AUTH_MICROSOFT_ENTRA_ID_TENANT_ID AUTH_SECRET; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: ${key}"
    exit 1
  fi
done

configure_app() {
  local app="$1"
  local host
  host=$(az webapp show -g "$RG" -n "$app" --query defaultHostName -o tsv)
  echo "Configuring auth for $app (https://${host})..."

  echo "  Ensuring auth v2..."
  az config set extension.use_dynamic_install=yes_without_prompt 2>/dev/null || true
  az webapp auth config-version upgrade -g "$RG" -n "$app" 2>/dev/null || true

  echo "  Setting Entra identity provider..."
  az webapp auth microsoft update -g "$RG" -n "$app" --yes \
    --client-id "$AUTH_MICROSOFT_ENTRA_ID_ID" \
    --client-secret "$AUTH_MICROSOFT_ENTRA_ID_SECRET" \
    --issuer "https://login.microsoftonline.com/${AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0"

  echo "  Setting app settings..."
  az webapp config appsettings set -g "$RG" -n "$app" --settings \
    AUTH_URL="https://${host}" \
    AUTH_SECRET="$AUTH_SECRET" \
    AUTH_MICROSOFT_ENTRA_ID_ID="$AUTH_MICROSOFT_ENTRA_ID_ID" \
    AUTH_MICROSOFT_ENTRA_ID_SECRET="$AUTH_MICROSOFT_ENTRA_ID_SECRET" \
    AUTH_MICROSOFT_ENTRA_ID_TENANT_ID="$AUTH_MICROSOFT_ENTRA_ID_TENANT_ID" \
    AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/${AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0" \
    --output none

  echo "$host"
}

# Build redirect URIs: include configured app(s) + localhost
NEW_URIS=("http://localhost:5173/auth/callback/microsoft-entra-id")

if [[ -z "$TARGET_APP" ]]; then
  PROD=$(configure_app arvaya-prod)
  NEW_URIS+=(
    "https://${PROD}/.auth/login/aad/callback"
    "https://${PROD}/auth/callback/microsoft-entra-id"
  )
  DEV=$(configure_app arvaya-dev)
  NEW_URIS+=(
    "https://${DEV}/.auth/login/aad/callback"
    "https://${DEV}/auth/callback/microsoft-entra-id"
  )
else
  HOST=$(configure_app "$TARGET_APP")
  NEW_URIS+=(
    "https://${HOST}/.auth/login/aad/callback"
    "https://${HOST}/auth/callback/microsoft-entra-id"
  )
  # When targeting one app, only set that app's URIs + localhost (avoids merge issues).
  # To preserve prod URIs, set EXTRA_REDIRECT_URIS="https://arvaya-prod.azurewebsites.net/..."
fi

if [[ -n "${EXTRA_REDIRECT_URIS:-}" ]]; then
  read -ra EXTRA <<< "$EXTRA_REDIRECT_URIS"
  NEW_URIS+=("${EXTRA[@]}")
fi

# Dedupe and filter invalid URIs
UNIQUE_URIS=()
for u in "${NEW_URIS[@]}"; do
  [[ -z "${u:-}" || "$u" == "None" || "$u" == "null" ]] && continue
  [[ "$u" != http://* && "$u" != https://* ]] && continue
  [[ " ${UNIQUE_URIS[*]:-} " == *" ${u} "* ]] && continue
  UNIQUE_URIS+=("$u")
done

echo "Updating Entra app redirect URIs (${#UNIQUE_URIS[@]} URIs)..."
# Use Microsoft Graph API (az ad app update often fails with "Invalid value for property web")
APP_OBJECT_ID=$(az ad app show --id "$AUTH_MICROSOFT_ENTRA_ID_ID" --query id -o tsv)
URIS_JSON="["
first=1
for u in "${UNIQUE_URIS[@]}"; do
  [[ $first -eq 0 ]] && URIS_JSON+=","
  escaped="${u//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  URIS_JSON+="\"${escaped}\""
  first=0
done
URIS_JSON+="]"
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/${APP_OBJECT_ID}" \
  --body "{\"web\":{\"redirectUris\":${URIS_JSON}}}" \
  --headers "Content-Type=application/json"

echo "Done. Auth configured for ${TARGET_APP:-prod and dev}."
