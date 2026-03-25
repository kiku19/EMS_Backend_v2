/* eslint-disable no-undef */
/**
 * PERF-01: k6 Load Test — Attendance endpoints
 *
 * Simulates peak-hour attendance marking:
 *   - 50 concurrent teachers each marking attendance for their class (10–40 students)
 *   - Both single-record and bulk submission paths
 *
 * Run:
 *   BASE_URL=http://localhost:5000/api \
 *   TEST_EMAIL=admin@school.com \
 *   TEST_PASSWORD=yourpassword \
 *   k6 run k6/attendance.k6.js
 *
 * Or pass IDs directly (skips setup auth):
 *   TOKEN=<jwt> CLASS_ID=<id> STUDENT_IDS=id1,id2,id3 k6 run k6/attendance.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const markDuration = new Trend('attendance_mark_duration_ms', true);
const bulkDuration = new Trend('attendance_bulk_duration_ms', true);
const totalRecords = new Counter('attendance_records_submitted');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';

export const options = {
  scenarios: {
    peak_hour: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 }, // 50 teachers simultaneously
        { duration: '2m', target: 50 }, // hold peak
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    errors: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    attendance_mark_duration_ms: ['p(95)<1500'],
    attendance_bulk_duration_ms: ['p(95)<2000'],
  },
};

/**
 * setup() runs once before all VUs start.
 * Authenticates and fetches real class + student IDs from the API.
 * Returns data that is passed to default() as the first argument.
 */
export function setup() {
  // If token and class ID are provided via env vars, skip auth
  if (__ENV.TOKEN && __ENV.CLASS_ID) {
    const studentIds = __ENV.STUDENT_IDS ? __ENV.STUDENT_IDS.split(',') : [];
    return {
      token: __ENV.TOKEN,
      classIds: [__ENV.CLASS_ID],
      studentIds,
    };
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

  // Step 2: Fetch real class IDs (up to 10)
  const classRes = http.get(`${BASE_URL}/classes?limit=10`, { headers: authHeaders });
  check(classRes, { 'setup: classes 200': (r) => r.status === 200 });

  const classBody = classRes.json();
  const classes =
    classBody?.classes || classBody?.data || (Array.isArray(classBody) ? classBody : []);
  const classIds = classes.map((c) => String(c._id)).filter(Boolean);

  if (classIds.length === 0) {
    throw new Error('setup() found no classes — seed the DB before running load tests');
  }

  // Step 3: Fetch student IDs from the first class
  const firstClassId = classIds[0];
  const studentRes = http.get(`${BASE_URL}/students?classId=${firstClassId}&limit=40`, {
    headers: authHeaders,
  });
  check(studentRes, { 'setup: students 200': (r) => r.status === 200 });

  const studentBody = studentRes.json();
  const students =
    studentBody?.students || studentBody?.data || (Array.isArray(studentBody) ? studentBody : []);
  const studentIds = students.map((s) => String(s._id)).filter(Boolean);

  if (studentIds.length === 0) {
    throw new Error(
      `setup() found no students in class ${firstClassId} — seed the DB before running load tests`
    );
  }

  console.log(`setup() ready — classes: ${classIds.length}, students: ${studentIds.length}`);
  return { token, classIds, studentIds };
}

// Generate a realistic attendance payload using real student IDs
function buildAttendancePayload(studentIds, count) {
  const statuses = ['present', 'absent', 'late', 'excused'];
  const today = new Date().toISOString().slice(0, 10);
  const slice = studentIds.slice(0, Math.min(count, studentIds.length));
  return slice.map((studentId, i) => ({
    studentId,
    status: i % 4 === 0 ? 'absent' : 'present',
    date: today,
  }));
}

export default function (data) {
  const { token, classIds, studentIds } = data;

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const vuId = __VU;
  const classId = classIds[vuId % classIds.length];
  const studentCount = 20 + (vuId % Math.min(20, studentIds.length));

  // ── Path A: Single-record mark ──────────────────────────────────────────────
  if (vuId % 2 === 0) {
    const record = buildAttendancePayload(studentIds, 1)[0];
    const start = Date.now();
    const res = http.post(`${BASE_URL}/attendance`, JSON.stringify({ ...record, classId }), {
      headers: authHeaders,
    });
    markDuration.add(Date.now() - start);

    const ok = check(res, {
      'single mark: 200 or 201': (r) => r.status === 200 || r.status === 201,
    });
    errorRate.add(!ok);
    if (ok) totalRecords.add(1);
  }

  // ── Path B: Bulk submission ─────────────────────────────────────────────────
  else {
    const records = buildAttendancePayload(studentIds, studentCount);
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/attendance/bulk`,
      JSON.stringify({ classId, date: new Date().toISOString().slice(0, 10), records }),
      { headers: authHeaders }
    );
    bulkDuration.add(Date.now() - start);

    const ok = check(res, {
      'bulk mark: 200 or 201': (r) => r.status === 200 || r.status === 201,
    });
    errorRate.add(!ok);
    if (ok) totalRecords.add(records.length);
  }

  sleep(1 + Math.random()); // 1-2s between requests
}
