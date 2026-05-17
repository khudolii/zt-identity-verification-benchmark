#!/bin/bash
# Scenario 2: Short-lived JWT (30s TTL) with per-VU automatic refresh.
# Each k6 VU fetches and refreshes its own token — no pre-fetched token needed.
# Service B verifies locally; Keycloak is only hit for token refresh.

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run the deploy-k6 workflow first."
  exit 1
fi
source .env

echo "Starting scenario 2 (JWT refresh)..."
mkdir -p results
TS=$(date +%Y%m%d_%H%M%S)

k6 run \
  --summary-export results/jwt_summary_${TS}.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  -e KEYCLOAK_IP="${KEYCLOAK_IP}" \
  -e CLIENT_SECRET="${KC_CLIENT_SECRET}" \
  k6/scenario-2-jwt-refresh.js

echo ""
echo "Results saved to: results/jwt_summary_${TS}.json"
