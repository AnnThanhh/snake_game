import {
  randomBytes,
  createHmac,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  timingSafeEqual,
} from "node:crypto";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return result;
}
function decode(secret) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret, counter = Math.floor(Date.now() / 30000)) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", decode(secret)).update(buffer).digest(),
    offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function verifyTotp(secret, code, lastCounter = -1, now = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const counter = Math.floor(now / 30000);
  for (const candidate of [counter, counter - 1, counter + 1])
    if (
      candidate > Number(lastCounter) &&
      timingSafeEqual(Buffer.from(code), Buffer.from(totp(secret, candidate)))
    )
      return candidate;
  return null;
}
export function mfaCrypto(serverSecret) {
  const key = Buffer.from(
    hkdfSync("sha256", serverSecret, "serpent-v2", "admin-mfa", 32),
  );
  return {
    encrypt(secret) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), bytes]
        .map((b) => b.toString("base64url"))
        .join(".");
    },
    decrypt(encrypted) {
      const [iv, tag, bytes] = encrypted
        .split(".")
        .map((s) => Buffer.from(s, "base64url"));
      const cipher = createDecipheriv("aes-256-gcm", key, iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(bytes), cipher.final()]).toString(
        "utf8",
      );
    },
  };
}
