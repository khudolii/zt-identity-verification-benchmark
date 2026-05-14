#!/bin/bash
# Scenario 3: DID/VC with Ed25519 local verification.
# Fully decentralized — no Keycloak dependency at all.
#
# Requires vp.json in the project root.
# Generate it once with: python3 scripts/generate_vp.py

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

echo "Starting scenario 3..."
mkdir -p results
TS=$(date +%Y%m%d_%H%M%S)

k6 run \
  --out json=results/vc_${TS}.json \
  --summary-export results/vc_summary_${TS}.json \
  -e SERVICE_B_IP="${SERVICE_B_IP}" \
  k6/scenario-3-vc.js

echo ""
echo "Results saved to:"
echo "  results/vc_${TS}.json         (raw metrics)"
echo "  results/vc_summary_${TS}.json  (summary stats)"
