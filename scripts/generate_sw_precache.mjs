/**
 * 빌드 후 산출물 — dist 파일 목록 매니페스트 생성 + 정적 에셋 복사
 *
 * sw.js의 설치 단계가 이 목록을 읽어 /dist/ 전체를 프리캐시한다.
 * (번들리스 ESM 구조 특성상 main.js가 수백 개 모듈을 import하므로,
 *  오프라인 플레이를 위해서는 dist 전체가 캐시되어야 한다)
 *
 * 브라우저가 실제로 요청하는 .js/.json만 포함한다 (.d.ts/.map 제외).
 *
 * assets/ 는 렌더러가 런타임에 직접 요청한다 (지도 비트맵, 종이 텍스처).
 * tsc 는 자산을 복사하지 않으므로 여기서 dist/assets 로 옮긴다.
 * index.html 은 dist/src/main.js 를 불러오므로 서비스되는 트리는 dist 다.
 * 이 복사가 없으면 지도와 텍스처는 404 가 되어 스케치 지도로 폴백한다.
 */
import { readdirSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ASSETS = join(ROOT, 'assets');

/** dist를 재귀 순회하며 브라우저 관련 산물만 수집 */
function walk(dir, acc = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, acc);
        } else if (/\.(js|json)$/.test(entry.name)) {
            acc.push(relative(ROOT, full).split(sep).join('/'));
        }
    }
    return acc;
}

if (existsSync(ASSETS)) {
    cpSync(ASSETS, join(DIST, 'assets'), { recursive: true });
    console.log('[assets] assets/ → dist/assets 복사 완료');
}

const files = walk(DIST);
const outPath = join(ROOT, 'sw-precache.json');
writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), files }, null, 2));
console.log(`[sw-precache] ${files.length}개 파일 목록을 sw-precache.json에 기록했습니다.`);
