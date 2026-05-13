#!/bin/bash
# Waits for Keycloak to be ready, then creates dev/dev user via kcadm.
# Uses kcadm login as the readiness probe — no curl/wget needed.

KCADM=/opt/keycloak/bin/kcadm.sh

echo "[init] Waiting for Keycloak..."
until $KCADM config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "${KEYCLOAK_ADMIN}" \
  --password "${KEYCLOAK_ADMIN_PASSWORD}" > /dev/null 2>&1; do
  sleep 3
done
echo "[init] Keycloak ready."

# Disable HTTPS requirement on both realms so the admin console
# is accessible over plain HTTP (benchmark environment, not production)
$KCADM update realms/master       -s sslRequired=none
$KCADM update realms/zt-benchmark -s sslRequired=none

# Disable VERIFY_PROFILE — Keycloak 24 enables it by default and blocks
# password grant for users without a complete profile (irrelevant for benchmark)
$KCADM update authentication/required-actions/VERIFY_PROFILE \
  -r zt-benchmark -s enabled=false

# Idempotent: skip if user already exists
if $KCADM get users -r zt-benchmark -q username=dev 2>/dev/null | grep -q '"dev"'; then
  echo "[init] User 'dev' already exists, skipping."
else
  USER_ID=$($KCADM create users -r zt-benchmark \
    -s username=dev \
    -s enabled=true \
    -s emailVerified=true \
    -s 'requiredActions=[]' -i)

  $KCADM set-password -r zt-benchmark \
    --username dev \
    --new-password dev

  # Explicitly clear any required actions set automatically by Keycloak
  $KCADM update users/$USER_ID -r zt-benchmark -s 'requiredActions=[]'

  echo "[init] User dev/dev created."
fi
