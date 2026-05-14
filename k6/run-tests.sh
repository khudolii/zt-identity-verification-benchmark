#!/bin/bash
# Run all three benchmark scenarios in sequence with cooldown pauses.
# Delegates to the individual run-scenario-*.sh scripts.

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run the deploy-k6 workflow first."
  exit 1
fi

# Warmup
echo "==> Warmup (results discarded)..."
source .env
TOKEN=$(curl -sf -X POST \
  "http://${KEYCLOAK_IP}/realms/${KC_REALM}/protocol/openid-connect/token" \
  -d "grant_type=client_credentials&client_id=${KC_CLIENT_ID}&client_secret=${KC_CLIENT_SECRET}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
k6 run --vus 10 --duration 30s \
  -e SERVICE_B_IP="${SERVICE_B_IP}" -e TOKEN="${TOKEN}" \
  k6/scenario-1-introspection.js

sleep 30

echo "==> Scenario 1"; bash k6/run-scenario-1.sh
sleep 120
echo "==> Scenario 2"; bash k6/run-scenario-2.sh
sleep 120
echo "==> Scenario 3"; bash k6/run-scenario-3.sh

echo ""
echo "All done. Timestamped results in results/:"
ls -1t results/ | head -20
