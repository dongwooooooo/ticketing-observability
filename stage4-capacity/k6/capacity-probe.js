// Stage 4 capacity probe — backend × 2 + Nginx LB + Redis 분산 큐/락.
//
// 부하 패턴: Stage 3 와 동일 (100 → 500 → 1000 → 2000 → 3500 → 5000 RPS).
// 비교 대상: Stage 3 단일 backend 측정값 (queue/queue-load-output.txt).
//
// 사용자 행동 → 서버 부위 → 무엇 때문에 → 사용자가 보는 결과:
//   행동: 사용자가 LB 주소(28093)로 토큰 요청 → admit 폴링 → 좌석 클릭
//   서버: Nginx → app1 또는 app2 (round-robin) → RedisWaitingQueue / DistributedSeatLock
//        → SeatRepository.casHold (fencing token 검증)
//   원인: backend 가 2 대라 throughput 이 단일 대비 ~1.8x 가능 (LB overhead 감안)
//        Redis 가 큐/락의 단일 진실원 — admit/lock 상태가 모든 인스턴스에서 동일
//   결과: token_issued / admitted / reserve_success / reserve_failed / 인스턴스별 라우팅 분포

import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const HOST = __ENV.HOST || 'localhost:28093';
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

  // Step 2: admit 폴링 (최대 20초)
  const admitStart = Date.now();
  let admittedFlag = false;
  for (let i = 0; i < 100; i++) {
    const statusRes = http.get(`http://${HOST}/waiting/tokens/${token}`, {
      timeout: '5s',
      tags: { step: 'status' },
    });
    if (statusRes.status === 200) {
      try {
        const body = statusRes.json();
        if (body.admitted) {
          admittedFlag = true;
          admitWaitMs.add(Date.now() - admitStart);
          admitted.add(1);
          break;
        }
      } catch (e) { }
    }
    sleep(0.2);
  }
  if (!admittedFlag) {
    admitTimeout.add(1);
    return;
  }

  // Step 3: 좌석 예약
  const seatId = Math.floor(Math.random() * SEAT_MAX) + 1;
  const reserveRes = http.post(
    `http://${HOST}/reservations`,
    JSON.stringify({ seatId: seatId }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-Waiting-Token': token,
      },
      timeout: '10s',
      tags: { step: 'reserve' },
    });
  reserveLatency.add(reserveRes.timings.duration);
  if (reserveRes.status === 201 || reserveRes.status === 200) {
    reserveSuccess.add(1);
  } else if (reserveRes.status === 409) {
    reserveConflict.add(1);
  } else {
    reserveFailed.add(1);
  }
  totalLatency.add(Date.now() - start);
}
