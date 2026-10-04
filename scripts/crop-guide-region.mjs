// 가이드 PNG 의 임의 영역을 확대해 크롭한다(라벨 판독용).
// 사용법: node scripts/crop-guide-region.mjs <png> <out.png> <x> <y> <w> <h> [zoom]
// find-guide-markers.mjs 와 PNG 디코딩을 공유한다 — 한 벌로 맞추지 않으면
// 크롭 색이 원본과 어긋나 판독을 속인다.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { pngToRaw } from './png_util.mjs';

const [file, out, sx0, sy0, sw0, sh0, zoomArg] = process.argv.slice(2);
if (!file || !out) {
    console.error('사용법: node scripts/crop-guide-region.mjs <png> <out.png> <x> <y> <w> <h> [zoom]');
    process.exit(1);
}
const { width, height, rgba } = pngToRaw(readFileSync(file));
const ox = Number(sx0);
const oy = Number(sy0);
const sw = Math.min(Number(sw0), width - ox);
const sh = Math.min(Number(sh0), height - oy);
const zoom = Math.max(1, Math.floor(Number(zoomArg) || 1));
const dw = sw * zoom;
const dh = sh * zoom;

function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(dw, 0);
ihdr.writeUInt32BE(dh, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const rows = Buffer.alloc((dw * 4 + 1) * dh);
let rp = 0;
for (let y = 0; y < dh; y++) {
    rows[rp++] = 0;
    const syy = oy + Math.floor(y / zoom);
    for (let x = 0; x < dw; x++) {
        const sxx = ox + Math.floor(x / zoom);
        const so = (Math.min(height - 1, syy) * width + Math.min(width - 1, sxx)) * 4;
        rows[rp++] = rgba[so];
        rows[rp++] = rgba[so + 1];
        rows[rp++] = rgba[so + 2];
        rows[rp++] = 255;
    }
}
writeFileSync(out, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${out} ${dw}x${dh} (원본 ${ox},${oy} ${sw}x${sh} zoom=${zoom} · 전체 ${width}x${height})`);