import { randomUUID } from 'node:crypto';
import { mkdir, appendFile, stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) ? value : 'unknown';
const numericFields = new Set(['status', 'durationMs', 'responseBytes', 'count', 'pending', 'failed', 'saved', 'oldestSeconds', 'attempt', 'dropped']);
const tokenFields = new Set(['code', 'method', 'outcome', 'dependency', 'mode', 'reason']);
const idFields = new Set(['requestId', 'lifeId']);

// Explicit fields only: never serialize Error, URLs, headers, body, SQL, cookies or credentials.
export function safeRecord(service, level, event, fields = {}) {
  const record = { version: 1, time: new Date().toISOString(), service: token(service), pid: process.pid, level, event: token(event) };
  for (const [key, value] of Object.entries(fields)) {
    if (numericFields.has(key) && Number.isFinite(value)) record[key] = Math.round(value * 1000) / 1000;
    else if (tokenFields.has(key)) record[key] = token(value);
    else if (idFields.has(key) && UUID.test(value)) record[key] = value;
    else if (key === 'route') record.route = routeName(value);
  }
  return record;
}

// Finite route families also avoid logging private IDs embedded in paths or WS tokens in queries.
export function routeName(url = '') {
  const p = String(url).split('?')[0];
  if (/^\/(health|livez|readyz|metrics)$/.test(p)) return p;
  if (/^\/api\/(health|live|ready|site|configuration|v2|rooms|presence)$/.test(p)) return p;
  if (/^\/api\/account\/(catalog|content|register|login|logout|me|access|ticket|unlock|meta|history|leaderboard|reports|security|appeals)$/.test(p)) return p;
  if (/^\/api\/account\/notifications\/[^/]+\/read$/.test(p)) return '/api/account/notifications/:id/read';
  if (/^\/admin\/players\/[^/]+(?:\/[^/]+)?$/.test(p)) return '/admin/players/:id/:action';
  if (/^\/admin\/(reports|appeals|whitelist)\/[^/]+$/.test(p)) return p.slice(0, p.lastIndexOf('/')) + '/:id';
  if (/^\/admin\/(access|players|definitions|reports|appeals|security-events|roles|permissions|role-permissions|whitelist|policy|catalog|settings|audit|mfa\/enroll|mfa\/verify)$/.test(p)) return p;
  if (/^\/internal\/(configuration|catalog|admission|revalidate|results|reports|security\/events|tickets\/consume|presence)$/.test(p)) return p;
  if (p.startsWith('/rt/') || p.startsWith('/matchmake/')) return '/rt/:route';
  if (p === '/' || p === '/admin.html' || p === '/index.html') return p;
  return '/:other';
}

export function createLogger(service, { directory = process.env.LOG_DIR, maxBytes = 10 * 1024 * 1024, maxFiles = 5, maxQueueBytes = 1024 * 1024, output = line => {
  if (process.stdout.writableLength < 1024 * 1024) process.stdout.write(line);
} } = {}) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20 || maxBytes < 512 || maxQueueBytes < 512) throw new Error('Invalid log storage limits');
  const instance = process.env.LOG_INSTANCE ? '-' + token(process.env.LOG_INSTANCE) : '';
  const filename = directory ? path.resolve(directory, token(service) + instance + '.jsonl') : null;
  let queue = [], queuedBytes = 0, draining = null, initialized = false, size = 0, dropped = 0, failures = 0, closed = false;
  async function drain() {
    try {
      if (!initialized) {
        await mkdir(path.dirname(filename), { recursive: true });
        size = await stat(filename).then(s => s.size, e => { if (e.code === 'ENOENT') return 0; throw e; });
        initialized = true;
      }
      while (queue.length) {
        let line = queue[0], bytes = Buffer.byteLength(line), count = 1;
        if (size && size + bytes > maxBytes) {
          await rm(filename + '.' + (maxFiles - 1), { force: true });
          for (let i = maxFiles - 2; i >= 1; i--) await rename(filename + '.' + i, filename + '.' + (i + 1)).catch(e => { if (e.code !== 'ENOENT') throw e; });
          if (maxFiles > 1) await rename(filename, filename + '.1');
          else await rm(filename, { force: true });
          size = 0;
        }
        while(count < queue.length && bytes + Buffer.byteLength(queue[count]) <= Math.min(65536, maxBytes - size)) {
          bytes += Buffer.byteLength(queue[count]); line += queue[count++];
        }
        await appendFile(filename, line, { mode: 0o600 });
        size += bytes; queuedBytes -= bytes; queue.splice(0,count);
      }
      failures = 0;
    } catch (error) {
      dropped += queue.length; queue = []; queuedBytes = 0; initialized = false;
      if (failures++ === 0) process.stderr.write(JSON.stringify(safeRecord(service, 'error', 'log.storage_failed', { code: error.code, dropped })) + '\n');
    }
  }
  function emit(level, event, fields) {
    if (closed) return;
    const line = JSON.stringify(safeRecord(service, level, event, fields)) + '\n';
    try { output?.(line); } catch { dropped++; }
    if (!filename) return;
    const bytes = Buffer.byteLength(line);
    if (bytes > maxBytes || queuedBytes + bytes > maxQueueBytes) { dropped++; return; }
    queue.push(line); queuedBytes += bytes;
    if (!draining) draining = drain().finally(() => { draining = null; });
  }
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    stats: () => ({ dropped, queuedBytes, failures }),
    async flush() { while (draining) await draining; },
    async close() { closed = true; while (draining) await draining; },
  };
}

const observation = Symbol('httpObservation');
export function observeResponse(req, res, logger, { freshId = false, onComplete = null } = {}) {
  if (req[observation]) return req[observation];
  const supplied = req.headers['x-request-id'];
  const requestId = !freshId && typeof supplied === 'string' && UUID.test(supplied) ? supplied : randomUUID();
  const started = performance.now();
  let completed = false;
  req[observation] = requestId;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  function finish(outcome) {
    if (completed) return;
    completed = true;
    const fields = { requestId, method: req.method, route: req.url, status: outcome === 'aborted' ? 499 : res.statusCode, durationMs: performance.now() - started, outcome };
    const length = res.getHeader('content-length');
    if (length !== undefined && Number.isFinite(Number(length))) fields.responseBytes = Number(length);
    logger[fields.status >= 500 ? 'error' : fields.status >= 400 ? 'warn' : 'info']('http.response', fields);
    onComplete?.({ ...fields, route: routeName(fields.route) });
  }
  res.once('finish', () => finish('completed'));
  res.once('close', () => finish(res.writableFinished ? 'completed' : 'aborted'));
  return requestId;
}

export const operationalLog = createLogger(process.env.SERVICE_NAME || 'backend');
