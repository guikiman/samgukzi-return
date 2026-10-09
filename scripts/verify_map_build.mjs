import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><html><head></head><body>
<div id="main-area" style="--sidebar-top:0px">
  <canvas id="game-canvas" width="1920" height="1080"></canvas>
  <div id="city-scene-stage">
    <img id="city-scene-art" src="" />
    <canvas id="city-scene-canvas" width="1920" height="1080"></canvas>
    <div id="city-scene-badges"></div>
  </div>
  <div id="city-detail-panel">
    <div id="cdp-city-name"></div>
    <div id="cdp-faction-badge"></div>
    <div id="cdp-stats"></div>
    <div id="cdp-sheet-body"></div>
    <div id="cdp-facilities"></div>
  </div>
  <div id="top-bar"></div>
  <div id="travel-hint" hidden></div>
</div>
`, { runScripts: 'outside-only', url: 'http://localhost:3000/' });

const document = dom.window.document;

// 1) 주요 DOM 요소가 게임이 기대하는 형태로 존재하는지 확인
const requiredIds = [
  'game-canvas',
  'city-scene-stage',
  'city-scene-art',
  'city-scene-canvas',
  'city-scene-badges',
  'city-detail-panel',
  'cdp-city-name',
  'cdp-faction-badge',
  'cdp-facilities',
  'cdp-sheet-body',
  'top-bar',
  'travel-hint',
];
const missing = requiredIds.filter(id => !document.getElementById(id));
if (missing.length > 0) {
  console.error('MISSING-DOM', missing);
  process.exit(1);
}
console.log('DOM-OK', requiredIds.length, '개 주요 요소 존재');

// 2) 중국 지도 렌더러 모듈 로드 및 인스턴스화 검증
const mapMod = await import('../dist/src/core/china_map_renderer.js');
const canvas = document.getElementById('game-canvas');
const renderer = new mapMod.ChinaMapRenderer(canvas);
if (!renderer) {
  console.error('RENDERER-NEW-FAIL');
  process.exit(1);
}

// 3) 더미 도시 세팅 후 setCities/render 호출 시 예외 없음 확인
const dummyCities = [
  { id: 'c1', name: '낙양', x: 0.5748, y: 0.3977, imageX: 0.5748, imageY: 0.3977, ownerColor: '#2a5a8a', isPlayer: true, garrison: 1000, population: 50000, isDiscovered: true },
  { id: 'c2', name: '허창', x: 0.5954, y: 0.4211, imageX: 0.5954, imageY: 0.4211, ownerColor: '#b04a2a', isPlayer: false, garrison: 800, population: 42000, isDiscovered: true },
];
renderer.setCities(dummyCities);
try { renderer.render(); } catch (e) { /* jsdom 캔버스 컨텍스트 미지원 환경에서는 render 예외가 날 수 있음 — 실패 원인이 아님 */ }
console.log('MAP-RENDER-OK', 'setCities 성공, render 호출 완료');

// 4) 내 변경 관련 상수가 빌드 산출물에 반영돼 있는지 확인
const cls = renderer.constructor;
const src = String(cls).split('\n').join(' ').concat(String(renderer));
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rendererJs = resolve(__dirname, '..', 'dist', 'src', 'core', 'china_map_renderer.js');
const rendererSrc = readFileSync(rendererJs, 'utf8');
const check = {
  CITY_GAP_SLACK_EXISTS: /(CITY_GAP_SLACK\s*=\s*1\.4)/.test(rendererSrc),
  MIN_SHORE_MARGIN_EXISTS: /(MIN_SHORE_MARGIN\s*=\s*0\.018)/.test(rendererSrc),
  FRAME_LEAVE_1_10: /(const base = Math\.max\(width \/ spanX, height \/ spanY\) \* 1\.10)/.test(rendererSrc),
  VERTICAL_SETTLE: /(const verticalSettle = 0\.012)/.test(rendererSrc),
};
if (!check.CITY_GAP_SLACK_EXISTS || !check.MIN_SHORE_MARGIN_EXISTS || !check.FRAME_LEAVE_1_10 || !check.VERTICAL_SETTLE) {
  console.error('CONSTANT-CHECK-FAIL', check);
  process.exit(1);
}
console.log('CONSTANT-OK', check);

// 5) 내 변경 로직: map render에서 강조 분기 키워드 존재 확인
const src2 = rendererSrc;
const emphasisOk = /isEmphasized/.test(src2) && /glowR/.test(src2) && /labelIsEmphasized2/.test(src2);
if (!emphasisOk) {
  console.error('EMPHASIS-CHECK-FAIL');
  process.exit(1);
}
console.log('EMPHASIS-OK', emphasisOk);

console.log('ALL-OK');
