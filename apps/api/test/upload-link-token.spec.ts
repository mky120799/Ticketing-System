import { uploadLinkToken, uploadLinkUrl, verifyUploadLinkToken } from '../src/tickets/upload-link-token.js';

const ID = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b';
describe('secure upload link tokens', () => {
  beforeEach(() => { process.env.UPLOAD_LINK_SECRET = 'unit-test-secret-0123456789abcdef'; process.env.PORTAL_PUBLIC_URL = 'https://portal.bank.example/'; });
  it('accepts a genuine token and returns the link id', () => { expect(verifyUploadLinkToken(uploadLinkToken(ID))).toBe(ID); });
  it('rejects forged, edited, extended and missing tokens', () => {
    const [id, signature] = uploadLinkToken(ID).split('.');
    for (const bad of [undefined, '', 'x', `${id}.`, `${id}.${signature}x`, `${id}.${signature}.more`, `${id.replace(/.$/, '0')}.${signature}`, `not-a-uuid.${signature}`]) expect(verifyUploadLinkToken(bad)).toBeNull();
  });
  it('rejects every token when the secret changes or is missing', () => {
    const token = uploadLinkToken(ID);
    process.env.UPLOAD_LINK_SECRET = 'a-different-secret-0123456789abcdef'; expect(verifyUploadLinkToken(token)).toBeNull();
    delete process.env.UPLOAD_LINK_SECRET; expect(verifyUploadLinkToken(token)).toBeNull();
  });
  it('keeps the token after the # so it never reaches a web server log', () => {
    const url = uploadLinkUrl(ID); expect(url.startsWith('https://portal.bank.example/upload#')).toBe(true); expect(new URL(url).search).toBe('');
  });
});
