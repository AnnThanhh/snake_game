import http from 'node:http';
import https from 'node:https';

// A deadline covers slow trickle responses too; socket timeout alone is insufficient.
export function proxyHttp(req, res, target, headers, { timeoutMs = 10000, unavailableStatus = 503 } = {}) {
  const transport = target.protocol === 'https:' ? https : http;
  const requestId = req.headers['x-request-id'];
  let incoming, done = false;
  const upstream = transport.request(target, { method: req.method, headers }, response => {
    if(done || res.destroyed){response.destroy();return;}
    incoming = response;
    response.on('error', () => fail(unavailableStatus));
    response.on('aborted', () => fail(unavailableStatus));
    res.writeHead(response.statusCode, { ...response.headers, 'x-request-id': requestId });
    response.pipe(res);
  });
  const timer = setTimeout(() => fail(504), timeoutMs);
  function cleanup() { clearTimeout(timer); req.off('aborted', aborted); req.off('error', aborted); res.off('close', closed); }
  function fail(status) {
    if (done) return;
    done = true; cleanup(); upstream.destroy(); incoming?.destroy();
    if (res.headersSent) res.destroy();
    else res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': requestId }).end(JSON.stringify({ error: 'Upstream unavailable', requestId }));
  }
  function aborted() { if (!done) { done = true; cleanup(); upstream.destroy(); incoming?.destroy(); } }
  function closed() { if (!res.writableFinished) aborted(); }
  req.once('aborted', aborted);
  req.once('error', aborted);
  res.once('close', closed);
  res.once('finish', () => { done = true; cleanup(); });
  upstream.on('error', () => fail(unavailableStatus));
  req.pipe(upstream);
}
