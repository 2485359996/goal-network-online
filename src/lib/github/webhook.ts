import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(rawBody: string, signature: string | null, secret = process.env.GITHUB_WEBHOOK_SECRET) {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
