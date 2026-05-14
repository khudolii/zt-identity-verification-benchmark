#!/bin/bash
# Scenario 2: Short-lived JWT with local signature verification.
# Service B verifies the token locally — Keycloak only needed at startup.

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run the deploy-k6 workflow first."
  exit 1
fi
source .env

echo "Fetching token..."
TOKEN=$(curl -sf -X POST \
  "http://${KEYCLOAK_IP}/realms/${KC_REALM}/protocol/openid-connect/token" \
  -d "grant_type=client_credentials&client_id=${KC_CLIENT_ID}&client_secret=${KC_CLIENT_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

[ -z "$TOKEN" ] && echo "ERROR: Failed to fetch token." && exit 1
echo "Token acquired. Starting scenario 2..."

mkdir -p results
k6 run --out json=results/jwt.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  -e TOKEN="${TOKEN}" \
  k6/scenario-2-jwt.js
