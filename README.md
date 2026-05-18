# ticketing-observability

ticketing 메인 프로젝트의 3개 Stage (basic / concurrency / queue) 부하 측정용
관측 스택. Prometheus + Grafana + Pushgateway + k6 를 docker compose 로 묶음.

## 스택 구성 / 포트 매핑

| 서비스 | 이미지 | 호스트 포트 | 용도 |
|---|---|---|---|
| prometheus | prom/prometheus:v2.54.1 | 9090 | 메트릭 수집 |
| grafana | grafana/grafana:11.2.0 | 3000 | 대시보드 (anonymous Viewer 허용) |
| pushgateway | prom/pushgateway:v1.9.0 | 9091 | k6 → Prometheus 메트릭 push |
| k6 | grafana/k6:0.53.0 | — | 부하 도구 (profiles=tools, 수동 실행) |

Stage 앱 (본 stack 범위 외, 호스트에서 별도 기동):
- Stage 1 basic — `host.docker.internal:8080`
- Stage 2 concurrency — `host.docker.internal:8081`
- Stage 3 queue — `host.docker.internal:8082`

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
