// Stage 4 scale comparison probe.
//
// 목적:
// - 5K RPS 한계 탐색이 아니라 backend 1대/2대 비교가 가능한 조건을 만든다.
// - Redis timeout, k6 dropped iterations, macOS ephemeral port 고갈이 먼저 터지지 않는 범위에서 측정한다.

import http from 'k6/http';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

const HOST = __ENV.HOST || 'localhost:28093';
const SPEC = __ENV.SPEC || 'stage4-scale';
const SEAT_MAX = parseInt(__ENV.SEAT_MAX || '50000');
const SCALE_TARGETS = (__ENV.SCALE_TARGETS || '100,250,400,550,700')
  .split(',')
  .map((v) => parseInt(v.trim(), 10))
  .filter((v) => !Number.isNaN(v));
const SCALE_DURATIONS = (__ENV.SCALE_DURATIONS || '20s,20s,30s,30s,30s')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const START_RATE = parseInt(__ENV.START_RATE || '50', 10);
const PRE_ALLOCATED_VUS = parseInt(__ENV.PRE_ALLOCATED_VUS || '300', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '1200', 10);
const DROPPED_THRESHOLD = parseInt(__ENV.DROPPED_THRESHOLD || '100', 10);

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
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: START_RATE,
      timeUnit: '1s',
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
      stages: SCALE_TARGETS.map((target, index) => ({
        target,
        duration: SCALE_DURATIONS[index] || SCALE_DURATIONS[SCALE_DURATIONS.length - 1] || '30s',
      })),
      tags: { spec: SPEC, scenario: 'scale-ramp' },
    },
  },
  thresholds: {
    dropped_iterations: [`count<${DROPPED_THRESHOLD}`],
    token_failed: ['count<100'],
  },
};

export default function () {
  const userId = `scale-${__VU}-${__ITER}-${Date.now()}`;
  const start = Date.now();

  const tokenRes = http.post(`http://${HOST}/waiting/tokens`, null, {
    headers: { 'X-User-Id': userId },
    timeout: '5s',
    tags: { step: 'token', name: 'POST /waiting/tokens' },
  });
  tokenLatency.add(tokenRes.timings.duration);
  if (tokenRes.status !== 200 && tokenRes.status !== 201) {
    tokenFailed.add(1);
    return;
  }

  let token;
  try {
    token = tokenRes.json().token;
  } catch (e) {
    tokenFailed.add(1);
    return;
  }
  if (!token) {
    tokenFailed.add(1);
    return;
  }
  tokenIssued.add(1);

  const admitStart = Date.now();
  let admittedFlag = false;
  for (let i = 0; i < 20; i++) {
    const statusRes = http.get(`http://${HOST}/waiting/tokens/${token}`, {
      timeout: '3s',
      tags: { step: 'status', name: 'GET /waiting/tokens/{token}' },
    });
    if (statusRes.status === 200) {
      try {
        if (statusRes.json().admitted) {
          admittedFlag = true;
          admitted.add(1);
          admitWaitMs.add(Date.now() - admitStart);
          break;
        }
      } catch (e) {}
    }
    sleep(0.1);
  }
  if (!admittedFlag) {
    admitTimeout.add(1);
    return;
  }

  const seatId = (exec.scenario.iterationInTest % SEAT_MAX) + 1;
  const reserveRes = http.post(`http://${HOST}/seats/${seatId}/reservations`, null, {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-Waiting-Token': token,
    },
    timeout: '5s',
    tags: { step: 'reserve', name: 'POST /seats/{seatId}/reservations' },
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
