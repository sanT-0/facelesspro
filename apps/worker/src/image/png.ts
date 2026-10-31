/**
 * Minimal deterministic RGB8 PNG encoder.
 *
 * Shared by the procedural renderer and the post-processor so corrected bytes
 * stay dependency-free: filter-none scanlines, one IDAT, Node's zlib. The same
 * raster always produces the same file, which the golden tests rely on.
 */

import { deflateSync } from 'node:zlib';

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** RGB24: `width * height * 3` bytes. */
  readonly pixels: Uint8Array;
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_unused, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.from(data);
  const chunk = Buffer.allocUnsafe(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  typeBytes.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);
  return chunk;
}

/** Encode one RGB24 raster as an 8-bit PNG. */
export function encodeRgbPng(raster: Raster): Uint8Array {
  const rowBytes = raster.width * 3;
  if (raster.pixels.length !== rowBytes * raster.height) {
    throw new RangeError(
      `RGB buffer has ${raster.pixels.length} bytes, expected ${rowBytes * raster.height}`,
    );
  }

  const scanlines = Buffer.allocUnsafe((rowBytes + 1) * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    const target = y * (rowBytes + 1);
    scanlines[target] = 0;
    scanlines.set(raster.pixels.subarray(y * rowBytes, (y + 1) * rowBytes), target + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(raster.width, 0);
  header.writeUInt32BE(raster.height, 4);
  header.set([8, 2, 0, 0, 0], 8); // RGB8, deflate, filter, no interlace

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}
