#!/bin/bash
# Scenario 1: Token Introspection (RFC 7662)
# Service B calls Keycloak on every request — centralized SPOF baseline.

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
echo "Token acquired. Starting scenario 1..."

mkdir -p results
TS=$(date +%Y%m%d_%H%M%S)

k6 run \
  --summary-export results/introspection_summary_${TS}.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  -e TOKEN="${TOKEN}" \
  k6/scenario-1-introspection.js

echo ""
echo "Results saved to: results/introspection_summary_${TS}.json"
