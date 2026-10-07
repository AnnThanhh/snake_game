import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants } from "node:zlib";
const brotli = promisify(brotliCompress),
  gz = promisify(gzip),
  cache = new Map();
function encoding(header = "") {
  const values = new Map(
    header
      .toLowerCase()
      .split(",")
      .map((s) => {
        const [name, ...params] = s.trim().split(";");
        const q = params.find((p) => p.trim().startsWith("q="));
        return [name, q ? Number(q.trim().slice(2)) : 1];
      }),
  );
  return ["br", "gzip"]
    .filter((e) => (values.get(e) ?? values.get("*") ?? 0) > 0)
    .sort(
      (a, b) =>
        (values.get(b) ?? values.get("*") ?? 0) -
        (values.get(a) ?? values.get("*") ?? 0),
    )[0];
}
export async function sendContent(
  req,
  res,
  {
    body,
    type = "text/html; charset=utf-8",
    cache: control = "no-cache",
    robots,
    status = 200,
    retryAfter,
  },
) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body),
    hash = createHash("sha256").update(data).digest("base64url").slice(0, 24);
  const codec =
    data.length > 512 &&
    /^(text\/|application\/(javascript|xml|json))/.test(type)
      ? encoding(req.headers["accept-encoding"])
      : null;
  const etag = '"' + hash + (codec ? "-" + codec : "") + '"';
  const headers = {
    "Content-Type": type,
    "Cache-Control": control,
    ETag: etag,
    Vary: "Accept-Encoding",
    ...(robots ? { "X-Robots-Tag": robots } : {}),
  };
  if (codec) headers["Content-Encoding"] = codec;
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  if (
    status === 200 &&
    req.headers["if-none-match"]
      ?.split(",")
      .map((s) => s.trim().replace(/^W\//, ""))
      .some((s) => s === etag || s === "*")
  ) {
    res.writeHead(304, headers).end();
    return;
  }
  let payload = data;
  if (codec) {
    const key = hash + codec;
    let pending = cache.get(key);
    if (!pending) {
      pending =
        codec === "br"
          ? brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
          : gz(data, { level: 6 });
      cache.set(key, pending);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      pending.catch(() => cache.delete(key));
    }
    payload = await pending;
  }
  headers["Content-Length"] = payload.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : payload);
}
