import { Socket } from 'node:net';
import { isPrivateScannerAddress } from './clamd-address.js';
import type { MalwareScanner, ScanVerdict } from './scanner.port.js';

export interface ClamdSettings {
  address: string;
  port: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxInputBytes: number;
}

const CHUNK_BYTES = 64 * 1024;
const unavailable = (reason: string): ScanVerdict => ({ result: 'unavailable', reason });

/** One INSTREAM command per connection: https://docs.clamav.net/manual/Usage/ClamdProtocol.html */
export class ClamdScanner implements MalwareScanner {
  readonly name = 'clamd';
  private readonly settings: Readonly<ClamdSettings>;

  constructor(settings: ClamdSettings) {
    if (!isPrivateScannerAddress(settings.address)) throw new Error('CLAMD_ADDRESS must be a private or loopback IP literal.');
    for (const [key, value, min, max] of [
      ['CLAMD_PORT', settings.port, 1, 65535],
      ['CLAMD_TIMEOUT_MS', settings.timeoutMs, 100, 60000],
      ['CLAMD_MAX_RESPONSE_BYTES', settings.maxResponseBytes, 256, 16384],
      ['MAX_UPLOAD_BYTES', settings.maxInputBytes, 1, Number.MAX_SAFE_INTEGER],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} is outside its supported bounds.`);
    }
    this.settings = { ...settings };
  }

  scan(bytes: Buffer): Promise<ScanVerdict> {
    if (bytes.length > this.settings.maxInputBytes) return Promise.resolve(unavailable('CLAMD_INPUT_TOO_LARGE'));
    return new Promise((resolve) => {
      const socket = new Socket();
      const response = Buffer.alloc(this.settings.maxResponseBytes);
      let received = 0;
      let settled = false;
      let sent = false;
      const frames = streamFrames(bytes);
      const finish = (verdict: ScanVerdict) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        resolve(verdict);
      };
      // A total deadline, not an idle timeout: a peer cannot extend it by trickling bytes.
      const deadline = setTimeout(() => finish(unavailable('CLAMD_TIMEOUT')), this.settings.timeoutMs);
      const sendNext = () => {
        if (settled) return;
        const next = frames.next();
        if (next.done) {
          sent = true;
          return;
        }
        // The callback waits for this write to flush, bounding queued output to one frame.
        socket.write(next.value, (error) => {
          if (error) finish(unavailable('CLAMD_CONNECTION_FAILED'));
          else sendNext();
        });
      };
      socket.on('error', () => finish(unavailable('CLAMD_CONNECTION_FAILED')));
      socket.on('close', () => finish(unavailable('CLAMD_CONNECTION_CLOSED')));
      socket.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (!sent) {
          finish(unavailable('CLAMD_INCOMPLETE_REQUEST'));
          return;
        }
        if (chunk.length > response.length - received) {
          finish(unavailable('CLAMD_RESPONSE_TOO_LARGE'));
          return;
        }
        chunk.copy(response, received);
        received += chunk.length;
      });
      socket.on('end', () => {
        if (!sent) {
          finish(unavailable('CLAMD_INCOMPLETE_REQUEST'));
          return;
        }
        // Wait for EOF to reject duplicate/trailing records, including ones in later packets.
        const reply = response.subarray(0, received).toString('utf8');
        if (reply === 'stream: OK\0') finish({ result: 'clean' });
        else if (/^stream: [\x20-\x7e]+ FOUND\0$/.test(reply)) {
          // The caller audits signatures. Never pass untrusted provider text into that audit.
          finish({ result: 'infected', signature: 'ClamAV-detection' });
        } else finish(unavailable('CLAMD_INVALID_RESPONSE'));
      });
      try {
        socket.connect({ host: this.settings.address, port: this.settings.port }, sendNext);
      } catch {
        finish(unavailable('CLAMD_CONNECTION_FAILED'));
      }
    });
  }
}

function* streamFrames(bytes: Buffer): Generator<Buffer> {
  yield Buffer.from('zINSTREAM\0');
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(chunk.length);
    yield length;
    yield chunk;
  }
  yield Buffer.alloc(4);
}
