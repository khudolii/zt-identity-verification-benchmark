/**
 * Scenario 2: Short-lived JWT with local signature verification
 *
 * Service B verifies the JWT signature locally — no Keycloak call per request.
 * Models reduced IdP dependency: Keycloak only needed at startup (JWKS).
 *
 * Usage:
 *   TOKEN=$(curl -s -X POST http://$KEYCLOAK_IP:8080/realms/zt-benchmark/... | jq -r .access_token)
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
    steady_load: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      startTime: '0s',
    },
    ramp_load: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      stages: [
        { duration: '20s', target: 50  },
        { duration: '20s', target: 100 },
        { duration: '20s', target: 200 },
        { duration: '20s', target: 50  },
      ],
      preAllocatedVUs: 100,
      maxVUs: 200,
      startTime: '70s',
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
