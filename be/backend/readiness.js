// Coalesce probes and retain the in-flight guard even after a timeout, so an
// unavailable dependency cannot accumulate unbounded checks from health polls.
export function createReadiness(check, { timeoutMs = 2000, cacheMs = 1000 } = {}) {
  let pending = null, result = null, at = 0;
  return async function ready() {
    if (result && Date.now() - at < cacheMs) return result;
    if (!pending) {
      const operation = Promise.resolve().then(check).then(value => value !== false, () => false);
      let timer;
      const response = Promise.race([operation, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })])
        .then(ok => { clearTimeout(timer); at = Date.now(); return result = { version: 1, ok }; });
      pending = response;
      void operation.finally(() => { void response.then(() => { pending = null; }); });
    }
    return pending;
  };
}
