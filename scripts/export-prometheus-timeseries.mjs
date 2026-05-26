#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const prometheus = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

const spec = argValue('--spec');
if (!spec || hasArg('--help')) {
  console.error(`Usage:
  ./scripts/export-prometheus-timeseries.mjs --spec <k6-spec> [--out <file>] [--lookback-hours 24] [--step 5s]

Examples:
  ./scripts/export-prometheus-timeseries.mjs \\
    --spec stage4-dual-opening-rerun1-2x2-pool20 \\
    --out screenshots/portfolio-evidence/prometheus-timeseries/stage4-dual-opening-rerun1-2x2-pool20.json
`);
  process.exit(spec ? 0 : 2);
}

const outPath = argValue(
  '--out',
  `screenshots/portfolio-evidence/prometheus-timeseries/${spec}.json`,
);
const lookbackHours = Number(argValue('--lookback-hours', '2'));
const step = argValue('--step', '5s');
const now = Math.floor(Date.now() / 1000);
const lookbackStart = now - Math.max(1, lookbackHours) * 3600;

async function prom(pathname, params) {
  const url = new URL(pathname, prometheus);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.status !== 'success') throw new Error(JSON.stringify(body));
  return body.data;
}

async function queryRange(query, start, end, queryStep = step) {
  return prom('/api/v1/query_range', { query, start, end, step: queryStep });
}

function valuesFromRange(data) {
  return (data.result ?? []).flatMap((series) =>
    (series.values ?? []).map(([timestamp, value]) => ({
      timestamp: Number(timestamp),
      value: Number(value),
    })),
  ).filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.value));
}

async function activeWindow() {
  const candidates = [
    `sum(rate(k6_token_issued_total{spec="${spec}"}[10s]))`,
    `sum(rate(k6_reserve_success_total{spec="${spec}"}[10s]))`,
    `sum(rate(k6_admitted_total{spec="${spec}"}[10s]))`,
    `sum(rate(k6_http_reqs_total{spec="${spec}"}[10s]))`,
  ];

  for (const query of candidates) {
    const data = await queryRange(query, lookbackStart, now, '5s');
    const timestamps = valuesFromRange(data)
      .filter((row) => row.value > 0.01)
      .map((row) => row.timestamp);
    if (timestamps.length) {
      return {
        query,
        start: Math.min(...timestamps) - 10,
        end: Math.max(...timestamps) + 10,
      };
    }
  }
  return null;
}

