#!/usr/bin/env bash
# Stage 3 capacity probe — per-spec orchestration.
#
# 13 사양 (Stage 2 와 동일 매트릭스):
#   a-1..a-5: backend + DB 비례
#   b-1..b-4: backend 변경 / DB 4cpu 고정
#   c-1..c-4: DB 변경 / backend 4cpu 고정
#
# ADMIT_RATE_PER_TICK=100 (= 1000/s) — Stage 2 단일 노드 peak (~1200 req/s) 안에 고정.

set -euo pipefail

SPEC="${1:-}"
if [[ -z "$SPEC" ]]; then
  echo "usage: $0 <a-1|a-2|a-3|a-4|a-5|b-1|b-2|b-3|b-4|c-1|c-2|c-3|c-4>" >&2
  exit 2
fi

# admit-rate 는 모든 spec 동일 (backend 한계 안)
export ADMIT_RATE_PER_TICK=100

case "$SPEC" in
  # === A 시리즈: backend + DB 비례 확장 ===
  a-1)
    export CPU_LIMIT=1; export MEM_LIMIT=2g; export POOL_SIZE=10
    export JAVA_OPTS="-Xmx1g -Xms1g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=1; export DB_MEM=1g
    ;;
  a-2)
    export CPU_LIMIT=2; export MEM_LIMIT=3g; export POOL_SIZE=20
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=2; export DB_MEM=2g
    ;;
  a-3)
    export CPU_LIMIT=3; export MEM_LIMIT=4g; export POOL_SIZE=30
    export JAVA_OPTS="-Xmx3g -Xms3g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=3; export DB_MEM=3g
    ;;
  a-4)
    export CPU_LIMIT=4; export MEM_LIMIT=4g; export POOL_SIZE=50
    export JAVA_OPTS="-Xmx3g -Xms3g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=3g
    ;;
  a-5)
    export CPU_LIMIT=5; export MEM_LIMIT=5g; export POOL_SIZE=80
    export JAVA_OPTS="-Xmx3g -Xms3g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=5; export DB_MEM=2g
    ;;
  # === B 시리즈: backend 확장, DB 4cpu 고정 ===
  b-1)
    export CPU_LIMIT=1; export MEM_LIMIT=2g; export POOL_SIZE=10
    export JAVA_OPTS="-Xmx1g -Xms1g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=4g
    ;;
  b-2)
    export CPU_LIMIT=2; export MEM_LIMIT=3g; export POOL_SIZE=20
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=4g
    ;;
  b-3)
    export CPU_LIMIT=4; export MEM_LIMIT=3g; export POOL_SIZE=50
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=4g
    ;;
  b-4)
    export CPU_LIMIT=5; export MEM_LIMIT=3g; export POOL_SIZE=80
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=4g
    ;;
  # === C 시리즈: DB 확장, backend 4cpu 고정 ===
  c-1)
    export CPU_LIMIT=4; export MEM_LIMIT=3g; export POOL_SIZE=50
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=1; export DB_MEM=2g
    ;;
  c-2)
    export CPU_LIMIT=4; export MEM_LIMIT=3g; export POOL_SIZE=50
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=2; export DB_MEM=2g
    ;;
  c-3)
    export CPU_LIMIT=4; export MEM_LIMIT=3g; export POOL_SIZE=50
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=4g
    ;;
  c-4)
    export CPU_LIMIT=4; export MEM_LIMIT=3g; export POOL_SIZE=50
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=6; export DB_MEM=2g
    ;;
  *)
    echo "unknown spec: $SPEC" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")" && pwd)"
RESULT_DIR="${RESULT_DIR:-${SPEC}}"
RESULTS="${ROOT}/results/${RESULT_DIR}"
K6_SPEC="${K6_SPEC:-stage3-${SPEC}}"
mkdir -p "${RESULTS}"

echo "=== ${SPEC}: CPU=${CPU_LIMIT} MEM=${MEM_LIMIT} POOL=${POOL_SIZE} DB_CPU=${DB_CPU} ADMIT_RATE=${ADMIT_RATE_PER_TICK}/tick"
echo "=== started at $(date -Iseconds)" | tee "${RESULTS}/meta.txt"
echo "CPU_LIMIT=${CPU_LIMIT} MEM_LIMIT=${MEM_LIMIT} POOL_SIZE=${POOL_SIZE} DB_CPU=${DB_CPU} DB_MEM=${DB_MEM} ADMIT_RATE_PER_TICK=${ADMIT_RATE_PER_TICK} JAVA_OPTS='${JAVA_OPTS}'" >> "${RESULTS}/meta.txt"

cd "${ROOT}/docker"

echo "--- compose down (clean previous state)"
docker compose -p stage3-capacity down -v --remove-orphans 2>&1 | tail -5 || true

echo "--- compose up"
docker compose -p stage3-capacity up -d --build 2>&1 | tail -10

