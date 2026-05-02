import { createHmac, timingSafeEqual } from "node:crypto";

export function computeSignature(
  secret: string,
  body: Uint8Array | string
): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(
  secret: string,
  body: Uint8Array | string,
  signatureHex: string
): boolean {
  const expected = computeSignature(secret, body);
  if (expected.length !== signatureHex.length) return false;

  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