function kst(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function stageFromSpec(value) {
  if (value.includes('stage2')) return 'stage2';
  if (value.includes('stage3')) return 'stage3';
  if (value.includes('stage4')) return 'stage4';
  return 'unknown';
}

const stage = stageFromSpec(spec);

const k6MetricQueries = [
  {
    group: 'k6 direct flow',
    name: 'http_reqs_per_sec',
    query: `sum(rate(k6_http_reqs_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 direct flow',
    name: 'reserve_failed_per_sec',
    query: `sum(rate(k6_reserve_failed_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 direct flow',
    name: 'server_5xx_rate',
    query: `k6_server_5xx_rate{spec="${spec}"}`,
  },
  {
    group: 'k6 direct latency',
    name: 'reserve_latency_p95_ms',
    query: `k6_reserve_latency_ms_p95{spec="${spec}"}`,
  },
  {
    group: 'k6 direct latency',
    name: 'reserve_latency_p99_ms',
    query: `k6_reserve_latency_ms_p99{spec="${spec}"}`,
  },
  {
    group: 'k6 flow',
    name: 'token_issued_per_sec',
    query: `sum(rate(k6_token_issued_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 flow',
    name: 'admitted_per_sec',
    query: `sum(rate(k6_admitted_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 flow',
    name: 'reserve_success_per_sec',
    query: `sum(rate(k6_reserve_success_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 failure',
    name: 'token_failed_per_sec',
    query: `sum(rate(k6_token_failed_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 failure',
    name: 'admit_timeout_per_sec',
    query: `sum(rate(k6_admit_timeout_total{spec="${spec}"}[1m]))`,
  },
  {
    group: 'k6 latency',
    name: 'admit_wait_p95_ms',
    query: `k6_admit_wait_ms_p95{spec="${spec}"}`,
  },
  {
    group: 'k6 latency',
    name: 'total_latency_p95_ms',
    query: `k6_total_latency_ms_p95{spec="${spec}"}`,
  },
  {
    group: 'k6 latency',
    name: 'total_latency_p99_ms',
    query: `k6_total_latency_ms_p99{spec="${spec}"}`,
  },
];

const stage2InfraQueries = [
  {
    group: 'application',
    name: 'app_cpu',
    query: 'process_cpu_usage{stage="concurrency"}',
  },
  {
    group: 'application',
    name: 'hikari_active',
    query: 'hikaricp_connections_active{stage="concurrency"}',
  },
  {
    group: 'application',
    name: 'hikari_pending',
    query: 'hikaricp_connections_pending{stage="concurrency"}',
  },
];

const stage3InfraQueries = [
  {
    group: 'application',
    name: 'app_cpu',
    query: 'process_cpu_usage{stage="queue"}',
  },
  {
    group: 'application',
    name: 'hikari_active',
    query: 'hikaricp_connections_active{stage="queue"}',
  },
  {
    group: 'application',
    name: 'hikari_pending',
    query: 'hikaricp_connections_pending{stage="queue"}',
  },
];

const stage4InfraQueries = [
  {
    group: 'application',
    name: 'app_cpu',
    query: 'process_cpu_usage{stage="distributed"}',
  },
  {
    group: 'application',
    name: 'hikari_active',
    query: 'hikaricp_connections_active{stage="distributed"}',
  },
  {
    group: 'application',
    name: 'hikari_pending',
    query: 'hikaricp_connections_pending{stage="distributed"}',
  },
  {
    group: 'redis',
    name: 'redis_ops_per_sec',
    query: 'rate(redis_commands_processed_total{stage="distributed"}[1m])',
  },
  {
    group: 'redis',
    name: 'redis_cpu_seconds_per_sec',
    query: 'rate(process_cpu_seconds_total{job="stage4-redis"}[1m])',
  },
  {
    group: 'postgres',
    name: 'postgres_connections',
    query: 'pg_stat_database_numbackends{stage="distributed",datname="ticketing"}',
  },
  {
    group: 'postgres',
    name: 'postgres_commit_per_sec',
    query: 'rate(pg_stat_database_xact_commit{stage="distributed",datname="ticketing"}[1m])',
  },
];

const infraMetricQueries =
  stage === 'stage2' ? stage2InfraQueries
    : stage === 'stage3' ? stage3InfraQueries
      : stage === 'stage4' ? stage4InfraQueries
        : [];
const metricQueries = [...k6MetricQueries, ...infraMetricQueries];

const window = await activeWindow();
if (!window) {
  throw new Error(`No active Prometheus window found for spec=${spec} in last ${lookbackHours}h`);
}

const series = [];
for (const item of metricQueries) {
  const data = await queryRange(item.query, window.start, window.end, step);
  series.push({
    ...item,
    resultType: data.resultType,
    result: data.result ?? [],
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  prometheusUrl: prometheus,
  spec,
  stage,
  activeWindow: {
    query: window.query,
    startUnix: window.start,
    endUnix: window.end,
    startKst: kst(window.start),
    endKst: kst(window.end),
    durationSeconds: window.end - window.start,
  },
  note: 'k6 실행 직후 Prometheus query_range 결과를 보관하기 위한 파일이다. Grafana 캡처를 수치 근거로 대체하지 않고, summary JSON과 함께 사용한다.',
  series,
};

const absoluteOut = path.resolve(repoRoot, outPath);
fs.mkdirSync(path.dirname(absoluteOut), { recursive: true });
fs.writeFileSync(absoluteOut, `${JSON.stringify(output, null, 2)}\n`);
console.log(absoluteOut);
