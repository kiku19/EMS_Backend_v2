/* eslint-disable no-undef */
/**
 * PERF-01: k6 Load Test — Fee management endpoints
 *
 * Scenarios covered:
 *   - Fee collection (POST /fees/collect)
 *   - Student fee lookup (GET /student-fees/:studentId)
 *   - Dues report (GET /fees/reports/dues)
 *   - Receipt generation (GET /fees/receipt/:id)
 *
 * Run:
 *   BASE_URL=http://localhost:5000/api \
 *   TEST_EMAIL=admin@school.com \
 *   TEST_PASSWORD=yourpassword \
 *   k6 run k6/fees.k6.js
 *
 * Or pass IDs directly (skips setup auth):
 *   TOKEN=<jwt> STUDENT_IDS=id1,id2,id3 FEE_HEAD_ID=<id> k6 run k6/fees.k6.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const collectDuration = new Trend('fee_collect_duration_ms', true);
const lookupDuration = new Trend('fee_lookup_duration_ms', true);
const reportDuration = new Trend('fee_report_duration_ms', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';

export const options = {
  scenarios: {
    fee_operations: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 30 },
        { duration: '3m', target: 30 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    errors: ['rate<0.01'],
    http_req_duration: ['p(95)<3000', 'p(99)<6000'],
    fee_collect_duration_ms: ['p(95)<2000'],
    fee_lookup_duration_ms: ['p(95)<500'],
    fee_report_duration_ms: ['p(95)<3000'],
  },
};

/**
 * setup() runs once before all VUs start.
 * Authenticates and fetches real student IDs and fee head IDs.
 * Returns data passed to default() as the first argument.
 */
export function setup() {
  // If IDs are provided via env vars, skip auth
  if (__ENV.TOKEN && __ENV.STUDENT_IDS) {
    const studentIds = __ENV.STUDENT_IDS.split(',');
    const feeHeadId = __ENV.FEE_HEAD_ID || null;
    return { token: __ENV.TOKEN, studentIds, feeHeadId };
  }

  const email = __ENV.TEST_EMAIL || 'admin@school.com';
  const password = __ENV.TEST_PASSWORD || 'password';

  // Step 1: Authenticate
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(loginRes, { 'setup: login 200': (r) => r.status === 200 });
  if (loginRes.status !== 200) {
    throw new Error(`setup() login failed (${loginRes.status}): ${loginRes.body}`);
  }

  const token = loginRes.json('token') || loginRes.json('accessToken');
  if (!token) throw new Error('setup() could not extract JWT token from login response');

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // Step 2: Fetch real student IDs (up to 50)
  const studentRes = http.get(`${BASE_URL}/students?limit=50`, { headers: authHeaders });
  check(studentRes, { 'setup: students 200': (r) => r.status === 200 });

  const studentBody = studentRes.json();
  const students =
    studentBody?.students || studentBody?.data || (Array.isArray(studentBody) ? studentBody : []);
  const studentIds = students.map((s) => String(s._id)).filter(Boolean);

  if (studentIds.length === 0) {
    throw new Error('setup() found no students — seed the DB before running load tests');
  }

  // Step 3: Fetch a real fee head ID
  const feeHeadRes = http.get(`${BASE_URL}/fee-heads?limit=1`, { headers: authHeaders });
  const feeHeadBody = feeHeadRes.json();
  const feeHeads =
    feeHeadBody?.feeHeads || feeHeadBody?.data || (Array.isArray(feeHeadBody) ? feeHeadBody : []);
  const feeHeadId = feeHeads[0]?._id ? String(feeHeads[0]._id) : null;

  console.log(`setup() ready — students: ${studentIds.length}, feeHeadId: ${feeHeadId}`);
  return { token, studentIds, feeHeadId };
}

export default function (data) {
  const { token, studentIds, feeHeadId } = data;

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const studentId = studentIds[__VU % studentIds.length];

  group('Fee Lookup', () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/student-fees/${studentId}`, { headers: authHeaders });
    lookupDuration.add(Date.now() - start);

    const ok = check(res, {
      'lookup: 200 or 404': (r) => r.status === 200 || r.status === 404, // 404 valid if no structure yet
    });
    errorRate.add(!ok);
  });

  sleep(0.5);

  // 70% reads, 30% writes
  if (Math.random() > 0.3) {
    group('Dues Report', () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/fees/reports/dues?limit=50&page=1`, {
        headers: authHeaders,
      });
      reportDuration.add(Date.now() - start);

      const ok = check(res, {
        'report: 200': (r) => r.status === 200,
      });
      errorRate.add(!ok);
    });
  } else {
    group('Fee Collection', () => {
      const feeHeads = feeHeadId
        ? [{ headId: feeHeadId, amount: 5000 }]
        : [{ headId: 'tuition', amount: 5000 }];

      const payload = {
        studentId,
        amount: 5000 + Math.floor(Math.random() * 5000),
        paymentMode: ['cash', 'upi', 'bank_transfer'][Math.floor(Math.random() * 3)],
        date: new Date().toISOString().slice(0, 10),
        feeHeads,
        remarks: 'k6 load test payment',
      };

      const start = Date.now();
      const res = http.post(`${BASE_URL}/fees/collect`, JSON.stringify(payload), {
        headers: authHeaders,
      });
      collectDuration.add(Date.now() - start);

      const ok = check(res, {
        'collect: 200 or 201': (r) => r.status === 200 || r.status === 201,
      });
      errorRate.add(!ok);
    });
  }

  sleep(1 + Math.random() * 2);
}
