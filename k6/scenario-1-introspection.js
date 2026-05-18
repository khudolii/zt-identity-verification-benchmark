/**
 * Scenario 1: Token Introspection (RFC 7662)
 *
 * Service B calls Keycloak on EVERY request to validate the token.
 * Models centralized IdP dependency — the SPOF problem.
 *
 * Three phases:
 *   Phase 1 (0-40s):    200 req/s steady — warm baseline
 *   Phase 2 (45-125s):  ramp 200→1000 req/s — stress test (3 × 27s stages)
 *   Phase 3 (130-170s): 200 req/s cooldown — recovery check
 *
 * Usage:
 *   k6 run -e SERVICE_B_IP=<ip> -e TOKEN=$TOKEN k6/scenario-1-introspection.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const verificationLatency = new Trend('verification_latency', true);
const errorRate  = new Rate('error_rate');
const reqCounter = new Counter('total_requests');

export const options = {
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    scenarios: {
        // Phase 1: warm steady state
        steady: {
            executor: 'constant-arrival-rate',
            rate: 200,
            timeUnit: '1s',
            duration: '40s',
            preAllocatedVUs: 50,
            maxVUs: 100,
            startTime: '0s',
        },
        // Phase 2: ramp — find the breaking point
        ramp: {
            executor: 'ramping-arrival-rate',
            startRate: 200,
            timeUnit: '1s',
            stages: [
                { duration: '27s', target: 400  },
                { duration: '27s', target: 700  },
                { duration: '26s', target: 1000 },
            ],
            preAllocatedVUs: 200,
            maxVUs: 500,
            startTime: '45s',
        },
        // Phase 3: cooldown — check recovery
        cooldown: {
            executor: 'constant-arrival-rate',
            rate: 200,
            timeUnit: '1s',
            duration: '40s',
            preAllocatedVUs: 50,
            maxVUs: 100,
            startTime: '130s',
        },
    },
    thresholds: {
        'verification_latency': ['p(95)<2000'],
        'error_rate': ['rate<0.10'],
    },
};

const SERVICE_B_IP = __ENV.SERVICE_B_IP || 'localhost';
const TOKEN        = __ENV.TOKEN;
const URL   = `http://${SERVICE_B_IP}/api/resource/introspection`;

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

    verificationLatency.add(res.timings.duration);
    errorRate.add(!ok);
    reqCounter.add(1);
}