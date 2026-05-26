#!/usr/bin/env bash
# Stage 4 probe — fixed DB/Redis/LB, variable backend count.
#
# 사양 (Mac 한계 안):
#   app1, app2: 각 2 cpu / 2g (합 4 cpu)
#   redis: 2 cpu / 2g
#   postgres: 2 cpu / 2g
#   nginx LB: 0.5 cpu
#
# 산출물: results/stage4-{single|dual}-{capacity|scale}.summary.json
#
# 사용:
#   ./run-stage4.sh                          # 기본 capacity probe (backend × 2)
#   ./run-stage4.sh single                   # capacity probe 단일 backend
#   LOAD_PROFILE=scale ./run-stage4.sh dual    # scale 비교용 probe
#   LOAD_PROFILE=opening ./run-stage4.sh dual  # 티켓 오픈 surge probe
#   FAILOVER=1 ./run-stage4.sh               # 부하 중 app1 stop 시뮬

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/docker"

MODE="${1:-dual}"
LOAD_PROFILE="${LOAD_PROFILE:-capacity}"
RESULT_SUFFIX="${RESULT_SUFFIX:-}"
JAR_SOURCE="/Users/idong-u/d/ticketing/distributed/build/libs/distributed-0.0.1-SNAPSHOT.jar"

# Build 보장
if [[ ! -f "$JAR_SOURCE" ]]; then
  echo "[stage4] building distributed jar..." >&2
  (cd /Users/idong-u/d/ticketing && ./gradlew :distributed:bootJar -x test)
fi
cp "$JAR_SOURCE" ./distributed-0.0.1-SNAPSHOT.jar

# 환경 변수. 기본값은 scale 비교가 Redis/k6 한계에 먼저 걸리지 않도록 조정한다.
export APP_CPU="${APP_CPU:-2}"
export APP_MEM="${APP_MEM:-2g}"
export DB_CPU="${DB_CPU:-2}"
export DB_MEM="${DB_MEM:-2g}"
export REDIS_CPU="${REDIS_CPU:-2}"
export REDIS_MEM="${REDIS_MEM:-2g}"
export NGINX_CPU="${NGINX_CPU:-0.5}"
export NGINX_MEM="${NGINX_MEM:-256m}"
export POOL_SIZE="${POOL_SIZE:-10}"
export JAVA_OPTS="${JAVA_OPTS:--Xmx1500m -XX:+UseG1GC -XX:MaxGCPauseMillis=200}"

case "$LOAD_PROFILE" in
  capacity)
    export ADMIT_RATE_PER_TICK="${ADMIT_RATE_PER_TICK:-100}"
    K6_SCRIPT="$SCRIPT_DIR/k6/capacity-probe.js"
    ;;
  scale)
    export ADMIT_RATE_PER_TICK="${ADMIT_RATE_PER_TICK:-250}"
    K6_SCRIPT="$SCRIPT_DIR/k6/scale-comparison.js"
    ;;
  opening)
    export ADMIT_RATE_PER_TICK="${ADMIT_RATE_PER_TICK:-250}"
    K6_SCRIPT="$SCRIPT_DIR/k6/opening-surge.js"
    ;;
  *)
    echo "[stage4] unsupported LOAD_PROFILE: $LOAD_PROFILE (use capacity, scale, or opening)" >&2
    exit 2
    ;;
esac

case "$MODE" in
  single)
    export NGINX_CONF="./nginx.single.conf"
    ;;
  dual)
    export NGINX_CONF="./nginx.dual.conf"
    ;;
  *)
    echo "[stage4] unsupported mode: $MODE (use single or dual)" >&2
    exit 2
    ;;
esac

echo "[stage4] starting stack mode=$MODE load_profile=$LOAD_PROFILE nginx_conf=$NGINX_CONF"
echo "[stage4] resources app=${APP_CPU}/${APP_MEM} db=${DB_CPU}/${DB_MEM} redis=${REDIS_CPU}/${REDIS_MEM} admit_rate_per_tick=${ADMIT_RATE_PER_TICK}"
docker compose -p stage4-capacity down -v 2>/dev/null || true
docker compose -p stage4-capacity up -d --build

if [[ "$MODE" == "single" ]]; then
  echo "[stage4] single-instance mode — stopping app2 after image/build verification"
  docker compose -p stage4-capacity stop app2
