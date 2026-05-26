#!/usr/bin/env bash
# Stage 2 capacity probe — per-spec orchestration.
#
# 사용: ./run-spec.sh spec-1
# Specs:
#   spec-1: 1 cpu / 2g / pool=10 / -Xmx1g  (~m5.large)
#   spec-2: 2 cpu / 4g / pool=20 / -Xmx2g  (~m5.xlarge)
#   spec-3: 4 cpu / 8g / pool=50 / -Xmx4g  (~m5.2xlarge)
#   spec-4: 8 cpu / 16g / pool=100 / -Xmx8g (~m5.4xlarge)
#
# 절차:
#   1. compose down (이전 잔재 정리; postgres volume도 함께 제거하여 매 spec 동일 초기상태)
#   2. spec 환경변수 export + compose up
#   3. /actuator/health UP 까지 polling (<= 90s)
#   4. k6 capacity-probe.js 실행 → results/${SPEC}/
#   5. /actuator/prometheus dump → results/${SPEC}/actuator-prometheus.txt
#   6. docker stats 1 sample → results/${SPEC}/docker-stats.txt
#   7. compose down
set -euo pipefail

SPEC="${1:-}"
if [[ -z "$SPEC" ]]; then
  echo "usage: $0 <spec-1|spec-2|spec-3|spec-4>" >&2
  exit 2
fi

case "$SPEC" in
  spec-1)
    export CPU_LIMIT=1
    export MEM_LIMIT=2g
    export POOL_SIZE=10
    export JAVA_OPTS="-Xmx1g -Xms1g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    ;;
  spec-2)
    export CPU_LIMIT=2
    export MEM_LIMIT=4g
    export POOL_SIZE=20
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    ;;
  spec-3)
    export CPU_LIMIT=4
    export MEM_LIMIT=8g
    export POOL_SIZE=50
    export JAVA_OPTS="-Xmx4g -Xms4g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    ;;
  spec-4)
    # Docker Desktop CPU 10 — spec-4 = 8 cpu. Memory 7.6GiB 한도 안에 heap fit.
    export CPU_LIMIT=8
    export MEM_LIMIT=7g
    export POOL_SIZE=100
    export JAVA_OPTS="-Xmx5g -Xms5g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=1
    export DB_MEM=2g
    ;;
  spec-5)
    # 호스트 자원 최대 활용 — backend 10 cpu (호스트 한계). DB 1 cpu (양보).
    export CPU_LIMIT=10
    export MEM_LIMIT=7g
    export POOL_SIZE=200
    export JAVA_OPTS="-Xmx5g -Xms5g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=1
    export DB_MEM=2g
    ;;
  db-1)
    # backend = spec-4 fixed, DB = small (1cpu/2g)
    export CPU_LIMIT=5
    export MEM_LIMIT=16g
    export POOL_SIZE=100
    export JAVA_OPTS="-Xmx8g -Xms8g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=1
    export DB_MEM=2g
    ;;
  db-2)
    # backend = spec-4 fixed, DB = medium (2cpu/4g)
    export CPU_LIMIT=5
    export MEM_LIMIT=16g
    export POOL_SIZE=100
    export JAVA_OPTS="-Xmx8g -Xms8g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=2
    export DB_MEM=4g
    ;;
  db-3)
    # backend = spec-4 fixed, DB = large (4cpu/8g)
    export CPU_LIMIT=5
    export MEM_LIMIT=16g
    export POOL_SIZE=100
    export JAVA_OPTS="-Xmx8g -Xms8g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4
    export DB_MEM=8g
    ;;
  # === A 시리즈: backend + DB 비례 확장 (균형) ===
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
    # 호스트 한계 (backend+DB=10cpu, k6/macOS 양보)
    export CPU_LIMIT=5; export MEM_LIMIT=5g; export POOL_SIZE=80
    export JAVA_OPTS="-Xmx3g -Xms3g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=5; export DB_MEM=2g
    ;;
  # === B 시리즈: backend 확장, DB 4cpu 고정 (backend bottleneck 식별) ===
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
    # backend=5 + DB=4 = 9cpu (호스트 10 안에서)
    export CPU_LIMIT=5; export MEM_LIMIT=3g; export POOL_SIZE=80
    export JAVA_OPTS="-Xmx2g -Xms2g -XX:+UseG1GC -XX:MaxGCPauseMillis=200"
    export DB_CPU=4; export DB_MEM=4g
    ;;
  # === C 시리즈: DB 확장, backend 4cpu 고정 (DB bottleneck 식별) ===
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
    # backend=4 + DB=6 = 10cpu (호스트 한계)
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
K6_SPEC="${K6_SPEC:-stage2-${SPEC}}"
mkdir -p "${RESULTS}"

