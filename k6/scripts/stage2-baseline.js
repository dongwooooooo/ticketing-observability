// Stage 2 (concurrency) — 비관적 락 + partial UNIQUE 베이스라인.
// 가정:
//   - Hot seat 100 동시: 정확히 1개 success, 99개 4xx
//   - Sustained 200 TPS 60s on seats 1..100: p99 < 1000ms 목표
//
// 실행:
//   docker compose --profile tools run --rm k6 run /scripts/stage2-baseline.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const HOST = __ENV.HOST || 'host.docker.internal:28081';
const SEAT_ID = __ENV.SEAT_ID || 1;
const VUS = parseInt(__ENV.VUS || 100);
const SUSTAINED_RATE = parseInt(__ENV.SUSTAINED_RATE || 200);
const SUSTAINED_DUR = __ENV.SUSTAINED_DUR || '60s';

const success = new Counter('reserve_success');
const failed = new Counter('reserve_failed');
const latency = new Trend('reserve_latency_ms', true);
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    hot_seat: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: VUS,
      maxDuration: '30s',
      exec: 'hotSeat',
    },
    sustained_distributed: {
      executor: 'constant-arrival-rate',
      rate: SUSTAINED_RATE,
      timeUnit: '1s',
      duration: SUSTAINED_DUR,
      preAllocatedVUs: 100,
      maxVUs: 500,
      startTime: '35s',
      exec: 'distributed',
    },
  },
  thresholds: {
    'reserve_latency_ms{scenario:sustained_distributed}': ['p(99)<2000'],
    'error_rate{scenario:sustained_distributed}': ['rate<0.05'],
  },
};

export function hotSeat() {
  const userId = `s2-hot-${__VU}-${__ITER}`;
  const res = http.post(`http://${HOST}/seats/${SEAT_ID}/reservations`, null, {
    headers: { 'X-User-Id': userId },
    tags: { stage: 'concurrency', scenario: 'hot_seat' },
  });
  latency.add(res.timings.duration);
  if (res.status === 201) success.add(1);
  else failed.add(1);
  errorRate.add(res.status >= 500);
}

export function distributed() {
  // 좌석 1~100 random
  const seat = 1 + Math.floor(Math.random() * 100);
  const userId = `s2-dist-${__VU}-${__ITER}`;
  const res = http.post(`http://${HOST}/seats/${seat}/reservations`, null, {
    headers: { 'X-User-Id': userId },
    tags: { stage: 'concurrency', scenario: 'sustained_distributed' },
  });
  latency.add(res.timings.duration);
  if (res.status === 201) success.add(1);
  else failed.add(1);
  errorRate.add(res.status >= 500);
}

export function handleSummary(data) {
  const s = data.metrics.reserve_success?.values?.count || 0;
  const f = data.metrics.reserve_failed?.values?.count || 0;
  const p99 = data.metrics.reserve_latency_ms?.values['p(99)'] || 0;
  const p50 = data.metrics.reserve_latency_ms?.values['p(50)'] || 0;
  return {
    stdout: `\n===== STAGE 2 RESULT =====\nsuccess=${s} failed=${f}\np50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms\n==========================\n`,
  };
}
