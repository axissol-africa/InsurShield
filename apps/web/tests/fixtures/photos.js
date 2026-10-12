import zlib from 'node:zlib';

/**
 * Photo fixtures for the journey suite, generated rather than committed.
 *
 * The quote form now grades every inspection photo, so the tests need an
 * image that a real vehicle photo resembles: large enough to read, sharp,
 * mid-exposed and neutral in colour. `tinyImage` is its opposite, and is
 * used to prove a bad photo is refused rather than sent to insurers.
 */

const WIDTH = 960;
const HEIGHT = 720;
/** Block size: coarse enough that JPEG compression and downscaling leave the edges intact. */
const BLOCK = 32;
const DARK = 45;
const LIGHT = 205;

/** A 1×1 PNG: decodes, but far too small to show a vehicle. */
const TINY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A grey checkerboard as a truecolour PNG — plenty of detail, no colour cast. */
const checkerboardPng = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = WIDTH * 3 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = y * stride; // raw[row] stays 0: the "no filter" marker
    for (let x = 0; x < WIDTH; x += 1) {
      const level = (Math.floor(x / BLOCK) + Math.floor(y / BLOCK)) % 2 ? LIGHT : DARK;
      raw.fill(level, row + 1 + x * 3, row + 4 + x * 3);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const VEHICLE = checkerboardPng();

/** A photo the automatic checks accept. */
export const vehiclePhoto = (name) => ({ name, mimeType: 'image/png', buffer: VEHICLE });

/** A 1×1 PNG: fine for documents that are not graded, and the refusal case for those that are. */
export const tinyImage = (name) => ({ name, mimeType: 'image/png', buffer: TINY });
