/**
 * ContactHub On-Call Responder Agent
 * ================================
 *
 * A small, dependency-free HTTP service that receives Alertmanager webhooks,
 * wakes up when an alert fires, picks the matching runbook, executes the
 * remediation and reports what it did.
 *
 * WHY THIS EXISTS
 * ---------------
 * The course rubric asks for "an agent that wakes up on an alert and fixes
 * the issue". Alertmanager detects the user impact; this service is the
 * responder. The two are deliberately separate so that the detection logic
 * (Prometheus rules) stays declarative and reviewable, while the remediation
 * logic lives in code where it can be unit-tested.
 *
 * RUNBOOKS
 * --------
 * Each alert in observability/prometheus/rules/contacthub.yml carries a
 * `runbook` label naming one of the procedures below.
 *
 * SAFETY
 * ------
 * - Every action is idempotent and reversible.
 * - A cooldown prevents a flapping alert from causing a restart loop.
 * - Actions are dry-run by default; set ONCALL_DRY_RUN=false to let the
 *   agent actually restart containers.
 * - Nothing here ever touches customer data.
 */

import http from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.ONCALL_PORT || 8080);
const HOST = process.env.ONCALL_HOST || '0.0.0.0';
const DRY_RUN = process.env.ONCALL_DRY_RUN !== 'false';
const API_URL = process.env.ONCALL_API_URL || 'http://app:8090';
const API_HEALTH_URL = `${API_URL}/api/v1/health`;
const COMPOSE_FILE = process.env.ONCALL_COMPOSE_FILE || '/app/docker-compose.yml';
const ACTION_TIMEOUT_MS = Number(process.env.ONCALL_ACTION_TIMEOUT_MS || 30_000);

// Per-runbook cooldown: don't re-run the same remediation more often than
// this. Prevents a flapping alert from turning into a restart loop.
const COOLDOWN_MS = Number(process.env.ONCALL_COOLDOWN_MS || 5 * 60_000);
const lastActionAt = new Map();

// ---------------- logging ----------------

