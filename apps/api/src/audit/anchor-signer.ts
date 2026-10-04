import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/**
 * Signs and verifies audit anchors with Ed25519. Keys come from the environment (PEM text, `\n` allowed) so a bank
 * can inject them from its vault; to use a managed key (KMS/HSM) replace this module with one that calls the key service.
 * Without a private key anchors are published unsigned; without a public key signatures are not checked.
 */
const pem = (value: string | undefined) => (value ? value.replace(/\\n/g, '\n') : undefined);
export const anchorMessage = (sequence: number, headHash: string, signedAt: string): Buffer => Buffer.from(`audit-anchor:v1:${sequence}:${headHash}:${signedAt}`);

export function signAnchor(sequence: number, headHash: string, signedAt: string): string | null {
  const key = pem(process.env.AUDIT_ANCHOR_SIGNING_PRIVATE_KEY);
  return key ? sign(null, anchorMessage(sequence, headHash, signedAt), createPrivateKey(key)).toString('base64') : null;
}

/** Returns true/false when a public key is configured, or null when signatures are not being checked. */
export function verifyAnchorSignature(sequence: number, headHash: string, signedAt: string | null, signature: string | null): boolean | null {
  const key = pem(process.env.AUDIT_ANCHOR_PUBLIC_KEY);
  if (!key) return null;
  if (!signature || !signedAt) return false;
  try { return verify(null, anchorMessage(sequence, headHash, signedAt), createPublicKey(key), Buffer.from(signature, 'base64')); } catch { return false; }
}
