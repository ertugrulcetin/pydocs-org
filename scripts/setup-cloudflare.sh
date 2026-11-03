#!/usr/bin/env bash
# Sets up the Cloudflare side of PyDocs (PLAN.md §13, Phase 0).
# Safe to re-run: each step checks what already exists and skips it.
#
# Needs: `npx wrangler@4 login` done once (or CLOUDFLARE_API_TOKEN set).
#
# The Worker itself and its custom domain (pydocs.org) are not created here:
# they come from site/wrangler.toml on the first `wrangler deploy`.
#
# Optional environment variables (copied into Worker secrets):
#   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  prod GitHub OAuth app
#   ADMIN_GITHUB_IDS                        comma-separated numeric GitHub ids
set -euo pipefail

WORKER="pydocs"
DOMAIN="pydocs.org"
DATA_DOMAIN="data.${DOMAIN}"
BUCKETS=("pydocs-content" "pydocs-private")
PUBLIC_BUCKET="pydocs-content"
HERE="$(cd "$(dirname "$0")" && pwd)"

wrangler() { npx --yes wrangler@4 "$@"; }
say() { printf '\n==> %s\n' "$*"; }
api() {
  # api METHOD PATH [JSON_BODY] -> prints the JSON response
  local method="$1" path="$2" body="${3:-}"
  curl -sS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
    -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
    ${body:+--data "$body"}
}
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

say "Checking login"
wrangler whoami >/dev/null
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-$(wrangler auth token 2>/dev/null | grep -vE '^\s*$|wrangler|─' | tail -1)}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(api GET /accounts | json 'd["result"][0]["id"]')}"
echo "account: ${ACCOUNT_ID}"

say "R2 buckets"
existing_buckets="$(wrangler r2 bucket list 2>/dev/null | awk '/^name:/ {print $2}')"
for b in "${BUCKETS[@]}"; do
  if grep -qx "$b" <<<"$existing_buckets"; then
    echo "exists: $b"
  else
    wrangler r2 bucket create "$b"
  fi
done

say "Worker secrets"
if api GET "/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}/settings" | json 'd["success"]' | grep -q True; then
  existing_secrets="$(wrangler secret list --name "$WORKER" 2>/dev/null || true)"
  put_secret() {
    printf '%s' "$2" | wrangler secret put "$1" --name "$WORKER" >/dev/null
    echo "set: $1"
  }
  if grep -q '"SESSION_SECRET"' <<<"$existing_secrets"; then
    echo "exists: SESSION_SECRET"
  else
    put_secret SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  fi
  for name in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET ADMIN_GITHUB_IDS; do
    if [[ -n "${!name:-}" ]]; then
      put_secret "$name" "${!name}"
    elif grep -q "\"$name\"" <<<"$existing_secrets"; then
      echo "exists: $name"
    else
      echo "missing: $name (set it in the environment and re-run)"
    fi
  done
else
  echo "skipped: Worker '${WORKER}' does not exist yet. Deploy once, then re-run."
fi

say "Zone ${DOMAIN}"
ZONE_ID="$(api GET "/zones?name=${DOMAIN}" | json '(d["result"] or [{}])[0].get("id", "")')"
if [[ -z "$ZONE_ID" ]]; then
  echo "skipped: ${DOMAIN} is not on this Cloudflare account yet."
  echo "Buy or add it, then re-run to connect ${DATA_DOMAIN}."
  exit 0
fi
echo "zone: ${ZONE_ID}"

say "R2 custom domain ${DATA_DOMAIN} -> ${PUBLIC_BUCKET}"
if wrangler r2 bucket domain list "$PUBLIC_BUCKET" 2>/dev/null | grep -q "$DATA_DOMAIN"; then
  echo "exists: ${DATA_DOMAIN}"
else
  wrangler r2 bucket domain add "$PUBLIC_BUCKET" --domain "$DATA_DOMAIN" --zone-id "$ZONE_ID" --min-tls 1.2 --force
fi

say "R2 CORS on ${PUBLIC_BUCKET}"
wrangler r2 bucket cors set "$PUBLIC_BUCKET" --file "${HERE}/r2-cors.json" --force

say "Done"
echo "Not covered here (see PLAN.md Phase 0): the Cache Rule for ${DATA_DOMAIN}"
echo "(needs a zone-write API token) and the GitHub OAuth apps."
