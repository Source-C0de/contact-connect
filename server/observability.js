// ContactHub observability primitives.
//
// Three signals, all sharing one correlation id:
//   1. Structured logs  -> JSON lines on stdout, scraped by Promtail into Loki.
//   2. Metrics          -> Prometheus counters/histograms exposed at /api/v1/metrics.
//   3. Traces           -> one trace id per request, echoed on the response and
//                          attached to every log line + span emitted for the request.
//
// PRIVACY CONTRACT: telemetry must never carry customer data. We therefore
// never log emails, names, phone numbers, passwords, tokens or free-text
// bodies. Users are referenced by an opaque, non-reversible id derived from
// their email (see `subjectHash`) so we can still correlate "the same user"
// across requests without ever storing the address itself.

import crypto from 'node:crypto';

// ---------------- trace ids ----------------

const TRACE_HEADER = 'x-request-id';
// 32 hex chars = 128 bits. Cheap to generate, short enough to read in a log.
const TRACE_RE = /^[a-f0-9]{16,64}$/i;

export function newTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Resolve the trace id for a request.
 *
 * If the client already sent an `x-request-id` (or a W3C `traceparent`), we
 * honour it so a trace can span multiple hops. Otherwise we mint a new one.
 */
export function resolveTraceId(req) {
  const incoming = req.headers[TRACE_HEADER];
  if (typeof incoming === 'string' && TRACE_RE.test(incoming)) return incoming;

  const traceparent = req.headers.traceparent;
  if (typeof traceparent === 'string') {
    const parts = traceparent.split('-');
    if (parts.length >= 3 && /^[a-f0-9]{32}$/i.test(parts[1])) return parts[1];
  }
  return newTraceId();
}

// ---------------- subject hashing ----------------

/**
 * Stable, non-reversible id for a user.
 *
 * HMAC with a per-process salt so the same person gets the same id for the
 * lifetime of the deployment, but the id cannot be reversed into an email
 * without knowing the key.
 */
let SUBJECT_SALT = crypto.randomBytes(16);

export function configureSubjectSalt(salt) {
  if (typeof salt === 'string' && salt.length >= 8) {
    SUBJECT_SALT = Buffer.from(salt, 'utf8');
  }
}

export function subjectHash(value) {
  if (!value) return null;
  return crypto
    .createHmac('sha256', SUBJECT_SALT)
    .update(String(value).trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

// ---------------- structured logging ----------------

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';

/**
 * Redact anything that could contain customer data.
 *
 * We use an allow-list approach for log fields rather than a deny-list: only
 * the keys listed here are ever emitted. Everything else is dropped. That
 * makes it impossible for a future code change to accidentally start leaking
 * PII into telemetry.
 */
const SAFE_FIELDS = new Set([
  'traceId',
  'spanId',
  'parentSpanId',
  'method',
  'route',
  'path',
  'status',
  'durationMs',
  'event',
  'level',
  'userId',
  'role',
  'entityType',
  'entityId',
  'count',
  'error',
  'errorType',
  'statusCode',
  'syncType',
  'recordsAffected',
  'alertName',
  'severity',
  'action',
  'target',
  'version',
  'up',
  'db',
  'reason',
  'result',
  'attempt',
]);

function sanitize(fields) {
  const out = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      // Nested objects are almost always payloads -> skip them entirely.
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Emit one structured log line.
 *
 * @param {string} level  debug | info | warn | error
 * @param {string} event  a stable machine-readable event name, e.g. "employee.created"
 * @param {object} fields allow-listed contextual fields
 * @param {string} [traceId] correlation id to attach
 */
export function log(level, event, fields = {}, traceId = null) {
  if ((LEVELS[level] ?? LEVELS.info) < MIN_LEVEL) return;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: 'contacthub-api',
    ...sanitize(fields),
  };
  if (traceId) payload.traceId = traceId;

  if (LOG_FORMAT === 'pretty') {
    const { timestamp, level: lvl, event: evt, ...rest } = payload;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    process.stdout.write(`${timestamp} ${lvl.toUpperCase().padEnd(5)} ${evt}${extra}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export const logger = {
  debug: (event, fields, traceId) => log('debug', event, fields, traceId),
  info: (event, fields, traceId) => log('info', event, fields, traceId),
  warn: (event, fields, traceId) => log('warn', event, fields, traceId),
  error: (event, fields, traceId) => log('error', event, fields, traceId),
};

// ---------------- metrics ----------------

/**
 * A tiny, dependency-free Prometheus text-format registry.
 *
 * We avoid `prom-client` so the server keeps its three-dependency footprint
 * (express, pg, cors) and so the metrics endpoint has no supply-chain
 * surface. The subset we need is small and well understood.
 */
class Metrics {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  increment(name, labels = {}, help = '') {
    const key = this._key(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += 1;
    } else {
      this.counters.set(key, { name, labels, value: 1, help });
    }
  }

  observe(name, labels = {}, value = 0, help = '') {
    const key = this._key(name, labels);
    let bucket = this.histograms.get(key);
    if (!bucket) {
      bucket = { name, labels, counts: new Map(), sum: 0, count: 0, help };
      this.histograms.set(key, bucket);
    }
    bucket.sum += value;
    bucket.count += 1;
  }

  /** Current value of a counter (used by tests and the on-call agent). */
  value(name, labels = {}) {
    const entry = this.counters.get(this._key(name, labels));
    return entry ? entry.value : 0;
  }

  render() {
    const lines = [];
    const seenHelp = new Set();

    for (const c of this.counters.values()) {
      if (!seenHelp.has(c.name)) {
        if (c.help) lines.push(`# HELP ${c.name} ${c.help}`);
        lines.push(`# TYPE ${c.name} counter`);
        seenHelp.add(c.name);
      }
      lines.push(`${this._key(c.name, c.labels)} ${c.value}`);
    }

    for (const h of this.histograms.values()) {
      if (!seenHelp.has(h.name)) {
        if (h.help) lines.push(`# HELP ${h.name} ${h.help}`);
        lines.push(`# TYPE ${h.name} histogram`);
        seenHelp.add(h.name);
      }
      lines.push(`${this._key(`${h.name}_sum`, h.labels)} ${h.sum}`);
      lines.push(`${this._key(`${h.name}_count`, h.labels)} ${h.count}`);
    }

    return `${lines.join('\n')}\n`;
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
  }
}

export const metrics = new Metrics();

// Buckets tuned for an interactive directory API: we care about "feels
// instant" (<100ms) through to "user gave up" (>2.5s).
const LATENCY_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function observeLatency(route, method, statusCode, durationMs) {
  metrics.observe(
    'contacthub_http_request_duration_seconds',
    { route, method, status: String(statusCode) },
    durationMs / 1000,
    'HTTP request latency in seconds',
  );
}

export function countRequest(route, method, statusCode) {
  metrics.increment(
    'contacthub_http_requests_total',
    { route, method, status: String(statusCode) },
    'Total HTTP requests handled',
  );
}

export function countUserImpact(event, labels = {}) {
  metrics.increment(
    'contacthub_user_impact_events_total',
    { event, ...labels },
    'User-impacting business events (login success/failure, sync, etc.)',
  );
}

export { LATENCY_BUCKETS };
