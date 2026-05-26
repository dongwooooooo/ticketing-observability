#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const prometheus = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const now = Math.floor(Date.now() / 1000);

const specs = [
  {
    spec: 'stage4-single-opening-rerun2-1x2-pool10',
    label: '1대 x 2 CPU / pool 10',
    summary: 'stage4-capacity/results/stage4-single-opening-rerun2-1x2-pool10.summary.json',
  },
  {
    spec: 'stage4-single-opening-rerun2-1x4-pool20',
    label: '1대 x 4 CPU / pool 20',
    summary: 'stage4-capacity/results/stage4-single-opening-rerun2-1x4-pool20.summary.json',
  },
  {
    spec: 'stage4-dual-opening-rerun1-2x2-pool10',
    label: '2대 x 2 CPU / pool 10씩',
    summary: 'stage4-capacity/results/stage4-dual-opening-rerun1-2x2-pool10.summary.json',
  },
  {
    spec: 'stage4-dual-opening-rerun1-2x2-pool20',
    label: '2대 x 2 CPU / pool 20씩',
    summary: 'stage4-capacity/results/stage4-dual-opening-rerun1-2x2-pool20.summary.json',
  },
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

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

async function queryRange(query, start, end, step = '5s') {
  return prom('/api/v1/query_range', { query, start, end, step });
}

function metric(summary, name, key) {
  const value = summary.metrics?.[name];
  if (!value) return null;
  return value.values?.[key] ?? value[key] ?? null;
}

function maxByLabel(result, label = 'app_instance') {
  return (result.result ?? [])
    .map((series) => {
      const values = (series.values ?? [])
        .map(([, value]) => Number(value))
        .filter(Number.isFinite);
      return {
        label: series.metric?.[label] ?? series.metric?.instance ?? 'unknown',
        max: values.length ? Math.max(...values) : null,
      };
    })
    .filter((row) => row.max != null);
}

function maxSum(result) {
  const byTimestamp = new Map();
  for (const series of result.result ?? []) {
    for (const [timestamp, value] of series.values ?? []) {
      byTimestamp.set(timestamp, (byTimestamp.get(timestamp) ?? 0) + Number(value));
    }
  }
  const values = [...byTimestamp.values()].filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

async function activeWindow(spec) {
  const active = await queryRange(
    `sum(rate(k6_token_issued_total{spec="${spec}"}[10s]))`,
    now - 21_600,
    now,
    '5s',
  );
  const timestamps = [];
  for (const series of active.result ?? []) {
    for (const [timestamp, value] of series.values ?? []) {
      if (Number(value) > 0.1) timestamps.push(Number(timestamp));
    }
  }
  if (!timestamps.length) return null;
  return {
    start: Math.min(...timestamps) - 5,
    end: Math.max(...timestamps) + 5,
  };
}

async function infraMetrics(start, end) {
  const queries = {
    appCpuMax: 'process_cpu_usage{stage="distributed"}',
    hikariActiveMax: 'hikaricp_connections_active{stage="distributed"}',
    hikariPendingMax: 'hikaricp_connections_pending{stage="distributed"}',
    hikariTimeoutMax: 'hikaricp_connections_timeout_total{stage="distributed"}',
    redisOpsMax: 'rate(redis_commands_processed_total{stage="distributed"}[1m])',
    redisCpuMax: 'rate(process_cpu_seconds_total{job="stage4-redis"}[1m])',
    postgresConnectionsMax: 'pg_stat_database_numbackends{stage="distributed",datname="ticketing"}',
    postgresCommitRateMax: 'rate(pg_stat_database_xact_commit{stage="distributed",datname="ticketing"}[1m])',
  };

  const result = {};
  for (const [name, query] of Object.entries(queries)) {
    const data = await queryRange(query, start, end, '5s');
    if (name.startsWith('hikari') || name === 'appCpuMax') {
      result[name] = maxByLabel(data);
    } else {
      result[name] = maxSum(data);
    }
  }
  return result;
}

function readSummary(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function kst(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
}

const rows = [];
for (const item of specs) {
  const summary = readSummary(item.summary);
  const window = await activeWindow(item.spec);
  if (!window) {
    rows.push({ ...item, error: 'Prometheus active window not found' });
    continue;
  }

  rows.push({
    spec: item.spec,
    label: item.label,
    summaryPath: item.summary,
    activeWindowKst: {
      start: kst(window.start),
      end: kst(window.end),
      durationSeconds: window.end - window.start,
    },
    k6: {
      httpRequests: metric(summary, 'http_reqs', 'count'),
      httpRequestRate: metric(summary, 'http_reqs', 'rate'),
      tokenIssued: metric(summary, 'token_issued', 'count'),
      tokenIssuedRate: metric(summary, 'token_issued', 'rate'),
      admitted: metric(summary, 'admitted', 'count'),
      reserveSuccess: metric(summary, 'reserve_success', 'count'),
      reserveConflict: metric(summary, 'reserve_conflict', 'count') ?? 0,
      reserveFailed: metric(summary, 'reserve_failed', 'count') ?? 0,
      tokenFailed: metric(summary, 'token_failed', 'count') ?? 0,
      droppedIterations: metric(summary, 'dropped_iterations', 'count') ?? 0,
      admitWaitP95Ms: metric(summary, 'admit_wait_ms', 'p(95)'),
      totalLatencyP95Ms: metric(summary, 'total_latency_ms', 'p(95)'),
    },
    infra: await infraMetrics(window.start, window.end),
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  prometheusUrl: prometheus,
  note: 'This JSON stores per-run aggregate infra metrics for portfolio evidence. Use export-prometheus-timeseries.mjs when a time-series JSON is needed.',
  rows,
};

const outPath = argValue('--out');
if (outPath) {
  const absolute = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(output, null, 2)}\n`);
  console.log(absolute);
} else {
  console.log(JSON.stringify(output, null, 2));
}
