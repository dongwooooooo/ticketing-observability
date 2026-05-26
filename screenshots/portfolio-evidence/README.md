# Ticketing Portfolio Evidence Captures

생성일: 2026-05-25

## 포트폴리오 본문 우선 사용

PDF 본문에는 `selected/` 아래의 이름이 명확한 파일을 우선 사용한다. 기존 파일은 원본 캡처 보존용으로 유지한다.

| 용도 | 파일 | 설명 |
|---|---|---|
| 좌석 예약 경합 | `selected/01-seat-reservation-race-gradle-report.png` | Gradle report 캡처. 동일 좌석 동시 요청에서 최종 예약 1건을 확인하는 보조 이미지. |
| 예매 오픈 피크 부하 | `selected/02-opening-surge-wait-total-latency.png` | Grafana 대기 시간 / 전체 지연 패널. |
| 예매 오픈 피크 부하 | `selected/02-opening-surge-dropped-failed.png` | Grafana dropped / failed 패널. |
| Redis 멀티 인스턴스 | `selected/03-redis-multi-instance-hikari-active-pending.png` | Grafana Hikari active / pending 패널. |
| Redis 멀티 인스턴스 | `selected/03-redis-multi-instance-redis-postgres-load.png` | Grafana Redis / PostgreSQL 부하 패널. |
| Redis 상태 공유 테스트 | `selected/03-redis-distributed-state-gradle-report.png` | Gradle report 캡처. Redis 대기열/락/fencing token 테스트 결과. |

`evidence-*.png`는 표를 이미지로 만든 자료라 PDF 본문 이미지로 쓰지 않는다.

## Grafana 패널 캡쳐

| 용도 | 파일 |
|---|---|
| k6 token/admit/reserve flow rate | `grafana-stage4-k6-flow-counters.png` |
| 대기 시간 / 전체 지연 p95 | `grafana-stage4-wait-total-latency.png` |
| dropped / failed counters | `grafana-stage4-dropped-failed.png` |
| Redis commands, PostgreSQL connections/commits | `grafana-stage4-redis-postgres-load.png` |
| Stage4 app CPU | `grafana-stage4-app-cpu.png` |
| Hikari active / pending | `grafana-stage4-hikari-active-pending.png` |
| app1/app2 request rate | `grafana-stage4-app-request-rate.png` |
| app1/app2 p95 latency | `grafana-stage4-app-p95-latency.png` |

## 원본 결과

| 파일 | 설명 |
|---|---|
| `targeted-tests.log` | Gradle targeted test 실행 로그 |
| `evidence-summary.html` | 캡쳐용 HTML 원본 |
| `test-report-seat-concurrency.png` | Gradle 기본 HTML report 캡쳐 |
| `test-report-distributed.png` | Gradle 기본 HTML report 캡쳐 |
| `stage4-prometheus-evidence.json` | 실행 구간별 Hikari/Redis/PostgreSQL 집계 지표를 저장한 JSON |
| `prometheus-timeseries/*.json` | 새 k6 실행 직후 query_range로 저장하는 시계열 JSON |

## 재현성 기준

세부 기준은 `REPRODUCIBILITY.md`를 따른다.

- PDF 본문 표는 `stage4-capacity/results/*.summary.json`과 `stage4-prometheus-evidence.json`을 기준으로 작성한다.
- `evidence-*.png`는 표를 이미지로 만든 자료라 PDF 본문 이미지로 쓰지 않는다.
- Grafana PNG는 원본 화면 근거로만 사용한다. 조건별 수치는 PNG가 아니라 JSON에서 읽는다.

## 포트폴리오 해석 기준

- `409` 예약 충돌은 서버 실패가 아니라 좌석 수 `50,000`건을 초과한 요청에서 발생한 도메인 응답으로 분리해서 해석한다.
- 현재 로컬 측정에서는 `1대 x 4 CPU / pool 20`이 가장 낮은 지연을 보였다.
- `2대 x 2 CPU`는 pool 10에서 지연이 컸고 pool 20에서 개선됐다. 멀티 인스턴스에서는 서버 수뿐 아니라 인스턴스별 Hikari pool, DB connection, Redis/DB 부하를 함께 조정해야 한다.
- 수평 확장은 “더 빠르다”보다 “대기열 상태 공유와 장애 대응을 위해 필요한 구조”로 설명하는 것이 안전하다.
