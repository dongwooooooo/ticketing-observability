# Goal: 포트폴리오 k6 증빙 재정리와 Prometheus 보관 고정

## 상태

- status: complete
- owner: Codex
- main repo: `/Users/idong-u/d/ticketing-observability`
- related repo: `/Users/idong-u/d/ticketing`
- created_at: 2026-05-26
- runner: repo-local runner 없음. native subagent 검토와 로컬 실행으로 진행한다.

## 목적

Ticketing Concurrency Lab의 테스트 근거를 README, PDF, Notion에 각각 맞는 형태로 재배치한다.

이번 작업은 k6를 다시 실행하기 전에 다음 기준을 먼저 고정한다.

1. 테스트별로 필요한 지표를 정한다.
2. Grafana/Prometheus에서 어떤 패널과 query로 확인할지 연결한다.
3. k6 실행 직후 summary JSON, run log, Prometheus 시계열 JSON을 함께 보관한다.
4. README, PDF, Notion에 부족한 근거가 없는지 확인한 뒤 다음 테스트 단계로 넘어간다.

## 산출물 배치 기준

| 산출물 | 역할 | 표시 방식 |
|---|---|---|
| README | 프로젝트 진입점 | 성과 3개 요약, 대표 수치, 상세 검증 문서 링크 |
| GitHub evidence | 독립 증빙 문서 | 테스트별 목적, 조건, 실행 명령, 결과, 원본 파일, 해석 |
| PDF | 제출용 압축 요약 | 여러 테스트를 한 번에 비교하는 표와 핵심 이미지 |
| Notion | 블로그형 포트폴리오 | 문제 흐름, 검증 전략, 테스트별 결과 해석, GitHub 상세 링크 |

## 표시 방식

### 한번에 여러 테스트를 보여주는 방식

사용 위치: README 상단, PDF 본문, Notion 요약 섹션

| 항목 | 포함 지표 |
|---|---|
| 좌석 예약 경합 | 최종 예약 수, rejected 수, p99, 처리량 |
| 예매 오픈 피크 요청 | 직접 유입 실패 요청, 토큰 발급, 대기열 통과, 대기 시간 p95 |
| Redis 멀티 인스턴스 | 구성별 전체 p95, Hikari pending, Redis ops/sec, DB connection |

### 개별 테스트를 보여주는 방식

사용 위치: GitHub evidence 상세 문서, Notion 본문 상세 섹션

| 항목 | 포함 내용 |
|---|---|
| 검증 질문 | 해당 테스트가 답해야 하는 질문 |
| 실행 조건 | 백엔드/DB/Redis/Nginx 자원, Hikari pool, 부하 패턴 |
| 실행 명령 | k6 또는 Gradle 명령 |
| 결과 표 | 핵심 지표와 원본 파일 경로 |
| 해석 | 다음 설계 선택으로 이어지는 근거 |

## 테스트별 지표 매핑

### 1. 좌석 예약 경합

| 구분 | 지표 | 표시 위치 |
|---|---|---|
| 단위 테스트 | `success`, `rejected`, `heldCount` | GitHub 상세, Notion 본문 |
| 비교 테스트 | p99, 처리량, 최종 예약 수 | PDF 요약, README 요약 |
| DB 제약 | 조건부 유니크 인덱스 적용 여부 | GitHub 상세 |

Grafana 필수 지표: 없음. 단위 테스트와 benchmark 결과 중심으로 둔다.

### 2. 예매 오픈 피크 요청

| 구분 | 지표 | 표시 위치 |
|---|---|---|
| 대기열 미적용 | 총 요청, 성공, 실패 요청, 5xx 비율 | PDF 요약, GitHub 상세 |
| 메모리 대기열 | 토큰 발급, 대기열 통과, 대기 중 제한 시간 초과, 대기 시간 p95 | PDF 요약, Notion 본문 |
| 사용자 대기 | `admit_wait_ms` p50/p95/p99/max | GitHub 상세, Grafana |

Grafana 필수 지표:

- `k6_token_issued_total`
- `k6_admitted_total`
- `k6_admit_timeout_total`
- `k6_admit_wait_ms_p95`
- `k6_total_latency_ms_p95`

### 3. Redis 기반 멀티 인스턴스 확장

| 구분 | 지표 | 표시 위치 |
|---|---|---|
| 단일/멀티 비교 | HTTP 처리량, 토큰 발급, 대기열 통과, 전체 p95 | PDF 요약, README 요약 |
| 커넥션 상태 | Hikari active, Hikari pending, Hikari timeout | GitHub 상세, Grafana |
| 하위 계층 부하 | Redis ops/sec, Redis CPU, DB connection, DB commit rate | GitHub 상세, Notion 본문 |
| 상태 공유 | duplicate admit, cross instance token visibility, fencing token | GitHub 상세 |

Grafana 필수 지표:

