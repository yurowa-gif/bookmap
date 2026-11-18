import zlib from "node:zlib";

type Paint = (x: number, y: number) => [number, number, number];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, sum]);
}

/** 테스트용 사진을 만든다. paint는 0~1 좌표를 받아 색을 돌려준다. */
export function makePng(width: number, height: number, paint: Paint): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x / width, y / height);
      const i = y * stride + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 채널당 8비트
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const scenes: Paint[] = [
  (x, y) => [40 + 180 * x, 90 + 120 * (1 - y), 200 - 120 * y],
  (x, y) => [220 - 100 * y, 150 + 60 * x, 60 + 60 * y],
  (x, y) => [90 + 60 * y, 140 + 80 * x, 110 + 100 * (1 - x)],
];
