import { createHash } from 'node:crypto';
import { connect } from 'node:net';

export type ScanVerdict = 'clean' | 'malicious' | 'error';

/**
 * Minimal clamd client using the INSTREAM protocol: the file is streamed over TCP in length-prefixed chunks, so it is
 * never written to local disk. Also returns the SHA-256 of what was scanned so the caller can compare it with the
 * checksum the uploader declared.
 */
export async function scanWithClamd(host: string, port: number, content: AsyncIterable<Uint8Array>, timeoutMs = 60_000): Promise<{ verdict: ScanVerdict; detail: string; sha256: string }> {
  const hash = createHash('sha256');
  const socket = connect({ host, port });
  socket.setTimeout(timeoutMs);
  const response = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on('data', (data) => chunks.push(data));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()));
    socket.on('timeout', () => { socket.destroy(); reject(new Error('clamd timed out')); });
    socket.on('error', reject);
  });
  const write = (data: Uint8Array) => new Promise<void>((resolve, reject) => socket.write(data, (error) => (error ? reject(error) : resolve())));
  try {
    await write(Buffer.from('zINSTREAM\0'));
    for await (const chunk of content) {
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length; offset += 65_536) {
        const part = chunk.subarray(offset, Math.min(offset + 65_536, chunk.length));
        const length = Buffer.alloc(4); length.writeUInt32BE(part.length);
        await write(Buffer.concat([length, part]));
      }
    }
    await write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    const text = await response;
    socket.end();
    const sha256 = hash.digest('hex');
    if (text.endsWith('OK')) return { verdict: 'clean', detail: 'OK', sha256 };
    if (text.endsWith('FOUND')) return { verdict: 'malicious', detail: text.replace(/^stream:\s*/, ''), sha256 };
    return { verdict: 'error', detail: text || 'empty response', sha256 };
  } finally { socket.destroy(); }
}