- `k6_token_issued_total`
- `k6_admitted_total`
- `k6_reserve_success_total`
- `k6_token_failed_total`
- `k6_admit_timeout_total`
- `k6_admit_wait_ms_p95`
- `k6_total_latency_ms_p95`
- `hikaricp_connections_active`
- `hikaricp_connections_pending`
- `redis_commands_processed_total`
- `process_cpu_seconds_total{job="stage4-redis"}`
- `pg_stat_database_numbackends`
- `pg_stat_database_xact_commit`

## Prometheus 보관 기준

기존 6시간 보관은 포트폴리오 증빙 작업에 맞지 않는다. 다음 두 가지를 함께 적용한다.

1. Prometheus TSDB 보관 기간을 장기 보관으로 늘린다.
2. k6 실행 직후 query_range 결과를 JSON으로 따로 저장한다.

보관 파일 기준:

```text
screenshots/portfolio-evidence/prometheus-timeseries/<spec>.json
```

이 파일은 Grafana 화면을 대신하는 원본 시계열 보조 자료다. 기존 캡처 PNG에서 눈대중으로 수치를 읽지 않고, summary JSON과 Prometheus query_range JSON을 기준으로 문서화한다.

## k6 실행 순서

각 단계는 아래 순서로만 진행한다.

1. 실행 조건 확인
2. k6 실행
3. summary JSON과 run log 저장 확인
4. Prometheus query_range JSON 추출
5. Grafana 패널에서 같은 지표 확인
6. README/PDF/Notion에 필요한 지표가 채워졌는지 점검
7. 부족한 지표가 있으면 다음 단계로 넘어가기 전에 보완

## 단계별 실행 계획

| 단계 | 테스트 | 실행 여부 | 다음 문서 연결 |
|---|---|---|---|
| A | 좌석 예약 경합 단위 테스트 | 보관 결과 우선 확인 | `seat-reservation-contention.md` |
| B | Stage 2 직접 유입 | 필요 시 새 검증 라운드 | `opening-surge-queue.md` |
| C | Stage 3 메모리 대기열 | 필요 시 새 검증 라운드 | `opening-surge-queue.md` |
| D | Stage 4 Redis 멀티 인스턴스 opening surge | Prometheus 보관 적용 후 실행 | `redis-multi-instance.md` |
| E | Stage 4 same total CPU 비교 | Prometheus 보관 적용 후 실행 | `redis-multi-instance.md` |

## 현재 주의점

- 기존 Grafana PNG는 캡처 자료다. 같은 시계열이 Prometheus에 남아 있다는 뜻으로 쓰지 않는다.
- summary JSON은 k6 집계 결과다. Grafana 패널과 함께 보려면 Prometheus query_range JSON이 별도로 필요하다.
- 새 k6 실행 결과는 기존 PDF 수치와 섞지 않는다. 새 검증 라운드로 파일명을 분리한다.
- 좌석 충돌 `409`는 서버 실패와 분리한다.
- `dropped_iterations`는 문서에는 “k6가 시작하지 못한 사용자 플로우”로 설명한다.

## 완료 기준

- Prometheus 장기 보관 설정이 적용되어 있다.
- query_range 추출 스크립트가 존재한다.
- README/PDF/Notion별 배치안이 goal 문서에 고정되어 있다.
- 각 k6 단계별로 필요한 Grafana 지표가 정리되어 있다.
- k6 새 실행은 summary, run log, Prometheus 시계열 JSON까지 한 세트로 남긴다.

## 진행 로그

