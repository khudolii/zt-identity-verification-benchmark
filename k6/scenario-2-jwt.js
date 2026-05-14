/**
 * Scenario 2: Short-lived JWT with local signature verification
 *
 * Service B verifies JWT signature locally — no Keycloak call per request.
 * Keycloak needed only at startup to load JWKS public key.
 *
 * Three phases:
 *   Phase 1 (0-30s):   200 req/s steady — warm baseline
 *   Phase 2 (30-90s):  ramp 200→1000 req/s — stress test
 *   Phase 3 (90-120s): 200 req/s cooldown — recovery check
 *
 * Expected: significantly lower latency than introspection,
 * stable under high load since no external calls.
 *
 * Usage:
 *   k6 run -e SERVICE_B_IP=<ip> -e TOKEN=$TOKEN k6/scenario-2-jwt.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const latency    = new Trend('verification_latency', true);
const errorRate  = new Rate('error_rate');
const reqCounter = new Counter('total_requests');

export const options = {
    scenarios: {
        steady: {
            executor: 'constant-arrival-rate',
            rate: 200,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 50,
            maxVUs: 100,
            startTime: '0s',
        },
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
        'verification_latency': ['p(95)<500'],
        'error_rate': ['rate<0.01'],
    },
};

const SERVICE_B_IP = __ENV.SERVICE_B_IP || 'localhost';
const TOKEN        = __ENV.TOKEN;
const URL          = `http://${SERVICE_B_IP}/api/resource/jwt`;

export default function () {
    const res = http.post(URL, null, {
        headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
        },
        timeout: '5s',
    });

    const ok = check(res, {
        'status is 200': (r) => r.status === 200,
        'response allowed': (r) => {
            try { return JSON.parse(r.body).status === 'allowed'; }
            catch { return false; }
        },
    });

    latency.add(res.timings.duration);
    errorRate.add(!ok);
    reqCounter.add(1);
}