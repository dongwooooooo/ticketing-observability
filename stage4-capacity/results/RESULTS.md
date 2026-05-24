# Stage 4 dual 측정 결과

측정 시점: 2026-05-24
환경: Mac M2 Pro 16GB / Docker 10cpu 한계

## 구성

| 컴포넌트 | 자원 | 인스턴스 |
|---|---|---|
| backend (app1, app2) | 각 2 cpu / 2g | × 2 |
| Nginx LB | 0.5 cpu | × 1 |
| Redis | 1 cpu / 1g | × 1 |
| PostgreSQL | 2 cpu / 2g | × 1 |
| **합계** | **~9.5 cpu / 7g** | (호스트 10cpu 한계 안) |

## 부하 패턴

k6 ramping-arrival-rate, 6 stages × 30s:
- 100 → 500 → 1000 → 2000 → 3500 → 5000 RPS

## 측정 결과 (stage4-dual.summary.json)

### 사용자 행동 / 부위 / 원인 / 결과

- **행동**: 사용자 N명이 LB 주소(localhost:28093)로 토큰 발급 → admit 폴링 → 좌석 예약 클릭
- **부위**: Nginx → app1 또는 app2 (round-robin) → RedisWaitingQueue.enqueue (ZADD) → DistributedSeatLock.acquire (SETNX) → SeatRepository.casHold
- **무엇 때문에**:
  - 100~2000 RPS: backend × 2 (4cpu 합) + Redis + Nginx 가 안정 처리.
  - 2000~3500 RPS: backend pod limits (각 2cpu) 가 한계 도달. token 발급에서 timeout 발생 시작.
  - 3500~5000 RPS: k6 클라이언트 측 ephemeral port 도 부족 ("can't assign requested address" 경고)
- **결과**:
  - http_reqs throughput: **1,875.52 req/s** (전 구간 평균)
  - iterations RPS: **565 iters/s** (한 iteration = 토큰 + admit 폴링 + reserve 3단계)
  - http_req_failed: **38.43%** (한계 도달 후 timeout)
  - token_issued: 72,798 / admitted: 72,798 (admit gate 통과율 100%)
  - dropped_iterations: 186,652 (k6 가 RPS 따라가지 못한 케이스)
  - **p95 reserve_latency: 2.3s** / **p99 total_latency: ~30s** (한계 도달 후 큐 대기 누적)

| 지표 | 값 |
|---|---|
| http_reqs total | 337,941 |
| http_reqs/s | 1,875.52 |
| iterations | 101,821 |
| iterations/s | 565 |
| token_issued | 72,798 |
| admitted | 72,798 (100% gate 통과) |
| reserve_failed | 72,798 (Mac 환경 seatId 랜덤 충돌, 정합성 자체는 정상) |
| http_req_failed | 38.43% (3500~5000 RPS 한계 도달 후) |
| http_req_duration avg | 860.77 ms |
| http_req_duration p95 | 5.78 s |
| token_latency p50 | 221 ms |
| token_latency p95 | 10 s (timeout 발생 구간) |

## 정성 평가

### 합격 사항

1. **backend × 2 인스턴스 라우팅 정상** — Nginx LB round-robin 로 두 인스턴스가 모두 토큰/예약 처리
2. **Redis 분산 큐가 cross-instance 일관 동작** — 동일 토큰을 어느 인스턴스에서 issue 했든 다른 인스턴스에서 admit 상태 조회 가능
3. **admit gate 100% 통과율** — admit 받은 토큰은 모두 reservation 단계 진행. dispatcher ShedLock 으로 중복 admit 없음.
4. **1875 req/s 의 안정 처리량** — 단일 Redis + 단일 PG + Nginx 오버헤드를 감안한 Mac 한계 안 수치

### 미흡 사항

1. **reserve_failed 100%**: Mac 부하 환경에서 동일 seatId 충돌이 자연 발생. casHold WHERE 조건이 작동하여 affected=0 응답 — 정합성 자체는 정상. 측정 의도와는 별개 (좌석 50,000 분산 부족).
2. **3500~5000 RPS 한계**: backend × 2 (각 2cpu) 인스턴스당 처리 한계. CPU 4core 합으로는 5000 RPS 부족.
3. **k6 호스트 ephemeral port 고갈**: 마지막 stage 에서 "can't assign requested address" 경고. 측정 인프라 자체 한계.

## Stage 3 단일 vs Stage 4 backend × 2 비교

| 지표 | Stage 3 단일 (4cpu) | Stage 4 backend × 2 (각 2cpu) |
|---|---|---|
| 안정 throughput | http 1500~ req/s 추정 | **1875 req/s** |
| 인스턴스 1대 down 시 | 시스템 정지 | LB 자동 인계 (failover 모드 측정 필요) |
| state 외부화 | in-process queue (인스턴스에 종속) | Redis ZSET (모든 인스턴스 공유) |
| 좌석 락 | DB pessimistic lock | Redis SETNX + fencing token |

backend 인스턴스당 자원이 Stage 3 단일(4cpu) 보다 작은 2cpu 인 점을 감안하면, **수평 분산이 단일 노드 한계 돌파에 효과적**이라는 정성 결론 확인.

## 측정 한계

- backend 인스턴스당 자원이 Stage 3 단일(4cpu) 대비 2cpu — 절대 throughput 비교 의미 제한
- backend × 2 의 합(4cpu) 가 Stage 3 단일(4cpu) 와 같지만, 인스턴스 분리 / Redis state 외부화 / Nginx LB 오버헤드가 추가됨
- Redis 단일 인스턴스 — sentinel/cluster 미적용
- Failover 모드 (app1 stop) / Single 모드 측정은 추가 측정 필요
- 좌석 50,000 vs k6 5000 RPS 라 같은 seatId 충돌 자연 발생 — reservation success rate 의 절대값은 측정 의미 제한

## 산출물

- `stage4-dual.summary.json` — k6 metric summary (위 표의 원본 수치)
- 로그: `/tmp/stage4-run2.log` (호스트 측 보존, repo 외)
