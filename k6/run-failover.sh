#!/bin/bash
# Failover test: measures behavior of all three scenarios when Keycloak goes down.
#
# Usage:
#   Terminal 1: bash k6/run-failover.sh
#   Terminal 2: stop Keycloak mid-test (on Hetzner VM 1):
#               ssh root@<HETZNER_VM1_IP> "docker stop keycloak"

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run the deploy-k6 workflow first."
  exit 1
fi
source .env

if [ ! -f vp.json ]; then
  echo "ERROR: vp.json not found. Run: python3 scripts/generate_vp.py"
  exit 1
fi

echo "Fetching token..."
TOKEN=$(curl -sf -X POST \
  "http://${KEYCLOAK_IP}/realms/${KC_REALM}/protocol/openid-connect/token" \
  -d "grant_type=client_credentials&client_id=${KC_CLIENT_ID}&client_secret=${KC_CLIENT_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

[ -z "$TOKEN" ] && echo "ERROR: Failed to fetch token." && exit 1
echo "Token acquired."
echo ""
echo "Starting failover test..."
echo "Stop Keycloak on Hetzner VM 1 after ~60s to observe SPOF behavior."
echo ""

mkdir -p results
k6 run --out json=results/failover.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  -e TOKEN="${TOKEN}" \
  k6/failover-test.js
