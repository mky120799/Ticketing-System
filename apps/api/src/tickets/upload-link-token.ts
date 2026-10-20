import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sign = (id: string): string => createHmac('sha256', process.env.UPLOAD_LINK_SECRET!).update(`upload-link:${id}`).digest('base64url');

/** Links need a server secret and the public address of the customer portal; without both the feature is off. */
export const uploadLinksConfigured = (): boolean => Boolean(process.env.UPLOAD_LINK_SECRET && process.env.PORTAL_PUBLIC_URL);

/** The token is the link's ID plus a signature only the server can make, so it cannot be guessed and need not be stored. */
export const uploadLinkToken = (linkId: string): string => `${linkId}.${sign(linkId)}`;

/** The token sits after `#`, which browsers never send to servers, so it stays out of web-server and proxy logs. */
export const uploadLinkUrl = (linkId: string): string => `${process.env.PORTAL_PUBLIC_URL!.replace(/\/$/, '')}/upload#${uploadLinkToken(linkId)}`;

/** Returns the link ID if the token is genuine, otherwise null. */
export function verifyUploadLinkToken(token: string | undefined): string | null {
  if (!token || !process.env.UPLOAD_LINK_SECRET) return null;
  const [id, signature, extra] = token.split('.');
  if (!id || !signature || extra !== undefined || !UUID.test(id)) return null;
  const expected = Buffer.from(sign(id)); const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}
