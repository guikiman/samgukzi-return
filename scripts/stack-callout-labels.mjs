// 14개 콜아웃 박스(번호+라벨)만 잘라 세로로 이어붙인 판독용 이미지를 만든다.
// 앵커 목록은 Y순 정렬이라 가이드의 실제 번호와 순서가 다르다. 번호는 이미지에 써있다.
// 사용법: node scripts/stack-callout-labels.mjs <guide.png> <out.png> <minX,minY> [<minX,minY> ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pngToRaw } from './png_util.mjs';

const [file, out, ...origins] = process.argv.slice(2);
if (!file || !out || origins.length === 0) {
    console.error('사용법: node scripts/stack-callout-labels.mjs <guide.png> <out.png> <minX,minY> [...]');
    process.exit(1);
}
const { width, height, rgba } = pngToRaw(readFileSync(file));

const ZOOM = Number(process.env.STACK_ZOOM || 3);
const BOX_W = Number(process.env.STACK_BOX_W || 175); // 콜아웃 박스 폭 (원본 px)
const BOX_H = Number(process.env.STACK_BOX_H || 38);  // 콜아웃 박스 높이
/** 검출된 박스 원점은 라벨 시작점보다 오른쪽이라 왼쪽으로 여유를 준다. */
const PAD_LEFT = Number(process.env.STACK_PAD_LEFT || 0);
const GAP = 4;

const dstW = BOX_W * ZOOM;
const dstH = (BOX_H + GAP) * origins.length * ZOOM;
const out8 = new Uint8Array(dstW * dstH * 4);
for (let i = 0; i < dstW * dstH; i++) {
    out8[i * 4] = 0; out8[i * 4 + 1] = 0; out8[i * 4 + 2] = 0; out8[i * 4 + 3] = 255;
}

origins.forEach((spec, row) => {
    const [oxArg, oyArg] = spec.split(',').map(Number);
    const srcTop = Math.max(0, Math.min(height - BOX_H, Math.round(oyArg)));
    const srcLeft = Math.max(0, Math.min(width - BOX_W, Math.round(oxArg) - PAD_LEFT));
    for (let y = 0; y < BOX_H * ZOOM; y++) {
        const sy = srcTop + Math.floor(y / ZOOM);
        for (let x = 0; x < dstW; x++) {
            const sx = srcLeft + Math.floor(x / ZOOM);
            const so = (sy * width + sx) * 4;
            const dx = (row * BOX_H * ZOOM + y) * dstW + x;
            out8[dx * 4] = rgba[so];
            out8[dx * 4 + 1] = rgba[so + 1];
            out8[dx * 4 + 2] = rgba[so + 2];
            out8[dx * 4 + 3] = 255;
        }
    }
});

const rows = Buffer.alloc((dstW * 4 + 1) * dstH);
let rp = 0;
for (let y = 0; y < dstH; y++) {
    rows[rp++] = 0;
    for (let x = 0; x < dstW; x++) {
        const so = (y * dstW + x) * 4;
        rows[rp++] = out8[so]; rows[rp++] = out8[so + 1]; rows[rp++] = out8[so + 2]; rows[rp++] = 255;
    }
}

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
ihdr.writeUInt32BE(dstW, 0);
ihdr.writeUInt32BE(dstH, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(out, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${out} ${dstW}x${dstH} (${origins.length}행, zoom=${ZOOM}, 원본 ${width}x${height})`);
