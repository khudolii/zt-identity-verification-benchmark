/**
 * Failover test — demonstrates the SPOF problem of centralized IdP.
 *
 * All three scenarios run concurrently for 120 seconds.
 * Stop Keycloak at the ~60s mark to observe failover behavior.
 *
 * Expected results after Keycloak stops:
 *   Introspection → error rate jumps to 100% immediately (SPOF demonstrated)
 *   JWT           → continues working (public key cached at startup)
 *   VC            → continues working (fully local, no IdP dependency)
 *
 * This is the key architectural finding of the paper.
 *
 * Usage:
 *   # Terminal 1: start test
 *   k6 run --out json=results/failover.json \
 *     -e SERVICE_B_IP=<ip> -e TOKEN=$TOKEN k6/failover-test.js
 *
 *   # Terminal 2: stop Keycloak after ~60 seconds
 *   ssh root@<hetzner-ip> "docker stop keycloak"
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Separate metrics per scenario for clear result separation
const latency_introspection = new Trend('latency_introspection', true);
const latency_jwt           = new Trend('latency_jwt', true);
const latency_vc            = new Trend('latency_vc', true);
const errors_introspection  = new Rate('error_rate_introspection');
const errors_jwt            = new Rate('error_rate_jwt');
const errors_vc             = new Rate('error_rate_vc');

export const options = {
    scenarios: {
        introspection: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '120s',
            preAllocatedVUs: 20,
            maxVUs: 50,
            env: { SCENARIO: 'introspection' },
        },
        jwt: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '120s',
            preAllocatedVUs: 20,
            maxVUs: 50,
            env: { SCENARIO: 'jwt' },
        },
        vc: {
            executor: 'constant-arrival-rate',
            rate: 50,
            timeUnit: '1s',
            duration: '120s',
            preAllocatedVUs: 20,
            maxVUs: 50,
            env: { SCENARIO: 'vc' },
        },
    },
    // No thresholds — we expect failures for introspection after Keycloak stops
};

const SERVICE_B_IP = __ENV.SERVICE_B_IP || 'localhost';
const TOKEN        = __ENV.TOKEN;
const VP_JSON      = open('../vp.json');

const URLS = {
    introspection: `http://${SERVICE_B_IP}/api/resource/introspection`,
    jwt:           `http://${SERVICE_B_IP}/api/resource/jwt`,
    vc:            `http://${SERVICE_B_IP}/api/resource/vc`,
};

export default function () {
    const scenario = __ENV.SCENARIO;
    let res;

    if (scenario === 'introspection') {
        res = http.post(URLS.introspection, null, {
            headers: { 'Authorization': `Bearer ${TOKEN}` },
            timeout: '3s',
        });
        const ok = check(res, { 'introspection ok': (r) => r.status === 200 });
        latency_introspection.add(res.timings.duration);
        errors_introspection.add(!ok);

    } else if (scenario === 'jwt') {
        res = http.post(URLS.jwt, null, {
            headers: { 'Authorization': `Bearer ${TOKEN}` },
            timeout: '3s',
        });
        const ok = check(res, { 'jwt ok': (r) => r.status === 200 });
        latency_jwt.add(res.timings.duration);
        errors_jwt.add(!ok);

    } else if (scenario === 'vc') {
        res = http.post(URLS.vc, VP_JSON, {
            headers: { 'Content-Type': 'application/json' },
            timeout: '3s',
        });
        const ok = check(res, { 'vc ok': (r) => r.status === 200 });
        latency_vc.add(res.timings.duration);
        errors_vc.add(!ok);
    }
}