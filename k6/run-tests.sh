#!/bin/bash
# Run all benchmark scenarios against the deployed infrastructure.
# Requires .env in the same directory — written by the deploy-k6 workflow.
#
# Usage:
#   cd ~/zt-benchmark
#   bash k6/run-tests.sh

set -e
cd "$(dirname "$0")/.."

# Load env
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run the deploy-k6 workflow first."
  exit 1
fi
source .env

# Fetch a fresh token (client credentials — no user session needed for load tests)
echo "Fetching token from Keycloak..."
TOKEN=$(curl -sf -X POST \
  "http://${KEYCLOAK_IP}/realms/${KC_REALM}/protocol/openid-connect/token" \
  -d "grant_type=client_credentials&client_id=${KC_CLIENT_ID}&client_secret=${KC_CLIENT_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to fetch token. Check KEYCLOAK_IP and client credentials in .env"
  exit 1
fi
echo "Token acquired."

mkdir -p results

# Warmup
echo ""
echo "==> Warmup (results discarded)..."
k6 run --vus 10 --duration 30s \
  -e SERVICE_B_IP="${SERVICE_B_IP}" -e TOKEN="${TOKEN}" \
  k6/scenario-1-introspection.js

sleep 30

# Scenario 1
echo ""
echo "==> Scenario 1: Token Introspection"
k6 run --out json=results/introspection.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" -e TOKEN="${TOKEN}" \
  k6/scenario-1-introspection.js

sleep 120

# Scenario 2
echo ""
echo "==> Scenario 2: JWT"
k6 run --out json=results/jwt.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" -e TOKEN="${TOKEN}" \
  k6/scenario-2-jwt.js

sleep 120

# Scenario 3
echo ""
echo "==> Scenario 3: VC"
k6 run --out json=results/vc.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  k6/scenario-3-vc.js

echo ""
echo "All scenarios done. Results in results/"
