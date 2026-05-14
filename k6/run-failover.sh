#!/bin/bash
# Failover test: measures behavior when Keycloak goes down mid-test.
#
# Usage:
#   bash k6/run-failover.sh                  # all three scenarios
#   bash k6/run-failover.sh introspection    # introspection only
#   bash k6/run-failover.sh jwt              # jwt only
#   bash k6/run-failover.sh vc              # vc only
#
# In a second terminal, stop Keycloak after ~60s:
#   ssh root@<HETZNER_VM1_IP> "docker stop keycloak"

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

SCENARIO=${1:-""}

# Validate scenario argument
if [ -n "$SCENARIO" ] && [[ ! "$SCENARIO" =~ ^(introspection|jwt|vc)$ ]]; then
  echo "ERROR: Unknown scenario '$SCENARIO'. Use: introspection, jwt, or vc"
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

TS=$(date +%Y%m%d_%H%M%S)

if [ -n "$SCENARIO" ]; then
  echo "Starting failover test — scenario: $SCENARIO"
  SCENARIO_FLAG="--scenario $SCENARIO"
  OUTPUT="results/failover-${SCENARIO}_${TS}.json"
  SUMMARY="results/failover-${SCENARIO}_summary_${TS}.json"
else
  echo "Starting failover test — all scenarios"
  SCENARIO_FLAG=""
  OUTPUT="results/failover_${TS}.json"
  SUMMARY="results/failover_summary_${TS}.json"
fi

echo "Stop Keycloak on Hetzner VM 1 after ~60s to observe SPOF behavior."
echo ""

mkdir -p results
k6 run $SCENARIO_FLAG \
  --out json=${OUTPUT} \
  --summary-export ${SUMMARY} \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  -e TOKEN="${TOKEN}" \
  k6/failover-test.js

echo ""
echo "Results saved to:"
echo "  ${OUTPUT}   (raw metrics)"
echo "  ${SUMMARY}  (summary stats)"
