#!/usr/bin/env bash
# Run all 13 specs sequentially.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SPECS=(a-1 a-2 a-3 a-4 a-5 b-1 b-2 b-3 b-4 c-1 c-2 c-3 c-4)

for spec in "${SPECS[@]}"; do
  echo "================ ${spec} ================"
  if ./run-spec.sh "${spec}" > "results/${spec}-run.log" 2>&1; then
    echo "${spec}: OK"
  else
    echo "${spec}: FAILED (see results/${spec}-run.log)"
  fi
done
echo "================ ALL DONE ================"
