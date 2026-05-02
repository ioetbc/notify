import { describe, it, expect } from "bun:test";
import {
  computeSignature,
  verifySignature,
} from "../services/posthog-webhook/verify";

const SECRET = "shhh-this-is-a-secret";
const BODY = JSON.stringify({ event: "x", distinct_id: "u1" });

describe("posthog webhook signature verification", () => {
  it("accepts a valid signature", () => {
    const sig = computeSignature(SECRET, BODY);
    expect(verifySignature(SECRET, BODY, sig)).toBe(true);
  });

  it("rejects a one-byte-different signature", () => {
    const sig = computeSignature(SECRET, BODY);
    const flipped =
      (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifySignature(SECRET, BODY, flipped)).toBe(false);
  });

  it("rejects a signature of wrong length", () => {
    expect(verifySignature(SECRET, BODY, "abc")).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifySignature(SECRET, BODY, "")).toBe(false);
  });

  it("rejects when secret differs", () => {
    const sig = computeSignature(SECRET, BODY);
    expect(verifySignature("other-secret", BODY, sig)).toBe(false);
  });

  it("rejects when body is mutated", () => {
    const sig = computeSignature(SECRET, BODY);
    expect(verifySignature(SECRET, BODY + " ", sig)).toBe(false);
  });

  it("works with Uint8Array bodies", () => {
    const bytes = new TextEncoder().encode(BODY);
    const sig = computeSignature(SECRET, bytes);
    expect(verifySignature(SECRET, bytes, sig)).toBe(true);
  });
});
