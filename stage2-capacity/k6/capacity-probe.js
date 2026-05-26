// Stage 2 capacity probe — ramping arrival rate to find per-spec ceiling.
//
// 부하 패턴: 50 → 100 → 200 → 500 → 1000 → 2000 RPS (각 30s)
// 시나리오: distributed (좌석 1..1000 random) — 한계 측정 대상은 application 처리량 자체.
//          hot 시나리오는 별도 짧은 burst 로 측정 (capacity-hot.js).
//
// 사용자 행동 → 서버 부위 → 무엇 때문에 → 사용자가 보는 결과:
//   행동: 콘서트 사전판매 오픈 직후 50~2000명/초가 좌석 1..1000 중 임의 좌석 클릭
//   서버: ReservationController.reserve() → CAS UPDATE → reservation INSERT
//   원인: spec-N 의 CPU/MEM/Pool 제한이 어디서 먼저 포화되는가
//   결과: 응답시간 p99, 성공률, throughput
//
// 실행 (docker network 외부 직접 호출):
//   k6 run -e HOST=localhost:28091 -e SPEC=spec-1 capacity-probe.js \
//          --summary-export=results/spec-1/summary.json \
//          --out json=results/spec-1/raw.json

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

const HOST = __ENV.HOST || 'localhost:28091';
const SPEC = __ENV.SPEC || 'unknown';
const SEAT_MAX = parseInt(__ENV.SEAT_MAX || 1000);

const success = new Counter('reserve_success');
const conflict = new Counter('reserve_conflict');
const failed = new Counter('reserve_failed');
const latency = new Trend('reserve_latency_ms', true);
const errorRate = new Rate('error_rate');
const serverErr = new Rate('server_5xx');

export const options = {
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 5000,
      stages: [
        { target: 100,  duration: '20s' }, // warmup
        { target: 500,  duration: '30s' },
        { target: 1000, duration: '30s' },
        { target: 2000, duration: '30s' },
        { target: 3500, duration: '30s' },
        { target: 5000, duration: '30s' }, // peak
      ],
      tags: { spec: SPEC, scenario: 'ramp' },
    },
  },
  // thresholds 는 측정용. 실패해도 결과 수집은 진행.
  thresholds: {
    'reserve_latency_ms': ['p(99)<5000'],
    'server_5xx': ['rate<0.10'],
  },
};

export default function () {
  const seat = 1 + Math.floor(Math.random() * SEAT_MAX);
  const userId = `cap-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(`http://${HOST}/seats/${seat}/reservations`, null, {
    headers: { 'X-User-Id': userId },
    tags: { spec: SPEC, step: 'reserve', name: 'POST /seats/{seatId}/reservations' },
    timeout: '10s',
  });
  latency.add(res.timings.duration);
  if (res.status === 201) {
    success.add(1);
  } else if (res.status === 409 || res.status === 400) {
    // CAS miss / unique violation / seat sold out — 정상 race loss.
    conflict.add(1);
  } else {
    failed.add(1);
  }
  errorRate.add(res.status >= 500 || res.status === 0);
  serverErr.add(res.status >= 500);
}

export function handleSummary(data) {
  const s = data.metrics.reserve_success?.values?.count || 0;
  const c = data.metrics.reserve_conflict?.values?.count || 0;
  const f = data.metrics.reserve_failed?.values?.count || 0;
  const p50 = data.metrics.reserve_latency_ms?.values['p(50)'] || 0;
  const p95 = data.metrics.reserve_latency_ms?.values['p(95)'] || 0;
  const p99 = data.metrics.reserve_latency_ms?.values['p(99)'] || 0;
  const max = data.metrics.reserve_latency_ms?.values['max'] || 0;
  const reqRate = data.metrics.http_reqs?.values?.rate || 0;
  const fail5xx = data.metrics.server_5xx?.values?.rate || 0;
  const errAll = data.metrics.error_rate?.values?.rate || 0;
  const text = `
===== STAGE 2 CAPACITY PROBE — ${SPEC} =====
http_reqs/s (avg) = ${reqRate.toFixed(1)}
success=${s} conflict=${c} failed=${f}
p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${max.toFixed(1)}ms
5xx_rate=${(fail5xx*100).toFixed(2)}% all_err_rate=${(errAll*100).toFixed(2)}%
=============================================
`;
  return {
    stdout: text,
  };
}