| 단계 | 상태 | 결과 |
|---|---|---|
| goal 계약 생성 | 완료 | README/PDF/Notion 배치 방식과 테스트별 지표 매핑을 이 문서에 고정했다. |
| Prometheus 보관 설정 | 완료 | `365d` 또는 `20GiB` 기준으로 변경하고 container runtime에서 `1y or 20GiB`를 확인했다. |
| Prometheus 시계열 추출 | 완료 | `scripts/export-prometheus-timeseries.mjs`를 추가했다. k6 실행 후 `query_range` 결과를 JSON으로 저장한다. |
| Stage4 runner 보강 | 완료 | k6 remote write가 켜진 경우 실행 직후 Prometheus 시계열 JSON을 추출한다. |
| Stage2/Stage3 runner 보강 | 완료 | 새 실행에서 remote write를 사용하고, `K6_SPEC`, `RESULT_DIR`로 기존 결과 덮어쓰기를 피한다. |
| Stage2 직접 유입 1차 시도 | 중단 | 동적 URL 태그로 Prometheus 시계열이 과도하게 늘어났다. 해당 `spec` 시계열은 삭제하고 partial result도 제거했다. |
| k6 태그 보정 | 완료 | Stage2/3/4 스크립트에 `systemTags` 제한과 고정 `name` 태그를 적용했다. |
| Stage2 직접 유입 2차 실행 | 완료 | `portfolio-stage2-a4-r2`로 실행했다. 총 요청 230,858건, 성공 49,492건, 실패 181,366건, 5xx 비율 78.56%, p95 2608.8ms를 기록했다. summary/run log/Prometheus 시계열 JSON을 보관했다. |
| k6 runner 후처리 보강 | 완료 | threshold 실패가 나와도 summary, Prometheus export, actuator, logs, cleanup까지 진행하도록 수정했다. |
| Stage3 메모리 대기열 실행 | 완료 | `portfolio-stage3-a4-r1`로 실행했다. 토큰 발급 119,683건, 대기열 통과 119,683건, 대기 중 제한 시간 초과 0건, 대기 시간 p95 4.37초, 전체 p95 7.31초를 기록했다. summary/run log/Prometheus 시계열 JSON을 보관했다. |
| Prometheus scrape 보정 | 완료 | Stage2/3 host port 기준으로 scrape target을 `28091`, `28092`로 수정했다. 기존 Stage2/3 라운드는 k6 remote write 지표 중심으로 사용하고, 이후 실행부터 애플리케이션 지표도 함께 보관한다. |
| Prometheus exporter 보정 | 완료 | Stage2/3 파일에 Stage4 Redis/PostgreSQL/Hikari 지표가 섞이지 않도록 테스트 단계별 query를 분리했다. |
| Stage4 `1대 x 2CPU / pool10` | 완료 | `stage4-single-opening-portfolio-single-1x2-pool10-r2`로 실행했다. 토큰 발급 66,467건, 토큰 실패 12,490건, 대기 시간 p95 7.01초, 전체 p95 9.63초를 기록했다. |
| Stage4 `1대 x 4CPU / pool20` | 완료 | `stage4-single-opening-portfolio-single-1x4-pool20-r1`로 실행했다. 토큰 발급 82,487건, 토큰 실패 0건, 대기 시간 p95 295ms, 전체 p95 485ms를 기록했다. |
| Stage4 `2대 x 2CPU / pool10 x 2` | 완료 | `stage4-dual-opening-portfolio-dual-2x2-pool10-r1`로 실행했다. 토큰 발급 79,441건, 토큰 실패 1,394건, 대기 시간 p95 2.97초, 전체 p95 4.90초를 기록했다. |
| Prometheus 시계열 보관 확인 | 완료 | Stage4 세 조건 모두 k6, Hikari, Redis, PostgreSQL query_range JSON이 생성됐다. |
| README/PDF/Notion 배치 정리 | 완료 | `docs/evidence/concurrency-load-test-results.md`에 산출물별 배치, 전체 비교표, 개별 테스트별 지표를 정리했다. |
| 제출 산출물 반영 | 완료 | `ticketing` README/evidence 문서, PDF, Notion 페이지에 최신 Stage2/3/4 수치를 반영했다. PDF에는 핵심 비교만 남기고, 상세 테스트 결과는 GitHub evidence 문서로 분리했다. |

## 최종 결과 기준

| 구간 | 대표 실행 결과 | 원본 위치 |
|---|---|---|
| Stage2 직접 유입 | 좌석 예약 요청 230,858건, 성공 49,492건, 실패 181,366건 | `/Users/idong-u/d/ticketing/docs/evidence/results/raw/stage2-a4-summary.json` |
| Stage3 메모리 대기열 | 토큰 발급 119,683건, 대기열 통과 119,683건, 대기 중 제한 시간 초과 0건 | `/Users/idong-u/d/ticketing/docs/evidence/results/raw/stage3-a4-summary.json` |
| Stage4 1대 x 2CPU / pool10 | 토큰 발급 66,467건, 전체 p95 9.63초 | `/Users/idong-u/d/ticketing/docs/evidence/results/raw/stage4-single-1x2-pool10-summary.json` |
| Stage4 1대 x 4CPU / pool20 | 토큰 발급 82,487건, 전체 p95 0.49초 | `/Users/idong-u/d/ticketing/docs/evidence/results/raw/stage4-single-1x4-pool20-summary.json` |
| Stage4 2대 x 2CPU / pool10 x 2 | 토큰 발급 79,441건, 전체 p95 4.90초 | `/Users/idong-u/d/ticketing/docs/evidence/results/raw/stage4-dual-2x2-pool10-summary.json` |

## 판정

- 로컬 테스트에서 응답시간만 보면 `1대 x 4CPU / pool20` 구성이 가장 낮았다.
- `2대 x 2CPU / pool10 x 2` 구성은 단일 스펙업보다 빠르다는 근거가 아니라, Redis 기반 대기열/좌석 락 상태 공유와 멀티 인스턴스 라우팅을 검증한 근거로 사용한다.
- 새 k6 실행 결과는 summary JSON, run log, Prometheus query_range JSON을 함께 보관한다.
