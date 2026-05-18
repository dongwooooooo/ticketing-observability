// Stage 3 (queue) — 대기열 토큰 gate 적용.
// 흐름:
//   1. POST /waiting/tokens 으로 토큰 발급
//   2. GET /waiting/tokens/{token} 을 200ms 주기로 폴링하다가 admitted=true 되면 진행
//   3. X-Waiting-Token 헤더로 POST /seats/{seatId}/reservations 호출
//
// 가정:
//   - dispatcher 가 100ms마다 N=10 admit (= 100/sec)
//   - hot seat 시나리오: 200 VU enqueue → 처리량 100/s 로 점진 admit → 예약은 1개만 성공
//   - 분산 시나리오: sustained 200 TPS — gate 가 backpressure 적용 (admit rate 한계까지)
//
// 실행:
//   docker compose --profile tools run --rm k6 run /scripts/stage3-queue.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const HOST = __ENV.HOST || 'host.docker.internal:28082';
const SEAT_ID = __ENV.SEAT_ID || 1;
const VUS = parseInt(__ENV.VUS || 200);
const SUSTAINED_RATE = parseInt(__ENV.SUSTAINED_RATE || 200);
const SUSTAINED_DUR = __ENV.SUSTAINED_DUR || '60s';
const POLL_TIMEOUT_S = parseInt(__ENV.POLL_TIMEOUT_S || 30);

const reserveSuccess = new Counter('reserve_success');
const reserveFailed = new Counter('reserve_failed');
const reserveLatency = new Trend('reserve_latency_ms', true);
const totalGateLatency = new Trend('gate_to_reserve_ms', true);
const enqueueLatency = new Trend('enqueue_latency_ms', true);
const errorRate = new Rate('error_rate');
const admitted = new Counter('admitted_count');
const timedOut = new Counter('admit_timeout');

export const options = {
  scenarios: {
    hot_seat_with_gate: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: VUS,
      maxDuration: '90s',
      exec: 'hotSeatGated',
    },
    sustained_with_gate: {
      executor: 'constant-arrival-rate',
      rate: SUSTAINED_RATE,
      timeUnit: '1s',
      duration: SUSTAINED_DUR,
      preAllocatedVUs: 100,
      maxVUs: 500,
      startTime: '95s',
      exec: 'distributedGated',
    },
  },
  thresholds: {
    'gate_to_reserve_ms{scenario:sustained_with_gate}': ['p(99)<5000'],
  },
};

function enqueue(userId) {
  const t0 = Date.now();
  const res = http.post(`http://${HOST}/waiting/tokens`, null, {
    headers: { 'X-User-Id': userId },
    tags: { stage: 'queue', op: 'enqueue' },
  });
  enqueueLatency.add(Date.now() - t0);
  if (res.status !== 200 && res.status !== 201) return null;
  const body = res.json();
  return body.token;
}

function pollUntilAdmitted(token) {
  const deadline = Date.now() + POLL_TIMEOUT_S * 1000;
  while (Date.now() < deadline) {
    const r = http.get(`http://${HOST}/waiting/tokens/${token}`, {
      tags: { stage: 'queue', op: 'poll' },
    });
    if (r.status === 200) {
      const b = r.json();
      if (b.admitted === true) return true;
    }
    sleep(0.2);
  }
  return false;
}

function reserve(seat, userId, token) {
  const res = http.post(`http://${HOST}/seats/${seat}/reservations`, null, {
    headers: { 'X-User-Id': userId, 'X-Waiting-Token': token },
    tags: { stage: 'queue', op: 'reserve' },
  });
  reserveLatency.add(res.timings.duration);
  if (res.status === 201) reserveSuccess.add(1);
  else reserveFailed.add(1);
  errorRate.add(res.status >= 500);
  return res;
}

export function hotSeatGated() {
  const userId = `s3-hot-${__VU}-${__ITER}`;
  const start = Date.now();
  const token = enqueue(userId);
  if (!token) return;
  const ok = pollUntilAdmitted(token);
  if (!ok) {
    timedOut.add(1);
    return;
  }
  admitted.add(1);
  reserve(SEAT_ID, userId, token);
  totalGateLatency.add(Date.now() - start);
}

export function distributedGated() {
  const userId = `s3-dist-${__VU}-${__ITER}`;
  const start = Date.now();
  const token = enqueue(userId);
  if (!token) return;
  const ok = pollUntilAdmitted(token);
  if (!ok) {
    timedOut.add(1);
    return;
  }
  admitted.add(1);
  const seat = 1 + Math.floor(Math.random() * 100);
  reserve(seat, userId, token);
  totalGateLatency.add(Date.now() - start);
}

export function handleSummary(data) {
  const s = data.metrics.reserve_success?.values?.count || 0;
  const f = data.metrics.reserve_failed?.values?.count || 0;
  const a = data.metrics.admitted_count?.values?.count || 0;
  const t = data.metrics.admit_timeout?.values?.count || 0;
  const p99 = data.metrics.gate_to_reserve_ms?.values['p(99)'] || 0;
  const p50 = data.metrics.gate_to_reserve_ms?.values['p(50)'] || 0;
  return {
    stdout: `\n===== STAGE 3 RESULT =====\nadmitted=${a} timedOut=${t}\nreserve success=${s} failed=${f}\ngate+reserve p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms\n==========================\n`,
  };
}
