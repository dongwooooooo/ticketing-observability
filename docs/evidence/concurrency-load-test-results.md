# Ticketing Concurrency Lab 테스트 근거

이 문서는 Ticketing Concurrency Lab의 동시성 테스트, k6 부하테스트, Prometheus 시계열 보관 위치를 정리한 자료입니다. README, PDF, Notion에는 이 문서를 기준으로 필요한 수준만 줄여서 배치합니다.

## 산출물별 배치

| 산출물 | 배치 방식 | 포함 지표 |
| --- | --- | --- |
| README | 프로젝트 개요 아래에 핵심 결과 3개와 상세 문서 링크를 둡니다. | 최종 예약 1건 유지, 직접 유입 실패 수, 대기열 통과 수, 단일/멀티 구성 비교 |
| PDF | 각 성과 제목 옆에 `상세 테스트` 링크를 두고, 본문에는 비교 표와 대표 수치만 둡니다. | p95/p99, 처리량, 실패 수, 대기열 통과, Hikari pending |
| Notion | 블로그형 흐름으로 문제, 실험 설계, 결과 해석, 다음 선택을 연결합니다. | 전체 비교표, 개별 테스트 해석, Grafana/Prometheus 원본 링크 |
| GitHub evidence | 테스트별 독립 문서로 둡니다. | 실행 조건, 명령, summary JSON, run log, Prometheus 시계열 JSON, 테스트 코드 링크 |

## 표시 방식

### 여러 테스트를 한 번에 보여주는 경우

PDF와 README에서는 비교 목적이 보이도록 표를 사용합니다. 좌석 예약 경합은 최종 예약 수와 p99, 예매 오픈 피크 요청은 직접 유입과 대기열 적용 결과, Redis 멀티 인스턴스는 단일 스펙업과 분산 구성을 나란히 둡니다.

### 개별 테스트를 보여주는 경우

GitHub evidence와 Notion 본문에서는 테스트별로 아래 순서를 유지합니다.

1. 검증 질문
2. 실행 조건
3. 실행 명령
4. 결과 표
5. 원본 파일
6. 해석

## 원본 파일

| 구분 | 경로 |
| --- | --- |
| Stage2 직접 유입 summary | `stage2-capacity/results/portfolio-stage2-a4-r2/summary.json` |
| Stage2 Prometheus 시계열 | `screenshots/portfolio-evidence/prometheus-timeseries/portfolio-stage2-a4-r2.json` |
| Stage3 메모리 대기열 summary | `stage3-capacity/results/portfolio-stage3-a4-r1/summary.json` |
| Stage3 Prometheus 시계열 | `screenshots/portfolio-evidence/prometheus-timeseries/portfolio-stage3-a4-r1.json` |
| Stage4 1대 x 2CPU summary | `stage4-capacity/results/stage4-single-opening-portfolio-single-1x2-pool10-r2.summary.json` |
| Stage4 1대 x 4CPU summary | `stage4-capacity/results/stage4-single-opening-portfolio-single-1x4-pool20-r1.summary.json` |
| Stage4 2대 x 2CPU summary | `stage4-capacity/results/stage4-dual-opening-portfolio-dual-2x2-pool10-r1.summary.json` |
| Stage4 Prometheus 시계열 | `screenshots/portfolio-evidence/prometheus-timeseries/stage4-*.json` |

## 부하 패턴

Stage4 opening surge는 티켓 오픈 시점에 높은 요청이 바로 들어오고 이후 더 증가하는 상황을 재현합니다.

| 항목 | 값 |
| --- | --- |
| k6 executor | `ramping-arrival-rate` |
| 시작 부하 | 600 iterations/s |
| 단계 | 600 -> 800 -> 1000 -> 1200 iterations/s |
| 단계별 지속 시간 | 25초 |
| 최대 VU | 3000 |
| 좌석 수 | 50,000 |

## 성과 1. 좌석 예약 경합

### 필요한 지표

| 산출물 | 지표 |
| --- | --- |
| README | 동일 좌석 동시 요청에서 최종 예약 1건 유지 |
| PDF | 최종 예약 수, 거절 수, p99, 처리량 |
| Notion | 조회 후 저장 방식의 문제와 DB 제약 적용 이유 |
| GitHub evidence | 단위 테스트 코드, benchmark 결과, DB 제약 DDL |

### 결과

| 시나리오 | 좌석 조건 | 요청 수 | 예약 방식 | 최종 예약 | 거절 | p99 | 처리량 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 동일 좌석 경합 | 좌석 1개 | 1,000 | 비관적 락과 예약 테이블 제약 | 1 | 999 | 586ms | 1490 ops/s |
| 동일 좌석 경합 | 좌석 1개 | 1,000 | 상태 조건 기반 UPDATE와 예약 테이블 제약 | 1 | 999 | 192ms | 4219 ops/s |
| 분산 좌석 요청 | 좌석 1,000개 | 2,000 | 비관적 락 | 808 | 1192 | 1240ms | 1385 ops/s |
| 분산 좌석 요청 | 좌석 1,000개 | 2,000 | 상태 조건 기반 UPDATE | 808 | 1192 | 782ms | 2250 ops/s |

