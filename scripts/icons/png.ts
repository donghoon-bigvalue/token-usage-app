import { readFile } from "node:fs/promises";

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