echo "=== ${SPEC}: CPU=${CPU_LIMIT} MEM=${MEM_LIMIT} POOL=${POOL_SIZE} JAVA_OPTS=${JAVA_OPTS}"
echo "=== started at $(date -Iseconds)" | tee "${RESULTS}/meta.txt"

cd "${ROOT}/docker"

echo "--- compose down (clean previous state)"
docker compose -p stage2-capacity down -v --remove-orphans 2>&1 | tail -5 || true

echo "--- compose up"
docker compose -p stage2-capacity up -d --build 2>&1 | tail -10

echo "--- wait for app healthy (port 28091)"
for i in $(seq 1 90); do
  if curl -sf "http://localhost:28091/actuator/health" >/dev/null 2>&1; then
    echo "  ready after ${i}s"
    break
  fi
  sleep 1
  if [[ $i -eq 90 ]]; then
    echo "ERROR: app did not become healthy in 90s" >&2
    docker logs stage2cap-app --tail 100 > "${RESULTS}/app-failed-logs.txt" 2>&1
    exit 3
  fi
done

# small warmup nudge
curl -sf -X POST -H "X-User-Id: warmup" "http://localhost:28091/seats/9999/reservations" >/dev/null 2>&1 || true

echo "--- start docker stats collector (1s interval, background)"
# Streaming docker stats during k6 run.
(
  while true; do
    ts=$(date -Iseconds)
    docker stats --no-stream --format "{{.Container}} {{.CPUPerc}} {{.MemUsage}} {{.MemPerc}}" \
      stage2cap-app stage2cap-postgres 2>/dev/null | sed "s|^|${ts} |"
    sleep 2
  done
) > "${RESULTS}/docker-stats-stream.txt" 2>&1 &
STATS_PID=$!

echo "--- k6 probe (host network; results → ${RESULTS}/)"
# k6 runs from host (brew install k6) — bypasses docker network entanglement.
# Falls back to dockerized k6 if local k6 unavailable.
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
    -e HOST="localhost:28091" \
    -e SPEC="${K6_SPEC}" \
    -e SEAT_MAX=50000 \
    --summary-export "${RESULTS}/summary.json" \
    "${ROOT}/k6/capacity-probe.js" 2>&1 | tee "${RESULTS}/k6-stdout.txt" || K6_EXIT=$?
else
  docker run --rm --network host \
    -v "${ROOT}/k6:/scripts:ro" \
    -v "${RESULTS}:/results" \
    -e HOST="localhost:28091" \
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

echo "--- collect actuator prometheus (peak metrics)"
curl -s "http://localhost:28091/actuator/prometheus" > "${RESULTS}/actuator-prometheus.txt" 2>&1 || true

echo "--- collect final docker stats snapshot"
docker stats --no-stream --format "{{.Container}} {{.CPUPerc}} {{.MemUsage}} {{.MemPerc}}" \
  stage2cap-app stage2cap-postgres > "${RESULTS}/docker-stats.txt" 2>&1 || true

echo "--- app logs tail"
docker logs stage2cap-app --tail 200 > "${RESULTS}/app-logs.txt" 2>&1 || true

echo "--- compose down"
docker compose -p stage2-capacity down -v --remove-orphans 2>&1 | tail -5 || true

echo "=== ${SPEC} done at $(date -Iseconds)" | tee -a "${RESULTS}/meta.txt"
