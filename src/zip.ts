const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_DATE_1980_01_01 = 0x21;

export function zipStored(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([path, text]) => {
    const name = encoder.encode(path);
    const data = encoder.encode(text);
    return { name, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (value: number) => {
    view.setUint16(pos, value, true);
    pos += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(pos, value, true);
    pos += 4;
  };
  const raw = (bytes: Uint8Array) => {
    out.set(bytes, pos);
    pos += bytes.length;
  };
  const fileHeader = (e: (typeof entries)[number]) => {
    u16(20);
    u16(0);
    u16(0);
    u16(0);
    u16(DOS_DATE_1980_01_01);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0);
  };

  const offsets = entries.map((e) => {
    const offset = pos;
    u32(0x04034b50);
    fileHeader(e);
    raw(e.name);
    raw(e.data);
    return offset;
  });
  entries.forEach((e, i) => {
    u32(0x02014b50);
    u16(20);
    fileHeader(e);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(offsets[i]!);
    raw(e.name);
  });
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(localSize);
  u16(0);
  return out;
}
