#!/usr/bin/env bash
# Stage 4 capacity probe — backend × 2 시나리오.
#
# 비교 대상: Stage 3 단일 backend 측정값 (queue 모듈 load test).
#
# 사양 (Mac 한계 안):
#   app1, app2: 각 2 cpu / 2g (합 4 cpu)
#   redis: 1 cpu / 1g
#   postgres: 2 cpu / 2g
#   nginx LB: 0.5 cpu
#
# 산출물: results/stage4-2node.summary.json
#
# 사용:
#   ./run-stage4.sh                          # 기본 (backend × 2)
#   ./run-stage4.sh single                   # 단일 backend (app2 stop)
#   FAILOVER=1 ./run-stage4.sh               # 부하 중 app1 stop 시뮬

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/docker"

MODE="${1:-dual}"
JAR_SOURCE="/Users/idong-u/d/ticketing/distributed/build/libs/distributed-0.0.1-SNAPSHOT.jar"

# Build 보장
if [[ ! -f "$JAR_SOURCE" ]]; then
  echo "[stage4] building distributed jar..." >&2
  (cd /Users/idong-u/d/ticketing && ./gradlew :distributed:bootJar -x test)
fi
cp "$JAR_SOURCE" ./distributed-0.0.1-SNAPSHOT.jar

# 환경 변수 — Mac 한계 안
export APP_CPU=2
export APP_MEM=2g
export DB_CPU=2
export DB_MEM=2g
export REDIS_CPU=1
export REDIS_MEM=1g
export POOL_SIZE=10
export ADMIT_RATE_PER_TICK=100
export JAVA_OPTS="-Xmx1500m -XX:+UseG1GC -XX:MaxGCPauseMillis=200"

echo "[stage4] starting stack mode=$MODE"
docker compose -p stage4-capacity down -v 2>/dev/null || true
docker compose -p stage4-capacity up -d --build

if [[ "$MODE" == "single" ]]; then
  echo "[stage4] single-instance mode — stopping app2"
  docker compose -p stage4-capacity stop app2
fi

echo "[stage4] waiting 30s for warm-up..."
sleep 30

mkdir -p "$SCRIPT_DIR/results"
RESULT_PATH="$SCRIPT_DIR/results/stage4-${MODE}.summary.json"

# Failover 시뮬 백그라운드
if [[ "${FAILOVER:-0}" == "1" ]]; then
  echo "[stage4] failover scheduled: app1 stop at 60s mark"
  ( sleep 60 && docker compose -p stage4-capacity stop app1 && echo "[stage4] app1 stopped" ) &
fi

k6 run --summary-export "$RESULT_PATH" \
  -e HOST=localhost:28093 \
  -e SPEC="stage4-${MODE}" \
  -e SEAT_MAX=50000 \
  "$SCRIPT_DIR/k6/capacity-probe.js" || echo "[stage4] k6 exit non-zero (continuing for tear-down)"

echo "[stage4] done. summary: $RESULT_PATH"
docker compose -p stage4-capacity ps