fi

echo "[stage4] waiting 30s for warm-up..."
sleep 30

mkdir -p "$SCRIPT_DIR/results"
RESULT_KEY="stage4-${MODE}-${LOAD_PROFILE}${RESULT_SUFFIX:+-${RESULT_SUFFIX}}"
RESULT_PATH="$SCRIPT_DIR/results/${RESULT_KEY}.summary.json"
RUN_LOG="$SCRIPT_DIR/results/${RESULT_KEY}.run.log"
META_PATH="$SCRIPT_DIR/results/${RESULT_KEY}.meta.txt"

cat > "$META_PATH" <<EOF
started_at=$(date -Iseconds)
mode=${MODE}
load_profile=${LOAD_PROFILE}
app_cpu=${APP_CPU}
app_mem=${APP_MEM}
db_cpu=${DB_CPU}
db_mem=${DB_MEM}
redis_cpu=${REDIS_CPU}
redis_mem=${REDIS_MEM}
nginx_cpu=${NGINX_CPU}
pool_size=${POOL_SIZE}
admit_rate_per_tick=${ADMIT_RATE_PER_TICK}
java_opts=${JAVA_OPTS}
k6_script=${K6_SCRIPT}
EOF

# Failover 시뮬 백그라운드
if [[ "${FAILOVER:-0}" == "1" ]]; then
  echo "[stage4] failover scheduled: app1 stop at 60s mark"
  ( sleep 60 && docker compose -p stage4-capacity stop app1 && echo "[stage4] app1 stopped" ) &
fi

K6_OUTPUT_ARGS=()
K6_REMOTE_WRITE="${K6_REMOTE_WRITE:-auto}"
K6_SUMMARY_TREND_STATS="${K6_SUMMARY_TREND_STATS:-avg,min,med,max,p(90),p(95),p(99)}"
if [[ "$K6_REMOTE_WRITE" != "0" ]]; then
  if curl -sf "http://localhost:9090/-/ready" >/dev/null 2>&1; then
    export K6_PROMETHEUS_RW_SERVER_URL="${K6_PROMETHEUS_RW_SERVER_URL:-http://localhost:9090/api/v1/write}"
    export K6_PROMETHEUS_RW_TREND_STATS="${K6_PROMETHEUS_RW_TREND_STATS:-p(95),p(99),min,max}"
    K6_OUTPUT_ARGS=(-o experimental-prometheus-rw)
    echo "[stage4] k6 remote write enabled: $K6_PROMETHEUS_RW_SERVER_URL"
  elif [[ "$K6_REMOTE_WRITE" == "1" ]]; then
    echo "[stage4] K6_REMOTE_WRITE=1 but Prometheus is not ready at http://localhost:9090" >&2
    exit 2
  else
    echo "[stage4] Prometheus remote write unavailable; running with summary export only"
  fi
fi

K6_EXIT=0
echo "[stage4] k6 log: $RUN_LOG"
k6 run "${K6_OUTPUT_ARGS[@]}" --summary-export "$RESULT_PATH" \
  --summary-trend-stats "$K6_SUMMARY_TREND_STATS" \
  -e HOST=localhost:28093 \
  -e SPEC="$RESULT_KEY" \
  -e SEAT_MAX=50000 \
  "$K6_SCRIPT" > "$RUN_LOG" 2>&1 || K6_EXIT=$?
tail -120 "$RUN_LOG"
echo "[stage4] k6 exit code: ${K6_EXIT}"
echo "k6_exit_code=${K6_EXIT}" >> "$META_PATH"
echo "finished_at=$(date -Iseconds)" >> "$META_PATH"

echo "[stage4] done. summary: $RESULT_PATH"
if [[ "${#K6_OUTPUT_ARGS[@]}" -gt 0 ]]; then
  TIMESERIES_PATH="screenshots/portfolio-evidence/prometheus-timeseries/${RESULT_KEY}.json"
  echo "[stage4] exporting Prometheus time series: ${TIMESERIES_PATH}"
  (cd "$SCRIPT_DIR/.." && ./scripts/export-prometheus-timeseries.mjs --spec "$RESULT_KEY" --out "$TIMESERIES_PATH") \
    || echo "[stage4] Prometheus time series export failed (summary/log retained)"
fi
docker compose -p stage4-capacity ps
