// 참고 가이드 PNG(빨간 콜아웃 포함)를 디스크에서 찾는다.
// PNG 헤더(IHDR)만 읽으므로 수백 MB 를 훑어도 빠르다.
// 사용법: node scripts/scan-guide-png.mjs [루트...]
import { openSync, readSync, readdirSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ['D:\\', 'C:\\Users\\YG_PC'];
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SKIP = /node_modules|[/\\]\.git[/\\]|AppData\\Local\\Packages|WindowsApps|\$Recycle\.Bin|WinSxS|system32[/\\]/i;
const MIN_W = 1500;
const MAX_W = 1800;
const MIN_H = 850;
const MAX_H = 1050;

const out = [];
let scanned = 0;

function probe(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
        const head = Buffer.alloc(32);
        if (readSync(fd, head, 0, 32, 0) < 32) return;
        if (!head.subarray(0, 4).equals(SIG)) return;
        const w = head.readUInt32BE(16);
        const h = head.readUInt32BE(20);
        const depth = head[24];
        const colorType = head[25];
        if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) return;
        out.push({ path, w, h, depth, colorType });
    } catch {
        /* 잠금/권한 오류는 무시 */
    } finally {
        if (fd !== undefined) {
            try { closeSync(fd); } catch { /* noop */ }
        }
    }
}

function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP.test(p)) continue;
            walk(p, depth + 1);
        } else if (/\.png$/i.test(e.name)) {
            scanned++;
            probe(p);
        }
    }
}

for (const r of ROOTS) {
    try {
        statSync(r);
    } catch {
        console.error(`루트 없음: ${r}`);
        continue;
    }
    walk(r, 0);
}

console.log(`PNG ${scanned}개 스캔 · 후보 ${out.length}개`);
for (const c of out) {
    console.log(`${c.w}x${c.h} depth=${c.depth} colorType=${c.colorType}  ${c.path}`);
}