# stage4-capacity

ticketing 메인의 `distributed` 모듈 부하 측정 인프라.

## 구성

```
                k6 (host) → localhost:28093
                                │
                                ▼
                        Nginx LB (port 80→28093)
                        ┌───────┴───────┐
                        ▼               ▼
                     app1            app2
                  (2 cpu/2g)     (2 cpu/2g)
                        │               │
                        └───────┬───────┘
                                │
                        ┌───────┴───────┐
                        ▼               ▼
                   PostgreSQL         Redis
                  (2 cpu/2g)       (1 cpu/1g)
```

호스트 자원 합 ~9.5 cpu / ~7g (Mac Docker Desktop 10 cpu / 8g 한계 안).

## 시나리오

| 모드 | 명령 | 검증 대상 |
|---|---|---|
| dual | `./run-stage4.sh` 또는 `./run-stage4.sh dual` | backend × 2 수평 확장 효과 (vs Stage 3 단일) |
| single | `./run-stage4.sh single` | 동일 모듈을 단일 backend 로 — 베이스라인 |
| failover | `FAILOVER=1 ./run-stage4.sh` | 부하 중 app1 stop → LB 가 자동 인계, 사용자 흐름 유지 |

## 부하 패턴

`k6/capacity-probe.js` — Stage 3 와 동일 (100 → 500 → 1000 → 2000 → 3500 → 5000 RPS ramp, 6 stages × 30s).

각 user iteration:
1. POST /waiting/tokens (대기열 토큰 발급)
2. GET /waiting/tokens/{token} 폴링 (admit 될 때까지, 최대 20초)
3. POST /reservations (좌석 예약)

## 산출물

`results/stage4-{mode}.summary.json` — k6 metric summary.

핵심 지표:
- `token_issued`, `admitted`, `reserve_success`, `reserve_failed`, `admit_timeout`
- `total_latency_ms` p50 / p95 / p99
- `reserve_latency_ms`
- LB access log: 인스턴스 간 라우팅 분포

## Mac 한계 안 제약

- backend × 3 시도 시 자원 빠듯 — × 2 로 진행
- backend 인스턴스당 2 cpu 한정 — Stage 3 단일 (4 cpu) 보다 인스턴스당 자원이 작음 → 절대 throughput 비교는 의미 제한, **수평 확장 효과만** 정성적으로 확인 가능
- Redis 단일 인스턴스 — sentinel/cluster 미적용

## 결과 비교

Stage 3 단일 backend (4 cpu) vs Stage 4 backend × 2 (각 2 cpu) — 동일 부하 패턴.

| 지표 | Stage 3 (단일 4cpu) | Stage 4 (× 2, 각 2cpu) |
|---|---|---|
| reserve_success | (queue/queue-load-output.txt 참조) | results/stage4-dual.summary.json |
| total_latency p99 | (동상) | (동상) |
| 인스턴스 다운 시 시스템 정지 | YES | NO (LB 자동 인계, failover 모드 측정) |
