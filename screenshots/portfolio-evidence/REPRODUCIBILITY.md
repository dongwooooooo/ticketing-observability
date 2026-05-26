# Portfolio Evidence Reproducibility

생성일: 2026-05-25

## 판정

현재 검증 근거는 세 종류로 나뉜다.

| 구분 | 현재 상태 | 재현 가능성 | 조치 |
| --- | --- | --- | --- |
| k6 summary 수치 | `stage4-capacity/results/*.summary.json` 보존 | 가능 | PDF 표의 기준 데이터로 사용 |
| k6 run log | `stage4-capacity/results/*.run.log` 보존 | 가능 | 실행 조건 확인용으로 사용 |
| 단위 테스트 로그 | `screenshots/portfolio-evidence/targeted-tests.log` 보존 | 가능 | 성과 1/3 정합성 근거로 사용 |
| Gradle HTML report PNG | `test-report-*.png` 보존 | 재생성 가능 | 보조 캡처로만 사용 |
| Grafana PNG | 스크린샷만 보존 | 제한적 | 새 실행부터 Prometheus 시계열 JSON을 함께 보관 |
| 수동 요약 PNG | `evidence-*.png` 보존 | 약함 | PDF 본문 이미지로 사용하지 않음 |

## 원본 데이터

### 성과 1. 좌석 예약 경합

| 근거 | 파일 | 확인 지표 |
| --- | --- | --- |
| 단위 테스트 로그 | `targeted-tests.log` | `seatReservationRace total=100 success=1 rejected=99 heldCount=1` |
| Gradle report | `test-report-seat-concurrency.png` | `SeatLockConcurrencyTest` 성공 여부 |

성과 1에는 Redis 대기열, 분산 락, fencing token 지표를 섞지 않는다. 해당 지표는 성과 3 근거로 분리한다.

### 성과 2. 예매 오픈 피크 요청

| 근거 | 파일 | 확인 지표 |
| --- | --- | --- |
| k6 summary | `stage4-capacity/results/stage4-single-opening-rerun2-1x2-pool10.summary.json` | 1대 x 2 CPU / pool 10 |
| k6 summary | `stage4-capacity/results/stage4-single-opening-rerun2-1x4-pool20.summary.json` | 1대 x 4 CPU / pool 20 |
| k6 summary | `stage4-capacity/results/stage4-dual-opening-rerun1-2x2-pool10.summary.json` | 2대 x 2 CPU / pool 10씩 |
| k6 summary | `stage4-capacity/results/stage4-dual-opening-rerun1-2x2-pool20.summary.json` | 2대 x 2 CPU / pool 20씩 |

PDF에는 summary JSON에서 직접 뽑은 표를 사용한다. `evidence-opening-surge-results.png`는 같은 내용을 이미지로 만든 것이므로 본문 이미지로 쓰지 않는다.

### 성과 3. Redis 기반 멀티 인스턴스 확장

| 근거 | 파일 | 확인 지표 |
| --- | --- | --- |
| 단위 테스트 로그 | `targeted-tests.log` | `distributedQueueCrossInstance`, `duplicateAdmit=0`, `fencingTokenRace` |
| Prometheus 추출값 | `stage4-prometheus-evidence.json` | 실행 구간별 Hikari pending, Redis ops, PostgreSQL connection |
| Grafana 패널 | `grafana-stage4-*.png` | 시각 확인용 보조 자료 |

Grafana PNG는 여러 실행 구간이 한 화면에 섞일 수 있다. 조건별 지표는 PNG 눈대중이 아니라 `stage4-prometheus-evidence.json` 값을 기준으로 사용한다.

## Prometheus 추출값

Prometheus는 `docker-compose.yml`에서 `--storage.tsdb.retention.time=365d`, `--storage.tsdb.retention.size=20GB`로 실행한다. named volume을 유지해야 시계열 데이터가 남는다. `docker compose down -v`는 Prometheus volume을 삭제하므로 사용하지 않는다.

현재 보존한 추출 파일:

```text
screenshots/portfolio-evidence/stage4-prometheus-evidence.json
```

집계 지표 다시 추출:

```bash
./scripts/extract-portfolio-prometheus-evidence.mjs \
  --out screenshots/portfolio-evidence/stage4-prometheus-evidence.json
```

새 k6 실행 후 시계열 추출:

```bash
./scripts/export-prometheus-timeseries.mjs \
  --spec <k6-spec> \
  --out screenshots/portfolio-evidence/prometheus-timeseries/<k6-spec>.json
```

추출 방식:

1. `k6_token_issued_total{spec="..."}`의 rate가 발생한 구간으로 각 테스트 실행 시간을 잡는다.
2. 그 시간대에서 Hikari, Redis, PostgreSQL 지표의 max 값을 계산한다.
3. k6 결과는 summary JSON에서 읽고, 인프라 지표는 Prometheus에서 읽는다.
4. 시계열이 필요한 경우 `export-prometheus-timeseries.mjs`로 query_range 결과를 별도 JSON으로 남긴다.

## 현재 PDF에 사용할 이미지 기준

| 성과 | PDF 본문 이미지 | 사용 여부 |
| --- | --- | --- |
| 성과 1 | `selected/01-seat-reservation-race-gradle-report.png` | 사용 가능 |
| 성과 2 | `selected/02-opening-surge-wait-total-latency.png`, `selected/02-opening-surge-dropped-failed.png` | 선택 사용 |
| 성과 3 | `selected/03-redis-multi-instance-hikari-active-pending.png`, `selected/03-redis-multi-instance-redis-postgres-load.png`, `selected/03-redis-distributed-state-gradle-report.png` | 선택 사용 |
| 공통 | `evidence-*.png` 표 이미지 | 본문 사용 제외 |

## 다시 돌려야 하는 경우

- Prometheus 6시간 보존이 지나고 Grafana 패널을 같은 시간대로 다시 캡처해야 하는 경우
- Hikari/Redis/PostgreSQL 지표를 다른 조건으로 비교해야 하는 경우
- 단일 4 CPU와 2대 x 2 CPU 비교를 같은 DB 커넥션 예산으로 다시 고정하고 싶은 경우

지금 확보된 summary JSON과 `stage4-prometheus-evidence.json`만으로 PDF 표는 다시 작성할 수 있다.
