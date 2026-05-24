#!/usr/bin/env bash
# Extract metrics from all spec k6-stdout files and emit CSV + markdown.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
S2="/Users/idong-u/d/ticketing-observability/stage2-capacity/results"

SPECS=(a-1 a-2 a-3 a-4 a-5 b-1 b-2 b-3 b-4 c-1 c-2 c-3 c-4)

OUT="${ROOT}/results/comparison.md"
CSV="${ROOT}/results/comparison.csv"

# CSV header
echo "spec,s2_reqs_per_s,s2_success,s2_failed,s3_token_rate,s3_admit_rate,s3_reserve_rate,s3_reserve_success,s3_reserve_failed,s3_token_failed,s3_admit_timeout,s3_admit_wait_p95_ms,s3_total_lat_p95_ms" > "$CSV"

extract_s2() {
  local f="${S2}/${1}/k6-stdout.txt"
  [[ ! -f "$f" ]] && { echo ",,"; return; }
  local rate=$(grep "http_reqs/s" "$f" | tail -1 | sed -E 's/.*= ([0-9.]+).*/\1/')
  local line=$(grep -E "^success=" "$f" | tail -1)
  local succ=$(echo "$line" | sed -E 's/success=([0-9]+).*/\1/')
  local fail=$(echo "$line" | sed -E 's/.*failed=([0-9]+).*/\1/')
  echo "${rate:-NA},${succ:-NA},${fail:-NA}"
}

extract_s3() {
  local f="${ROOT}/results/${1}/k6-stdout.txt"
  [[ ! -f "$f" ]] && { echo "NA,NA,NA,NA,NA,NA,NA,NA,NA"; return; }
  # token_issued=44642 (235.9/s) token_failed=1838
  local tline=$(grep "^token_issued=" "$f" | tail -1)
  local trate=$(echo "$tline" | sed -E 's/.*\(([0-9.]+)\/s\).*/\1/')
  local tfail=$(echo "$tline" | sed -E 's/.*token_failed=([0-9]+).*/\1/')
  # admitted=44642 (235.9/s) admit_timeout=0
  local aline=$(grep "^admitted=" "$f" | tail -1)
  local arate=$(echo "$aline" | sed -E 's/.*\(([0-9.]+)\/s\).*/\1/')
  local atimeout=$(echo "$aline" | sed -E 's/.*admit_timeout=([0-9]+).*/\1/')
  # reserve_success=27858 (147.2/s) reserve_conflict=0 reserve_failed=16784
  local rline=$(grep "^reserve_success=" "$f" | tail -1)
  local rrate=$(echo "$rline" | sed -E 's/.*\(([0-9.]+)\/s\).*/\1/')
  local rs=$(echo "$rline" | sed -E 's/reserve_success=([0-9]+).*/\1/')
  local rf=$(echo "$rline" | sed -E 's/.*reserve_failed=([0-9]+).*/\1/')
  # admit_wait_ms p50=0 p95=27009 p99=0 max=87484
  local awline=$(grep "^admit_wait_ms" "$f" | tail -1)
  local awp95=$(echo "$awline" | sed -E 's/.*p95=([0-9]+).*/\1/')
  # total_latency_ms p50=0 p95=35191 p99=0
  local tlline=$(grep "^total_latency_ms" "$f" | tail -1)
  local tlp95=$(echo "$tlline" | sed -E 's/.*p95=([0-9]+).*/\1/')
  echo "${trate:-NA},${arate:-NA},${rrate:-NA},${rs:-NA},${rf:-NA},${tfail:-NA},${atimeout:-NA},${awp95:-NA},${tlp95:-NA}"
}

label_for() {
  case "$1" in
    a-1) echo "A 비례 1+1" ;;
    a-2) echo "A 비례 2+2" ;;
    a-3) echo "A 비례 3+3" ;;
    a-4) echo "A 비례 4+4" ;;
    a-5) echo "A 비례 5+5" ;;
    b-1) echo "B back=1 DB=4" ;;
    b-2) echo "B back=2 DB=4" ;;
    b-3) echo "B back=4 DB=4" ;;
    b-4) echo "B back=5 DB=4" ;;
    c-1) echo "C back=4 DB=1" ;;
    c-2) echo "C back=4 DB=2" ;;
    c-3) echo "C back=4 DB=4" ;;
    c-4) echo "C back=4 DB=6" ;;
  esac
}

{
  echo "# Stage 2 vs Stage 3 — 13 사양 매트릭스 비교"
  echo
  echo "**측정 환경**: Mac M2 Pro 16GB / Docker Desktop 10 cpu / 8 GB / k6 ramping-arrival-rate 100→5000 RPS / SEAT_MAX=50000"
  echo
  echo "**Stage 2**: ticketing/concurrency 모듈 (큐 없음, 좌석 CAS UPDATE 만)"
  echo "**Stage 3**: ticketing/queue 모듈 (in-mem 대기열 + admit gate, admit-rate-per-tick=100 = 1000/s)"
  echo
  echo "## 사양별 처리량 비교"
  echo
  echo "| 사양 | 구성 | S2 req/s | S2 success | S2 failed | S3 token rate | S3 admit rate | S3 reserve rate | S3 reserve success | S3 admit_wait p95 (ms) |"
  echo "|------|------|---------:|-----------:|----------:|--------------:|--------------:|----------------:|-------------------:|----------------------:|"
} > "$OUT"

for s in "${SPECS[@]}"; do
  s2=$(extract_s2 "$s")
  s3=$(extract_s3 "$s")
  echo "${s},${s2},${s3}" >> "$CSV"
  # parse for markdown table
  IFS=',' read -r s2_rate s2_succ s2_fail <<< "$s2"
  IFS=',' read -r s3_trate s3_arate s3_rrate s3_rs s3_rf s3_tf s3_atimeout s3_awp95 s3_tlp95 <<< "$s3"
  printf "| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n" \
    "$s" "$(label_for "$s")" "$s2_rate" "$s2_succ" "$s2_fail" "$s3_trate" "$s3_arate" "$s3_rrate" "$s3_rs" "$s3_awp95" >> "$OUT"
done

{
  echo
  echo "## 핵심 관찰"
  echo
  echo "- **S2 success ≈ SEAT_MAX 50000 캡**: 5분간 5000 RPS 부하 (총 ~600k 요청), 좌석 50000 매진되면 나머지는 모두 fail (좌석 매진 거절)."
  echo "- **S3 reserve rate**: admit-rate=100/tick (=1000/s) 게이트로 backend reserve 처리량 상한 ≈1000. 사양별 변화 작음."
  echo "- **S3 token rate**: in-memory enqueue. backend 1cpu 환경에서도 수백~수천 토큰/s 발급."
  echo "- **admit_wait_ms p95**: admit 게이트 통과 대기 시간. 5000 RPS 부하 + 1000/s admit → 큐가 빠르게 적재되며 후순위는 30초 timeout 한계 근처."
  echo
  echo "## CSV"
  echo
  echo "\`results/comparison.csv\` 참조."
} >> "$OUT"

echo "Wrote: $OUT"
echo "Wrote: $CSV"
