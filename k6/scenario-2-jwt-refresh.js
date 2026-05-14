/**
 * Scenario 2: Short-lived JWT (30s TTL) with per-VU automatic refresh
 *
 * Service B verifies the JWT signature locally on every request.
 * Each VU independently fetches and refreshes its token before expiry
 * (within a 5s buffer), modelling multiple service instances each
 * maintaining their own credential lifecycle.
 *
 * This is the closest JWT can get to Zero Trust continuous verification:
 * tokens are short-lived so revocation takes effect within 30 seconds,
 * and the refresh overhead is visible in token_refresh_latency.
 *
 * Key finding vs Scenario 3 (VC):
 *   Under high load (700-1000 req/s) many VUs hit expiry simultaneously,
 *   causing a thundering herd on Keycloak. refresh latency spikes and
 *   bleeds into verification_latency. VC shows no such degradation.
 *
 * Required env vars:
 *   SERVICE_B_IP   — GCP VM running Service B
 *   KEYCLOAK_IP    — Hetzner VM running Keycloak
 *   CLIENT_SECRET  — service-a client secret (default: service-a-secret)
 *
 * Usage:
 *   k6 run \
 *     -e SERVICE_B_IP=<ip> \
 *     -e KEYCLOAK_IP=<ip> \
 *     -e CLIENT_SECRET=service-a-secret \
 *     k6/scenario-2-jwt-refresh.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const verificationLatency = new Trend('verification_latency', true);
const refreshLatency      = new Trend('token_refresh_latency', true);
const errorRate           = new Rate('error_rate');
const reqCounter          = new Counter('total_requests');
const refreshCounter      = new Counter('token_refresh_count');

export const options = {
    scenarios: {
        // Phase 1: steady baseline — 200 req/s for 30s
        steady: {
            executor: 'constant-arrival-rate',
            rate: 200,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 50,
            maxVUs: 100,
            startTime: '0s',
        },
        // Phase 2: ramp up — exposes thundering herd on token refresh
        ramp: {
            executor: 'ramping-arrival-rate',
            startRate: 200,
            timeUnit: '1s',
            stages: [
                { duration: '20s', target: 400  },
                { duration: '20s', target: 700  },
                { duration: '20s', target: 1000 },
            ],
            preAllocatedVUs: 200,
            maxVUs: 500,
            startTime: '35s',
        },
        // Phase 3: cooldown — verify recovery after load drops
        cooldown: {
            executor: 'constant-arrival-rate',
            rate: 200,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 50,
            maxVUs: 100,
            startTime: '100s',
        },
    },
    thresholds: {
        'verification_latency':  ['p(95)<500'],
        'token_refresh_latency': ['p(95)<200'],
        'error_rate':            ['rate<0.01'],
    },
};

const SERVICE_B_URL  = `http://${__ENV.SERVICE_B_IP}/api/resource/jwt`;
const TOKEN_URL      = `http://${__ENV.KEYCLOAK_IP}/realms/zt-benchmark/protocol/openid-connect/token`;
const CLIENT_SECRET  = __ENV.CLIENT_SECRET || 'service-a-secret';

// Per-VU token state — each VU has its own copy of these variables
let cachedToken    = null;
let tokenExpiresAt = 0;

function getValidToken() {
    const now = Date.now();
    // Refresh 5s before expiry to avoid using an expired token mid-request
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

        refreshLatency.add(res.timings.duration);
        refreshCounter.add(1);

        const body = JSON.parse(res.body);
        cachedToken    = body.access_token;
        tokenExpiresAt = now + (body.expires_in * 1000);
    }
    return cachedToken;
}

export default function () {
    const token = getValidToken();

    const res = http.post(SERVICE_B_URL, null, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
        },
        timeout: '5s',
    });

    const ok = check(res, {
        'status is 200':    (r) => r.status === 200,
        'response allowed': (r) => {
            try { return JSON.parse(r.body).status === 'allowed'; }
            catch { return false; }
        },
    });

    verificationLatency.add(res.timings.duration);
    errorRate.add(!ok);
    reqCounter.add(1);
}