## 성과 2. 예매 오픈 피크 요청

### 필요한 지표

| 산출물 | 지표 |
| --- | --- |
| README | 직접 유입 실패 요청, 대기열 적용 후 대기 중 제한 시간 초과 |
| PDF | 직접 유입과 메모리 대기열 비교표 |
| Notion | 대기열을 둔 이유, 사용자 대기 시간 증가 |
| GitHub evidence | k6 summary, run log, Prometheus 시계열 |

### 결과

| 구성 | 백엔드 | DB | 대기열 | 부하 패턴 | 처리 지표 | 실패/대기 지표 |
| --- | --- | --- | --- | --- | --- | --- |
| 대기열 미적용 | 4 CPU | 4 CPU | 없음 | 100-5000 RPS | 좌석 예약 성공 49,492건 | 실패 요청 181,366건, reserve p95 2.61초 |
| 메모리 대기열 적용 | 4 CPU | 4 CPU | 인스턴스 메모리 | 100-5000 RPS | 토큰 발급 119,683건, 대기열 통과 119,683건, 좌석 예약 성공 45,488건 | 대기 중 제한 시간 초과 0건, 대기 시간 p95 4.37초, 전체 p95 7.31초 |

직접 유입에서는 처리 한도를 넘은 요청이 실패로 끝났습니다. 메모리 대기열을 적용한 뒤에는 요청을 먼저 대기열에 받고, 통과한 요청만 좌석 예약 API로 넘기는 흐름을 검증했습니다.

## 성과 3. Redis 기반 멀티 인스턴스 확장

### 필요한 지표

| 산출물 | 지표 |
| --- | --- |
| README | 단일 스펙업과 2대 구성 비교, 최종 선택 이유 |
| PDF | 구성별 p95, 토큰 실패, 대기열 통과, Hikari pending |
| Notion | 단일 스펙업이 성능상 유리했던 점과 멀티 인스턴스를 선택한 이유 |
| GitHub evidence | k6 summary, run log, Prometheus 시계열, Redis/DB 부하 |

### k6 결과

| 구성 | HTTP 처리량 | HTTP 실패율 | 토큰 발급 | 토큰 실패 | 대기열 통과 | 대기 시간 p95 | 전체 p95 | 예약 성공 | 충돌 | k6가 시작하지 못한 사용자 플로우 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1대 x 2CPU / pool10 | 3644.45 req/s | 21.05% | 66,467 | 12,490 | 65,085 | 7.01초 | 9.63초 | 49,349 | 14,229 | 3,528 |
| 1대 x 4CPU / pool20 | 3351.83 req/s | 0.00% | 82,487 | 0 | 82,487 | 295ms | 485ms | 50,000 | 32,487 | 0 |
| 2대 x 2CPU / pool10 x 2 | 3124.16 req/s | 1.10% | 79,441 | 1,394 | 79,441 | 2.97초 | 4.90초 | 50,000 | 29,237 | 1,651 |

### Prometheus 시계열 요약

| 구성 | Hikari pending 평균 / 최대 | Hikari active 평균 / 최대 | Redis ops/sec 평균 / 최대 | DB connection 평균 / 최대 |
| --- | ---: | ---: | ---: | ---: |
| 1대 x 2CPU / pool10 | 100.48 / 186 | 8.70 / 10 | 6558.52 / 14284.85 | 12 / 12 |
| 1대 x 4CPU / pool20 | 1.30 / 30 | 2.74 / 20 | 8062.72 / 14110.63 | 22 / 22 |
| 2대 x 2CPU / pool10 x 2 | 33.26 / 180 | 6.72 / 10 | 7927.74 / 13609.51 | 22 / 22 |

같은 총 CPU와 같은 총 DB pool 기준에서는 1대 x 4CPU 구성이 가장 낮은 지연을 보였습니다. 다만 티켓 오픈 서버는 장애 영향 범위와 예상 초과 트래픽을 함께 고려해야 하므로, 최종 구조는 Redis에서 대기열과 좌석 단위 락 상태를 공유하고 백엔드 인스턴스를 늘릴 수 있는 방향으로 정리합니다.

## Grafana/Prometheus 표시 기준

| 테스트 | 함께 보여줄 패널 | 개별로 보여줄 패널 |
| --- | --- | --- |
| Stage2 직접 유입 | HTTP 처리량, 실패 요청, reserve latency | reserve failure 시계열 |
| Stage3 메모리 대기열 | 토큰 발급, 대기열 통과, 대기 시간 p95 | admit wait p95/p99, total latency |
| Stage4 Redis 멀티 인스턴스 | 구성별 처리량, 토큰 실패, 대기열 통과, 전체 p95 | Hikari pending, Redis ops/sec, DB connection |

Grafana 캡처는 화면 설명용으로 사용하고, 수치는 `summary.json`과 Prometheus `query_range` JSON을 기준으로 작성합니다.
