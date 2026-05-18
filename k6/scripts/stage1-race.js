// Stage 1 (basic) — 락 없는 단순 구현의 race 재현.
// 가정: 좌석 1개에 동시 100명 → 1개만 성공해야 하지만 락 부재로 다수 성공 (oversell).
//
// 합격선 (Stage 1은 일부러 fail):
//   - http error rate < 1.0 (전부 5xx는 아님)
//   - 실제로 합격선 없이 oversell 수치 출력
//
// 실행:
//   docker compose --profile tools run --rm k6 run /scripts/stage1-race.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const HOST = __ENV.HOST || 'host.docker.internal:28080';
const SEAT_ID = __ENV.SEAT_ID || 1;
const VUS = parseInt(__ENV.VUS || 100);

const success = new Counter('reserve_success');
const failed = new Counter('reserve_failed');
const latency = new Trend('reserve_latency_ms', true);

export const options = {
  scenarios: {
    hot_seat_race: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: VUS,
      maxDuration: '30s',
    },
  },
  thresholds: {
    'reserve_latency_ms': ['p(99)<5000'],
  },
};

export default function () {
  const userId = `stage1-user-${__VU}`;
  const url = `http://${HOST}/seats/${SEAT_ID}/reservations`;
  const res = http.post(url, null, {
    headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
    tags: { stage: 'basic' },
  });
  latency.add(res.timings.duration);
  if (res.status === 201) success.add(1);
  else failed.add(1);
  check(res, { 'status 201 or 4xx': (r) => r.status === 201 || (r.status >= 400 && r.status < 500) });
}

export function handleSummary(data) {
  const successCount = data.metrics.reserve_success?.values?.count || 0;
  const failedCount = data.metrics.reserve_failed?.values?.count || 0;
  const p99 = data.metrics.reserve_latency_ms?.values['p(99)'] || 0;
  return {
    stdout: `\n===== STAGE 1 RESULT =====\nseat=${SEAT_ID} vus=${VUS}\nsuccess=${successCount} (oversell=${Math.max(0, successCount - 1)})\nfailed=${failedCount}\np99=${p99.toFixed(1)}ms\n==========================\n`,
  };
}
