#!/bin/bash
# Failover test: runs all three scenarios concurrently for 180s.
# Stop Keycloak at the ~90s mark to observe three distinct failure modes:
#   introspection → fails immediately (every request hits Keycloak)
#   jwt           → fails ~30s after Keycloak stops (when token expires and can't refresh)
#   vc            → never fails (fully local, no IdP dependency)
#
# Usage:
#   bash k6/run-failover.sh
#
# In a second terminal, stop Keycloak after ~90s:
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

echo "Starting failover test — all three scenarios running concurrently for 180s."
echo "Stop Keycloak on Hetzner VM 1 after ~90s to observe SPOF behavior."
echo ""

mkdir -p results
TS=$(date +%Y%m%d_%H%M%S)
SUMMARY="results/failover_summary_${TS}.json"

k6 run \
  --summary-export ${SUMMARY} \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  -e KEYCLOAK_IP="${KEYCLOAK_IP}" \
  -e CLIENT_SECRET="${KC_CLIENT_SECRET}" \
  k6/failover-test.js

echo ""
echo "Results saved to: ${SUMMARY}"
