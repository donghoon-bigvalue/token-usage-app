import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

/**
 * PNG의 IHDR 청크에서 가로·세로를 읽는다. 렌더 결과가 의도한 크기인지 확인하는 데는
 * 이것으로 충분하므로 이미지 라이브러리를 들이지 않는다.
 */
export async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const buf = await readFile(path);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${path}: PNG 파일이 아닙니다.`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export type Rgba = { r: number; g: number; b: number; a: number };

/**
 * 지정한 좌표의 픽셀을 읽는다. 8비트 논인터레이스 RGB(A) PNG만 다룬다 — 우리가
 * 만들고 검사하는 아이콘이 전부 그 형식이고, 그 대가로 이미지 라이브러리를
 * 들이지 않는다. 형식이 다르면 조용히 틀린 값을 주는 대신 예외를 던진다.
 */
export async function pngPixel(path: string, x: number, y: number): Promise<Rgba> {
  const buf = await readFile(path);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${path}: PNG 파일이 아닙니다.`);
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  const interlace = buf.readUInt8(28);
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `${path}: 8비트 논인터레이스 RGB(A) PNG만 읽습니다 ` +
        `(depth=${depth}, colorType=${colorType}, interlace=${interlace}).`
    );
  }
  if (x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error(`${path}: (${x}, ${y})는 ${width}×${height} 밖입니다.`);
  }

  const parts: Buffer[] = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") parts.push(buf.subarray(off + 8, off + 8 + length));
    if (type === "IEND") break;
    off += 12 + length; // 길이(4) + 타입(4) + 데이터 + CRC(4)
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(parts));
  const out = Buffer.alloc(stride * (y + 1));

  // 각 줄은 앞줄과 왼쪽 픽셀을 참조하는 필터로 인코딩돼 있어, 원하는 줄까지
  // 순서대로 풀어야 한다 (PNG 명세 9.2).
  for (let row = 0; row <= y; row++) {
    const start = row * (stride + 1);
    const filter = raw[start];
    const cur = out.subarray(row * stride, (row + 1) * stride);
    const prev = row > 0 ? out.subarray((row - 1) * stride, row * stride) : null;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
      let value = raw[start + 1 + i];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const dl = Math.abs(p - left);
          const du = Math.abs(p - up);
          const dul = Math.abs(p - upLeft);
          value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
          break;
        }
        default:
          throw new Error(`${path}: 알 수 없는 필터 타입 ${filter} (${row}번째 줄).`);
      }
      cur[i] = value & 0xff;
    }
  }

  const at = y * stride + x * bpp;
  return { r: out[at], g: out[at + 1], b: out[at + 2], a: bpp === 4 ? out[at + 3] : 255 };
}
