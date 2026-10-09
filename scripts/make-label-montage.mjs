// 콜아웃 라벨(번호+이름) 14장을 한 장에 이어붙여 판독용으로 쓴다.
// 앵커를 중심으로 크롭하면 이름이 잘려서 "몇 번이 어떤 건물" 을 못 읽는다.
// 사용법: node scripts/make-label-montage.mjs <guide.png> <out.png> <calloutX,calloutY ...>
//   두 번째 값 쌍(콜아웃 원점)에서 우측 LW px, 하측 LH px 를 잘라낸다.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pngToRaw } from './png_util.mjs';

const [file, out, ...specs] = process.argv.slice(2);
if (!file || !out || specs.length === 0) {
    console.error('사용법: node scripts/make-label-montage.mjs <guide.png> <out.png> <cx,cy ...>');
    process.exit(1);
}
const { width, height, rgba } = pngToRaw(readFileSync(file));

// 라벨 상자 폭은 그림 폭의 약 15% (250px 남짓) 다. 번호 배지까지 왼쪽에 있다.
const LW = Number(process.env.LABEL_W || 250);
const LH = Number(process.env.LABEL_H || 56);
const COLS = Number(process.env.COLS || 2);
const ZOOM = Number(process.env.ZOOM || 3);
const PAD_L = Number(process.env.PAD_L || 8);
const PAD_T = Number(process.env.PAD_T || 10);
const GAP = 8;

const rows = Math.ceil(specs.length / COLS);
const dstW = (LW * COLS + GAP * (COLS - 1)) * ZOOM;
const dstH = (LH * rows + GAP * (rows - 1)) * ZOOM;
const out8 = new Uint8Array(dstW * dstH * 4);
for (let i = 0; i < dstW * dstH; i++) {
    out8[i * 4] = 0; out8[i * 4 + 1] = 0; out8[i * 4 + 2] = 0; out8[i * 4 + 3] = 255;
}

specs.forEach((spec, i) => {
    const [cx, cy] = spec.split(',').map(Number);
    const ox = Math.round(cx - PAD_L);
    const oy = Math.round(cy - PAD_T);
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const baseX = (col * (LW + GAP)) * ZOOM;
    const baseY = (row * (LH + GAP)) * ZOOM;
    for (let y = 0; y < LH * ZOOM; y++) {
        const sy = Math.max(0, Math.min(height - 1, oy + Math.floor(y / ZOOM)));
        for (let x = 0; x < LW * ZOOM; x++) {
            const sx = Math.max(0, Math.min(width - 1, ox + Math.floor(x / ZOOM)));
            const so = (sy * width + sx) * 4;
            const dx = (baseY + y) * dstW + (baseX + x);
            out8[dx * 4] = rgba[so];
            out8[dx * 4 + 1] = rgba[so + 1];
            out8[dx * 4 + 2] = rgba[so + 2];
            out8[dx * 4 + 3] = 255;
        }
    }
});

const rawRows = Buffer.alloc((dstW * 4 + 1) * dstH);
let rp = 0;
for (let y = 0; y < dstH; y++) {
    rawRows[rp++] = 0;
    for (let x = 0; x < dstW; x++) {
        const so = (y * dstW + x) * 4;
        rawRows[rp++] = out8[so];
        rawRows[rp++] = out8[so + 1];
        rawRows[rp++] = out8[so + 2];
        rawRows[rp++] = 255;
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
    chunk('IDAT', deflateSync(rawRows)),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${out} ${dstW}x${dstH} (${specs.length}칸, ${COLS}열, 창 ${LW}x${LH} zoom=${ZOOM}, 원본 ${width}x${height})`);
