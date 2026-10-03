#!/bin/sh
# Writes /config.js from environment variables so one image serves any bank. Values are JSON-escaped.
set -eu
mkdir -p /tmp/app-config
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
cat > /tmp/app-config/config.js <<CONFIG
window.__APP_CONFIG__ = { apiUrl: "$(esc "${API_URL:-/v1}")", oidcAuthority: "$(esc "${OIDC_AUTHORITY:-}")", oidcClientId: "$(esc "${OIDC_CLIENT_ID:-}")" };
CONFIG
