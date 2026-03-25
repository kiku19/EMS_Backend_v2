/* eslint-disable no-undef */
/**
 * PERF-01: k6 Load Test — Authentication endpoints
 *
 * Scenarios:
 *   smoke  — 1 VU, 30s (sanity check)
 *   load   — 50 VUs, 5 min (normal load)
 *   stress — 200 VUs, 2 min (peak load)
 *
 * Run:
 *   BASE_URL=http://localhost:5000/api TOKEN=... k6 run k6/auth.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────────
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration_ms', true);
const refreshDuration = new Trend('refresh_duration_ms', true);

// ── Config ─────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';

const SCENARIOS = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
  },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 50 }, // ramp up
      { duration: '3m', target: 50 }, // hold
      { duration: '1m', target: 0 }, // ramp down
    ],
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 100 },
      { duration: '1m', target: 200 },
      { duration: '30s', target: 0 },
    ],
  },
};

const scenario = __ENV.SCENARIO || 'load';

export const options = {
  scenarios: { [scenario]: SCENARIOS[scenario] },
  thresholds: {
    errors: ['rate<0.01'], // < 1% error rate
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    login_duration_ms: ['p(95)<1500'],
    refresh_duration_ms: ['p(95)<500'],
  },
};

// ── Test data ──────────────────────────────────────────────────────────────────
const ADMIN_CREDENTIALS = {
  email: __ENV.ADMIN_EMAIL || 'admin@testschool.com',
  password: __ENV.ADMIN_PASSWORD || 'TestPass123!',
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ── Main scenario ──────────────────────────────────────────────────────────────
export default function () {
  // 1. Login
  const loginStart = Date.now();
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify(ADMIN_CREDENTIALS), {
    headers: JSON_HEADERS,
  });
  loginDuration.add(Date.now() - loginStart);

  const loginOk = check(loginRes, {
    'login: status 200': (r) => r.status === 200,
    'login: has token': (r) => !!r.json('token'),
  });
  errorRate.add(!loginOk);

  if (!loginOk) {
    sleep(1);
    return;
  }

  const token = loginRes.json('token');
  const AUTH_HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  sleep(0.5);

  // 2. Get current user profile (authenticated)
  const meRes = http.get(`${BASE_URL}/auth/me`, { headers: AUTH_HEADERS });
  const meOk = check(meRes, {
    'me: status 200': (r) => r.status === 200,
    'me: has schoolId': (r) => !!r.json('schoolId'),
  });
  errorRate.add(!meOk);

  sleep(0.5);

  // 3. Refresh token
  const refreshStart = Date.now();
  const refreshRes = http.post(`${BASE_URL}/auth/refresh`, JSON.stringify({ token }), {
    headers: AUTH_HEADERS,
  });
  refreshDuration.add(Date.now() - refreshStart);

  const refreshOk = check(refreshRes, {
    'refresh: status 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  errorRate.add(!refreshOk);

  sleep(1);
}
