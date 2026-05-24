# ticketing-observability

ticketing 메인 프로젝트의 3개 Stage (basic / concurrency / queue) 부하 측정용
관측 스택. Prometheus + Grafana + Pushgateway + k6 를 docker compose 로 묶음.

**전체 26 시나리오 통합 정리 (사용자 행동 형식)**: [Notion 부하 측정 시나리오 페이지](https://www.notion.so/36473344235881adbdf7d64842f9a539)
**관련 레포**: [`ticketing`](https://github.com/dongwooooooo/ticketing) (메인) · [`seat-lock-alternatives`](https://github.com/dongwooooooo/seat-lock-alternatives) · [`queue-alternatives`](https://github.com/dongwooooooo/queue-alternatives)

## Stage 1/2/3 측정 스크린샷

[`screenshots/stage1-grafana-overview.png`](screenshots/stage1-grafana-overview.png) — Stage 1 (basic) race 재현, oversell=9
[`screenshots/stage2-grafana-overview.png`](screenshots/stage2-grafana-overview.png) — Stage 2 (concurrency) race 차단 + sustained 부하, p99 178ms
[`screenshots/stage3-grafana-overview.png`](screenshots/stage3-grafana-overview.png) — Stage 3 (queue) gate 동작, queue depth peak 40

## 스택 구성 / 포트 매핑

| 서비스 | 이미지 | 호스트 포트 | 용도 |
|---|---|---|---|
| prometheus | prom/prometheus:v2.54.1 | 9090 | 메트릭 수집 |
| grafana | grafana/grafana:11.2.0 | 3000 | 대시보드 (anonymous Viewer 허용) |
| pushgateway | prom/pushgateway:v1.9.0 | 9091 | k6 → Prometheus 메트릭 push |
| k6 | grafana/k6:0.53.0 | — | 부하 도구 (profiles=tools, 수동 실행) |

Stage 앱 (본 stack 범위 외, 호스트에서 별도 기동):
- **Stage 1 basic** — `host.docker.internal:8080`. 사용자가 좌석 100번 클릭 → 락 없는 단순 `seatRepository.findById` + INSERT. 같은 좌석 클릭한 사용자 여러 명이 동시에 "예매 성공" 응답을 받는다 → DB 에 HELD reservation 이 여러 건 (oversell 발생). 이 실패 모드를 메트릭으로 노출.
- **Stage 2 concurrency** — `host.docker.internal:8081`. 비관적 락 (`@Lock PESSIMISTIC_WRITE`) + partial UNIQUE 2단 방어. 같은 좌석 클릭한 100명 중 1명만 "선점됨", 99명은 "이미 선점됨" 응답. race 차단 정확도와 p99 응답 시간을 메트릭으로 노출.
- **Stage 3 queue** — `host.docker.internal:8082`. 사용자가 "예매 시작" 클릭 시 backend 좌석 API 가 아닌 대기열로 진입. 화면에 "내 앞 N명" 표시. `ticketing_waiting_queue_depth` 게이지로 대기열 길이를 실시간 노출.
- **Stage 4 distributed** — `localhost:28093` (Nginx LB). backend × 2 (app1, app2) + Redis 분산 큐 + Redis SETNX 락 + fencing token + Outbox worker + ShedLock leader election. [`stage4-capacity/`](stage4-capacity/) 참조.

Spring Boot Prometheus endpoint: `/actuator/prometheus`

## 시작 / 중지

```bash
cd /Users/idong-u/d/ticketing-observability
docker compose up -d           # prometheus + grafana + pushgateway 기동
docker compose ps              # 상태 확인
docker compose logs -f grafana # 로그
docker compose down            # 컨테이너만 제거 (볼륨 유지)
docker compose down -v         # 메트릭/대시보드 데이터까지 초기화
```

## 접속 URL

- Prometheus: <http://localhost:9090>
- Grafana: <http://localhost:3000> — 익명 Viewer 자동 진입. admin 계정은 `admin / admin`
- Pushgateway: <http://localhost:9091>
- 사전 provision 된 대시보드: Grafana → Dashboards → Ticketing → "Ticketing Load"

## k6 시나리오 실행

```bash
docker compose run --rm k6 run /scripts/<scenario>.js
```

시나리오 파일은 `k6/scripts/` 에 추가. 별도 task 에서 작성 예정.

## 다른 docker 워크로드와의 충돌 회피

- 별도 bridge 네트워크 `ticketing-observability` 사용. 기존 Testcontainers /
  slunch / mountain 등과 네트워크 격리.
- compose project name 도 `ticketing-observability` 로 고정 (`name:` 필드).
- Stage 앱은 본 stack 에 포함시키지 않고 **호스트 포트 8080/8081/8082** 로
  띄워 `host.docker.internal` 로 scrape. 기존 컨테이너 건드리지 않음.
- 시작/중지는 `docker compose up -d` / `docker compose down` 만 사용.
  **`docker system prune`, `docker network prune` 절대 금지** — 다른 워크로드 파괴.

## 포트 충돌 시

기본 9090 / 3000 / 9091 이 점유 중이면 `docker-compose.yml` 의 `ports` 좌측만
변경 (예: `"19090:9090"`). 우측 컨테이너 포트는 그대로 둘 것.

## 다음 단계

1. Stage 앱 (`/Users/idong-u/d/ticketing/...`) 에 `spring-boot-starter-actuator`
   + `micrometer-registry-prometheus` 의존성 추가 → `/actuator/prometheus` 노출.
   Stage 3 는 `ticketing_waiting_queue_depth` 커스텀 게이지 등록.
2. `k6/scripts/` 에 시나리오 3종 작성 (basic-load / concurrency-spike / queue-soak).
3. 대시보드 확장 — 큐 통과 시간 히스토그램, p95/p99 비교, 좌석 점유 성공률 등.

## 디렉터리 구조

```
ticketing-observability/
├── docker-compose.yml
├── README.md
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/prometheus.yml
│   │   └── dashboards/dashboard.yml
│   └── dashboards/
│       └── ticketing-load.json
└── k6/
    └── scripts/
        └── README.md
```
