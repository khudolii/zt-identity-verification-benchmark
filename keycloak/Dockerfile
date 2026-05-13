FROM quay.io/keycloak/keycloak:24.0

COPY realm-export.json /opt/keycloak/data/import/realm-export.json
COPY --chmod=755 init-users.sh /opt/keycloak/init-users.sh

ENV KC_HTTP_ENABLED=true
ENV KC_HOSTNAME_STRICT=false
ENV KC_HOSTNAME_STRICT_HTTPS=false
# Default to localhost for local dev; override with -e KC_HOSTNAME=<vm-ip> in production
ENV KC_HOSTNAME=localhost

EXPOSE 8080

# Start Keycloak in background, run user-init script, then wait
ENTRYPOINT ["/bin/bash", "-c", \
  "/opt/keycloak/bin/kc.sh start-dev --import-realm & /opt/keycloak/init-users.sh && wait"]
