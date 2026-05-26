#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const resultsDir = path.join(__dirname, 'results');
const files = {
  single2: path.join(resultsDir, 'stage4-single-scale-1x2-500.summary.json'),
  single4: path.join(resultsDir, 'stage4-single-scale-1x4-500.summary.json'),
  dual2: path.join(resultsDir, 'stage4-dual-scale-2x2-500.summary.json'),
};

function metric(summary, name, key = 'value') {
  const m = summary.metrics[name];
  if (!m) return undefined;
  if (m.values && Object.prototype.hasOwnProperty.call(m.values, key)) return m.values[key];
  if (Object.prototype.hasOwnProperty.call(m, key)) return m[key];
  if (key === 'count' && m.values && Object.prototype.hasOwnProperty.call(m.values, 'count')) return m.values.count;
  return undefined;
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function row(mode, backend, summary) {
  const tokenIssued = metric(summary, 'token_issued', 'count') ?? 0;
  const admitted = metric(summary, 'admitted', 'count') ?? 0;
  const reserveSuccess = metric(summary, 'reserve_success', 'count') ?? 0;
  const reserveConflict = metric(summary, 'reserve_conflict', 'count') ?? 0;
  const reserveFailed = metric(summary, 'reserve_failed', 'count') ?? 0;
  return {
    mode,
    backend,
    httpReqRate: metric(summary, 'http_reqs', 'rate'),
    iterationRate: metric(summary, 'iterations', 'rate'),
    tokenIssued,
    tokenIssuedRate: metric(summary, 'token_issued', 'rate'),
    admitted,
    admittedRate: metric(summary, 'admitted', 'rate'),
    reserveSuccess,
    reserveSuccessRate: metric(summary, 'reserve_success', 'rate'),
    reserveConflict,
    reserveFailed,
    admitTimeout: metric(summary, 'admit_timeout', 'count') ?? 0,
    tokenFailed: metric(summary, 'token_failed', 'count') ?? 0,
    dropped: metric(summary, 'dropped_iterations', 'count') ?? 0,
    httpFailedRate: metric(summary, 'http_req_failed', 'rate'),
    admitP95: metric(summary, 'admit_wait_ms', 'p(95)'),
    totalP95: metric(summary, 'total_latency_ms', 'p(95)'),
    reserveP95: metric(summary, 'reserve_latency_ms', 'p(95)'),
  };
}

function fmt(n, digits = 2) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return Number(n).toFixed(digits);
}

function count(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  return Math.round(Number(n)).toLocaleString('en-US');
}

const single2 = row('single', '1 x 2CPU', read(files.single2));
const single4 = row('single', '1 x 4CPU', read(files.single4));
const dual2 = row('dual', '2 x 2CPU', read(files.dual2));

const output = [];
output.push('# Stage 4 controlled scale comparison');
output.push('');
output.push('조건: DB=2 CPU/2GB, Redis=2 CPU/2GB, Nginx=0.5 CPU 고정. Backend만 1x2CPU, 1x4CPU, 2x2CPU로 변경.');
output.push('부하: k6 scale-comparison.js, 100 -> 500 RPS controlled ramp. 예약 API 경로는 /seats/{seatId}/reservations 사용.');
output.push('');
output.push('| mode | backend | http req/s | iterations/s | token issued | admitted | reserve success | reserve conflict | reserve failed | admit timeout | token failed | dropped iterations | admit p95 | total p95 | reserve p95 | http failed |');
output.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of [single2, single4, dual2]) {
  output.push(`| ${r.mode} | ${r.backend} | ${fmt(r.httpReqRate)} | ${fmt(r.iterationRate)} | ${count(r.tokenIssued)} (${fmt(r.tokenIssuedRate)}/s) | ${count(r.admitted)} (${fmt(r.admittedRate)}/s) | ${count(r.reserveSuccess)} (${fmt(r.reserveSuccessRate)}/s) | ${count(r.reserveConflict)} | ${count(r.reserveFailed)} | ${count(r.admitTimeout)} | ${count(r.tokenFailed)} | ${count(r.dropped)} | ${fmt(r.admitP95 / 1000)}s | ${fmt(r.totalP95 / 1000)}s | ${fmt(r.reserveP95 / 1000)}s | ${fmt((r.httpFailedRate ?? 0) * 100)}% |`);
}
output.push('');
output.push('## ratios');
output.push(`1x4 total p95 / 1x2 total p95: ${fmt(single4.totalP95 / single2.totalP95)}x`);
output.push(`2x2 total p95 / 1x2 total p95: ${fmt(dual2.totalP95 / single2.totalP95)}x`);
output.push(`2x2 total p95 / 1x4 total p95: ${fmt(dual2.totalP95 / single4.totalP95)}x`);
output.push(`2x2 reserve p95 / 1x2 reserve p95: ${fmt(dual2.reserveP95 / single2.reserveP95)}x`);
output.push(`2x2 reserve p95 / 1x4 reserve p95: ${fmt(dual2.reserveP95 / single4.reserveP95)}x`);
output.push('');

const text = output.join('\n');
const outFile = path.join(resultsDir, 'stage4-scale-comparison.txt');
fs.writeFileSync(outFile, text);
console.log(text);
