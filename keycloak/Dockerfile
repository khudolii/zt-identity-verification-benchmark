FROM quay.io/keycloak/keycloak:24.0

COPY realm-export.json /opt/keycloak/data/import/realm-export.json

ENV KC_HTTP_ENABLED=true
ENV KC_HOSTNAME_STRICT=false

EXPOSE 8080

ENTRYPOINT ["/opt/keycloak/bin/kc.sh", "start-dev", "--import-realm"]