echo "--- wait for app healthy (port 28092)"
for i in $(seq 1 120); do
  if curl -sf "http://localhost:28092/actuator/health" >/dev/null 2>&1; then
    echo "  ready after ${i}s"
    break
  fi
  sleep 1
  if [[ $i -eq 120 ]]; then
    echo "ERROR: app did not become healthy in 120s" >&2
    docker logs stage3cap-app --tail 200 > "${RESULTS}/app-failed-logs.txt" 2>&1
    docker compose -p stage3-capacity down -v --remove-orphans 2>&1 | tail -5 || true
    exit 3
  fi
done

# warmup nudge — token 발급/admit/reserve 한 사이클
WARMUP_TOKEN=$(curl -sf -X POST -H "X-User-Id: warmup" "http://localhost:28092/waiting/tokens" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' || true)
sleep 1
curl -sf "http://localhost:28092/waiting/tokens/${WARMUP_TOKEN}" >/dev/null 2>&1 || true

echo "--- start docker stats collector (2s interval, background)"
(
  while true; do
    ts=$(date -Iseconds)
    docker stats --no-stream --format "{{.Container}} {{.CPUPerc}} {{.MemUsage}} {{.MemPerc}}" \
      stage3cap-app stage3cap-postgres 2>/dev/null | sed "s|^|${ts} |"
    sleep 2
  done
) > "${RESULTS}/docker-stats-stream.txt" 2>&1 &
STATS_PID=$!

echo "--- k6 probe (host network; results → ${RESULTS}/)"
K6_OUTPUT_ARGS=()
K6_REMOTE_WRITE="${K6_REMOTE_WRITE:-auto}"
K6_SUMMARY_TREND_STATS="${K6_SUMMARY_TREND_STATS:-avg,min,med,max,p(90),p(95),p(99)}"
if [[ "$K6_REMOTE_WRITE" != "0" ]]; then
  if curl -sf "http://localhost:9090/-/ready" >/dev/null 2>&1; then
    export K6_PROMETHEUS_RW_SERVER_URL="${K6_PROMETHEUS_RW_SERVER_URL:-http://localhost:9090/api/v1/write}"
    export K6_PROMETHEUS_RW_TREND_STATS="${K6_PROMETHEUS_RW_TREND_STATS:-p(95),p(99),min,max}"
    K6_OUTPUT_ARGS=(-o experimental-prometheus-rw)
    echo "--- k6 remote write enabled: ${K6_PROMETHEUS_RW_SERVER_URL}"
  elif [[ "$K6_REMOTE_WRITE" == "1" ]]; then
    echo "ERROR: K6_REMOTE_WRITE=1 but Prometheus is not ready at http://localhost:9090" >&2
    exit 2
  fi
fi
K6_EXIT=0
if command -v k6 >/dev/null 2>&1; then
  k6 run "${K6_OUTPUT_ARGS[@]}" \
    --summary-trend-stats "$K6_SUMMARY_TREND_STATS" \
    -e HOST="localhost:28092" \
    -e SPEC="${K6_SPEC}" \
    -e SEAT_MAX=50000 \
    --summary-export "${RESULTS}/summary.json" \
    "${ROOT}/k6/capacity-probe.js" 2>&1 | tee "${RESULTS}/k6-stdout.txt" || K6_EXIT=$?
else
  docker run --rm --network host \
    -v "${ROOT}/k6:/scripts:ro" \
    -v "${RESULTS}:/results" \
    -e HOST="localhost:28092" \
    -e SPEC="${K6_SPEC}" \
    -e SEAT_MAX=50000 \
    grafana/k6:0.53.0 run \
      --summary-trend-stats "$K6_SUMMARY_TREND_STATS" \
      --summary-export "/results/summary.json" \
      /scripts/capacity-probe.js 2>&1 | tee "${RESULTS}/k6-stdout.txt" || K6_EXIT=$?
fi
echo "--- k6 exit code: ${K6_EXIT}" | tee -a "${RESULTS}/meta.txt"

if [[ "${#K6_OUTPUT_ARGS[@]}" -gt 0 ]]; then
  TIMESERIES_PATH="screenshots/portfolio-evidence/prometheus-timeseries/${K6_SPEC}.json"
  echo "--- export Prometheus time series: ${TIMESERIES_PATH}"
  (cd "$ROOT/.." && ./scripts/export-prometheus-timeseries.mjs --spec "$K6_SPEC" --out "$TIMESERIES_PATH") \
    || echo "WARN: Prometheus time series export failed (summary/log retained)"
fi

echo "--- stop docker stats collector"
kill $STATS_PID 2>/dev/null || true

echo "--- collect actuator prometheus"
curl -s "http://localhost:28092/actuator/prometheus" > "${RESULTS}/actuator-prometheus.txt" 2>&1 || true

echo "--- collect final docker stats snapshot"
docker stats --no-stream --format "{{.Container}} {{.CPUPerc}} {{.MemUsage}} {{.MemPerc}}" \
  stage3cap-app stage3cap-postgres > "${RESULTS}/docker-stats.txt" 2>&1 || true

echo "--- app logs tail"
docker logs stage3cap-app --tail 300 > "${RESULTS}/app-logs.txt" 2>&1 || true

echo "--- compose down"
docker compose -p stage3-capacity down -v --remove-orphans 2>&1 | tail -5 || true

echo "=== ${SPEC} done at $(date -Iseconds)" | tee -a "${RESULTS}/meta.txt"