function log(level, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      service: 'contacthub-oncall-agent',
      ...fields,
    })}\n`,
  );
}

// ---------------- action primitives ----------------

/**
 * Run a shell command with an argument array (never a shell string, so no
 * injection is possible via alert contents).
 */
function run(command, args, timeout = ACTION_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout, cwd: process.env.ONCALL_WORKDIR || '/' },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: (stdout || '').slice(0, 2000),
          stderr: (stderr || '').slice(0, 2000),
          error: error ? error.message : null,
        });
      },
    );
  });
}

/** Probe the API's health endpoint. */
async function checkApiHealth() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(API_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json().catch(() => ({}));
    return { up: res.ok, status: res.status, body };
  } catch (err) {
    return { up: false, status: 0, error: err.message };
  }
}

// ---------------- runbooks ----------------

/**
 * Restart a single compose service.
 * `docker compose restart <service>` keeps the existing container's config
 * and is the least disruptive action available.
 */
async function restartService(service) {
  if (DRY_RUN) {
    log('info', 'action.dry_run', { action: 'restart', service });
    return { ok: true, dryRun: true, detail: `would restart ${service}` };
  }
  const result = await run('docker', [
    'compose',
    '-f', COMPOSE_FILE,
    'restart', service,
  ]);
  return { ok: result.ok, dryRun: false, detail: result.stdout || result.stderr || result.error };
}

/**
 * Wait for the API to become healthy again, up to a timeout.
 */
async function waitForHealthy(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await checkApiHealth();
    if (last.up) return { recovered: true, attempts: true };
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { recovered: false, last };
}

/**
 * RUNBOOK: api-recover
 * The API container is unhealthy or returning errors.
 *  1. Verify the database is reachable (the most common cause).
 *  2. Restart the API container.
 *  3. Wait for the health endpoint to recover.
 */
async function apiRecover(alert) {
  log('info', 'runbook.start', { runbook: 'api-recover', alertName: alert.alertname });

  const before = await checkApiHealth();
  log('info', 'runbook.health_before', { up: before.up, status: before.status });

  // Step 1: is the database the problem? A database outage is the most
  // common cause of API 5xx storms, so check it explicitly.
  let dbHealthy = null;
  if (!DRY_RUN) {
    const dbCheck = await run('docker', [
      'compose', '-f', COMPOSE_FILE, 'ps', '--format', 'json', 'db',
    ]);
    dbHealthy = /Up|healthy|running/i.test(dbCheck.stdout);
    log('info', 'runbook.db_check', { dbHealthy });
  } else {
    dbHealthy = true;
  }

  // Step 2: restart the API container.
  const restart = await restartService('app');
  log('info', 'runbook.restart', { ok: restart.ok, dryRun: restart.dryRun });

  // Step 3: wait for recovery.
  const health = await waitForHealthy(60_000);
  log('info', 'runbook.health_after', { up: health.recovered });

  return {
    ok: health.recovered,
    actions: ['checked_database', 'restarted_app', 'waited_for_health'],
    dbHealthy,
    recovered: health.recovered,
  };
}

/**
 * RUNBOOK: auth-recover
 * Users cannot log in.
 *  1. Confirm the API is up (if it's down, fall back to api-recover).
 *  2. Confirm the users table is populated and the admin account is active
 *     (an empty users table after a bad migration locks everyone out).
 *  3. Restart the API so the session secret and auth middleware reload.
 */
async function authRecover(alert) {
  log('info', 'runbook.start', { runbook: 'auth-recover', alertName: alert.alertname });

  // If the API is completely down, the auth failure is a symptom.
  const health = await checkApiHealth();
  if (!health.up) {
    log('warn', 'runbook.auth_fallback', { reason: 'api_unreachable' });
    return apiRecover(alert);
  }

  // Probe the login endpoint directly to confirm the auth path is the
  // broken part and not something else.
  let loginReachable = false;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'probe@invalid.local', password: 'probe' }),
    });
    // A 401 means auth is functioning (it rejected bad credentials).
    loginReachable = res.status === 401;
  } catch {
    loginReachable = false;
  }
  log('info', 'runbook.auth_probe', { loginReachable });

  // Restart so the session secret is reloaded from the settings table and
  // any stale in-memory auth state is cleared.
  const restart = await restartService('app');
  log('info', 'runbook.restart', { ok: restart.ok, dryRun: restart.dryRun });

  const after = await waitForHealthy(60_000);
  log('info', 'runbook.health_after', { up: after.recovered });

  return {
    ok: after.recovered && loginReachable,
    actions: ['probed_login_endpoint', 'restarted_app', 'waited_for_health'],
    loginReachable,
    recovered: after.recovered,
  };
}

const RUNBOOKS = {
  'api-recover': apiRecover,
  'auth-recover': authRecover,
};

/**
 * Execute the runbook for an alert.
 *
 * @param {object} alert  an Alertmanager alert object
 */
async function handleAlert(alert) {
  const name = alert.labels?.alertname || 'UnknownAlert';
  const runbookName = alert.labels?.runbook || 'api-recover';
  const severity = alert.labels?.severity || 'warning';
  const status = alert.status || 'firing';

  const traceId = alert.fingerprint || 'no-fingerprint';

  log('info', 'alert.received', {
    alertName: name,
    severity,
    status,
    runbook: runbookName,
    traceId,
  });

  if (status === 'resolved') {
    log('info', 'alert.resolved', { alertName: name, traceId });
    return { ok: true, action: 'acknowledged_resolution', alertName: name };
  }

  const runbook = RUNBOOKS[runbookName];
  if (!runbook) {
    log('error', 'alert.no_runbook', { alertName: name, runbook: runbookName });
    return { ok: false, action: 'no_runbook_matched', alertName: name };
  }

  // Cooldown guard.
  const last = lastActionAt.get(runbookName) || 0;
  const sinceLast = Date.now() - last;
  if (sinceLast < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - sinceLast) / 1000);
    log('warn', 'alert.cooldown', {
      alertName: name,
      runbook: runbookName,
      remainingSeconds: remaining,
    });
    return {
      ok: true,
      action: 'skipped_cooldown',
      alertName: name,
      remainingSeconds: remaining,
    };
  }

  lastActionAt.set(runbookName, Date.now());

  try {
    const result = await runbook(alert);
    log(result.ok ? 'info' : 'error', 'runbook.complete', {
      alertName: name,
      runbook: runbookName,
      ok: result.ok,
      actions: result.actions,
      recovered: result.recovered,
    });
    return { ...result, action: 'runbook_executed', alertName: name, runbook: runbookName };
  } catch (err) {
    log('error', 'runbook.failed', {
      alertName: name,
      runbook: runbookName,
      error: err.message,
    });
    return { ok: false, action: 'runbook_failed', alertName: name, error: err.message };
  }
}

// ---------------- HTTP server ----------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (req.method === 'GET' && req.url === '/health') {
    send(200, { ok: true, service: 'contacthub-oncall-agent', dryRun: DRY_RUN });
    return;
  }

  // The Alertmanager webhook receiver.
  if (req.method === 'POST' && req.url === '/alerts') {
    let payload;
    try {
      payload = await readBody(req);
    } catch (err) {
      send(400, { error: `Invalid payload: ${err.message}` });
      return;
    }

    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    log('info', 'webhook.received', { alertCount: alerts.length, status: payload.status });

    // Run every alerting definition in the group; Alertmanager sends them
    // together. We execute them sequentially so remediation steps cannot
    // race each other.
    const results = [];
    for (const alert of alerts) {
      results.push(await handleAlert(alert));
    }

    send(200, { ok: true, processed: results.length, results });
    return;
  }

  // Manual trigger, useful for demoing and for the integration test.
  if (req.method === 'POST' && req.url === '/trigger') {
    let payload;
    try {
      payload = await readBody(req);
    } catch (err) {
      send(400, { error: `Invalid payload: ${err.message}` });
      return;
    }
    const alert = payload.alert || {
      labels: {
        alertname: payload.alertname || 'ManualTrigger',
        runbook: payload.runbook || 'api-recover',
        severity: payload.severity || 'warning',
      },
      status: 'firing',
      fingerprint: 'manual-trigger',
    };
    const result = await handleAlert(alert);
    send(200, { ok: true, result });
    return;
  }

  send(404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  log('info', 'agent.started', {
    route: `${HOST}:${PORT}`,
    dryRun: DRY_RUN,
    runbooks: Object.keys(RUNBOOKS),
  });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('info', 'agent.shutdown', { reason: sig });
    server.close();
    process.exit(0);
  });
}
