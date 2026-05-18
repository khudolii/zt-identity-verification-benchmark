/**
 * Failover test — demonstrates three distinct failure modes under IdP outage.
 *
 * All three scenarios run concurrently for 180 seconds.
 * Stop Keycloak at the ~90s mark to observe failover behavior.
 *
 * Expected results after Keycloak stops:
 *   Introspection → fails immediately — Service B hits Keycloak on every request AND
 *                   VUs can no longer refresh their token (double dependency)
 *   JWT           → keeps working ~30s — Service B verifies locally, token still valid;
 *                   fails once token expires and VUs can no longer refresh
 *   VC            → never fails — fully local Ed25519 verification, zero IdP dependency
 *
 * This is the key architectural finding of the paper:
 *   three distinct resilience profiles from the same IdP failure event.
 *
 * All scenarios use per-VU token refresh (TTL=30s) so token expiry is
 * never the cause of failure — only IdP unavailability is.
 *
 * Usage:
 *   # Terminal 1: start test
 *   bash k6/run-failover.sh
 *
 *   # Terminal 2: stop Keycloak after ~90 seconds
 *   ssh root@<hetzner-ip> "docker stop keycloak"
 *
 * Required env vars:
 *   SERVICE_B_IP   — GCP VM running Service B
 *   KEYCLOAK_IP    — Hetzner VM running Keycloak
 *   CLIENT_SECRET  — service-a secret (both scenarios refresh per-VU)
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Per-scenario metrics for clear separation in results
const latency_introspection = new Trend('latency_introspection', true);
const latency_jwt           = new Trend('latency_jwt', true);
const latency_vc            = new Trend('latency_vc', true);
const errors_introspection  = new Rate('error_rate_introspection');
const errors_jwt            = new Rate('error_rate_jwt');
const errors_vc             = new Rate('error_rate_vc');
const refresh_latency       = new Trend('token_refresh_latency', true);
const refresh_count         = new Counter('token_refresh_count');

export const options = {
    scenarios: {
        introspection: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '180s',
            preAllocatedVUs: 20,
            maxVUs: 50,
            env: { SCENARIO: 'introspection' },
        },
        jwt: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '180s',
            preAllocatedVUs: 20,
            maxVUs: 50,
            env: { SCENARIO: 'jwt' },
        },
        vc: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '180s',
            preAllocatedVUs: 20,
            maxVUs: 50,
            env: { SCENARIO: 'vc' },
        },
    },
    // No thresholds — we expect failures after Keycloak stops
};

const SERVICE_B_IP  = __ENV.SERVICE_B_IP || 'localhost';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || 'service-a-secret';
const TOKEN_URL     = `http://${__ENV.KEYCLOAK_IP}/realms/zt-benchmark/protocol/openid-connect/token`;
const VP_JSON       = open('../vp.json');

const URLS = {
    introspection: `http://${SERVICE_B_IP}/api/resource/introspection`,
    jwt:           `http://${SERVICE_B_IP}/api/resource/jwt`,
    vc:            `http://${SERVICE_B_IP}/api/resource/vc`,
};

// Per-VU JWT token state (each VU refreshes independently)
let cachedToken    = null;
let tokenExpiresAt = 0;

function getValidToken() {
    const now = Date.now();
    if (!cachedToken || now >= tokenExpiresAt - 5000) {
        const res = http.post(
            TOKEN_URL,
            {
                grant_type:    'client_credentials',
                client_id:     'service-a',
                client_secret: CLIENT_SECRET,
            },
            { tags: { name: 'token_refresh' } }
        );
        refresh_latency.add(res.timings.duration);
        refresh_count.add(1);

        const body = JSON.parse(res.body);
        cachedToken    = body.access_token;
        tokenExpiresAt = now + (body.expires_in * 1000);
    }
    return cachedToken;
}

export default function () {
    const scenario = __ENV.SCENARIO;
    let res;

    if (scenario === 'introspection') {
        // Per-VU refresh — token is always fresh, so failures are purely due to
        // Keycloak being unreachable (either for refresh or for introspection)
        const token = getValidToken();
        res = http.post(URLS.introspection, null, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: '3s',
        });
        const ok = check(res, { 'introspection ok': (r) => r.status === 200 });
        latency_introspection.add(res.timings.duration);
        errors_introspection.add(!ok);

    } else if (scenario === 'jwt') {
        // Per-VU refresh — works until token expires, then fails when Keycloak is down
        const token = getValidToken();
        res = http.post(URLS.jwt, null, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: '3s',
        });
        const ok = check(res, { 'jwt ok': (r) => r.status === 200 });
        latency_jwt.add(res.timings.duration);
        errors_jwt.add(!ok);

    } else if (scenario === 'vc') {
        // Fully local — unaffected by Keycloak outage
        res = http.post(URLS.vc, VP_JSON, {
            headers: { 'Content-Type': 'application/json' },
            timeout: '3s',
        });
        const ok = check(res, { 'vc ok': (r) => r.status === 200 });
        latency_vc.add(res.timings.duration);
        errors_vc.add(!ok);
    }
}
