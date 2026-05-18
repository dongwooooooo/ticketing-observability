# k6 시나리오 디렉터리

이 디렉터리에 k6 부하 시나리오 (`*.js`) 를 추가한다.
docker-compose의 `k6` 서비스는 `profiles: [tools]` 로 격리되어 있으므로
`docker compose up -d` 시 자동 실행되지 않는다.

## 실행 방법

```bash
# 디렉터리 기준: /Users/idong-u/d/ticketing-observability
docker compose run --rm k6 run /scripts/<scenario>.js
```

호스트의 Stage 앱은 컨테이너 내부에서 `host.docker.internal:8080|8081|8082` 로 접근한다.

## 다음 작업 (별도 task)

- `basic-load.js` — Stage 1 (8080) 단순 좌석 점유
- `concurrency-spike.js` — Stage 2 (8081) 동시 점유 스파이크
- `queue-soak.js` — Stage 3 (8082) 대기열 진입 + 통과 시간 측정

각 시나리오는 Prometheus remote_write 또는 pushgateway 로 결과를 송출한다.
