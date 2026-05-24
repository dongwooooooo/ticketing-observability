// Stage 3 capacity probe — queue + admit gate 워크로드.
//
// 부하 패턴: 100 → 500 → 1000 → 2000 → 3500 → 5000 RPS (Stage 2 와 동일)
//
// 사용자 행동 → 서버 부위 → 무엇 때문에 → 사용자가 보는 결과:
//   행동: 콘서트 사전판매 오픈 직후 100~5000명/초가 대기열 입장 페이지에서 토큰을 받고
//        admit 폴링하다가 입장되면 좌석을 클릭
//   서버: WaitingTokenController.issue → InProcessWaitingQueue.enqueue (in-mem)
//        → WaitingQueueDispatcher tick (100ms마다 admit-rate-per-tick=100 명 입장)
//        → status 폴링 (admitted=true 되면 통과)
//        → ReservationController.reserve (X-Waiting-Token 검증 → CAS UPDATE → INSERT)
//   원인: admit-rate=1000/s 게이트로 backend reserve 처리량이 일정 상한에 묶임.
//        스펙별로 enqueue/status 처리량 / 큐 적재 깊이 / 사용자 체감 대기 시간이 달라짐.
//   결과: token_issued, admitted, reserve_success/failed, admit_wait_ms, total_latency_ms

import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const HOST = __ENV.HOST || 'localhost:28092';
const SPEC = __ENV.SPEC || 'unknown';
const SEAT_MAX = parseInt(__ENV.SEAT_MAX || 50000);

const tokenIssued = new Counter('token_issued');
const admitted = new Counter('admitted');
const reserveSuccess = new Counter('reserve_success');
const reserveFailed = new Counter('reserve_failed');
const reserveConflict = new Counter('reserve_conflict');
const admitTimeout = new Counter('admit_timeout');
const tokenFailed = new Counter('token_failed');
const admitWaitMs = new Trend('admit_wait_ms', true);
const totalLatency = new Trend('total_latency_ms', true);
const tokenLatency = new Trend('token_latency_ms', true);
const reserveLatency = new Trend('reserve_latency_ms', true);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 5000,
      stages: [
        { target: 100,  duration: '20s' },
        { target: 500,  duration: '30s' },
        { target: 1000, duration: '30s' },
        { target: 2000, duration: '30s' },
        { target: 3500, duration: '30s' },
        { target: 5000, duration: '30s' },
      ],
      tags: { spec: SPEC, scenario: 'ramp' },
    },
  },
  thresholds: {
    'total_latency_ms': ['p(99)<60000'],
  },
};

export default function () {
  const userId = `q-${__VU}-${__ITER}-${Date.now()}`;
  const start = Date.now();

  // Step 1: 토큰 발급
  const tokenRes = http.post(`http://${HOST}/waiting/tokens`, null, {
    headers: { 'X-User-Id': userId },
    timeout: '10s',
    tags: { step: 'token' },
  });
  tokenLatency.add(tokenRes.timings.duration);
  if (tokenRes.status !== 200 && tokenRes.status !== 201) {
    tokenFailed.add(1);
    return;
  }
  tokenIssued.add(1);
  let token;
  try {
    const body = tokenRes.json();
    token = body && body.token;
  } catch (e) {
    tokenFailed.add(1);
    return;
  }
  if (!token) {
    tokenFailed.add(1);
    return;
  }

  // Step 2: admit 폴링 — 최대 30초
  let isAdmitted = false;
  const pollStart = Date.now();
  for (let i = 0; i < 30; i++) {
    const statusRes = http.get(`http://${HOST}/waiting/tokens/${token}`, {
      timeout: '5s',
      tags: { step: 'status' },
    });
    if (statusRes.status === 200) {
      try {
        const body = statusRes.json();
        if (body && body.admitted === true) {
          isAdmitted = true;
          admitted.add(1);
          admitWaitMs.add(Date.now() - pollStart);
          break;
        }
      } catch (e) {
        // ignore parse error, retry
      }
    }
    sleep(1);
  }
  if (!isAdmitted) {
    admitTimeout.add(1);
    return;
  }

  // Step 3: 좌석 예약
  const seat = 1 + Math.floor(Math.random() * SEAT_MAX);
  const reserveRes = http.post(`http://${HOST}/seats/${seat}/reservations`, null, {
    headers: { 'X-User-Id': userId, 'X-Waiting-Token': token },
    timeout: '10s',
    tags: { step: 'reserve' },
  });
  reserveLatency.add(reserveRes.timings.duration);
  totalLatency.add(Date.now() - start);
  if (reserveRes.status === 201) {
    reserveSuccess.add(1);
  } else if (reserveRes.status === 409 || reserveRes.status === 400) {
    reserveConflict.add(1);
  } else {
    reserveFailed.add(1);
  }
}

export function handleSummary(data) {
  const ti = data.metrics.token_issued?.values?.count || 0;
  const ad = data.metrics.admitted?.values?.count || 0;
  const rs = data.metrics.reserve_success?.values?.count || 0;
  const rc = data.metrics.reserve_conflict?.values?.count || 0;
  const rf = data.metrics.reserve_failed?.values?.count || 0;
  const tf = data.metrics.token_failed?.values?.count || 0;
  const at = data.metrics.admit_timeout?.values?.count || 0;
  const aw50 = data.metrics.admit_wait_ms?.values['p(50)'] || 0;
  const aw95 = data.metrics.admit_wait_ms?.values['p(95)'] || 0;
  const aw99 = data.metrics.admit_wait_ms?.values['p(99)'] || 0;
  const awmax = data.metrics.admit_wait_ms?.values['max'] || 0;
  const tl50 = data.metrics.total_latency_ms?.values['p(50)'] || 0;
  const tl95 = data.metrics.total_latency_ms?.values['p(95)'] || 0;
  const tl99 = data.metrics.total_latency_ms?.values['p(99)'] || 0;
  const reqRate = data.metrics.http_reqs?.values?.rate || 0;
  const durSec = (data.state?.testRunDurationMs || 1) / 1000;
  const tokenRate = ti / durSec;
  const admittedRate = ad / durSec;
  const reserveRate = rs / durSec;
  const text = `
===== STAGE 3 CAPACITY PROBE — ${SPEC} =====
duration=${durSec.toFixed(1)}s http_reqs/s(avg)=${reqRate.toFixed(1)}
token_issued=${ti} (${tokenRate.toFixed(1)}/s) token_failed=${tf}
admitted=${ad} (${admittedRate.toFixed(1)}/s) admit_timeout=${at}
reserve_success=${rs} (${reserveRate.toFixed(1)}/s) reserve_conflict=${rc} reserve_failed=${rf}
admit_wait_ms p50=${aw50.toFixed(0)} p95=${aw95.toFixed(0)} p99=${aw99.toFixed(0)} max=${awmax.toFixed(0)}
total_latency_ms p50=${tl50.toFixed(0)} p95=${tl95.toFixed(0)} p99=${tl99.toFixed(0)}
=============================================
`;
  return {
    stdout: text,
    [`/results/${SPEC}/summary.txt`]: text,
  };
}
