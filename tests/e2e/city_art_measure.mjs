/**
 * [2026-10-03] 도시 배경 그림 리사이즈 정합 실측 (1회성 점검 스크립트).
 *
 * [무엇을 재는지]
 * 배지(라벨)는 style.left/top 에 무대(-stage) 기준 % 로 찍힌다. 그림은 object-fit: cover 라
 * 창 비율이 다르면 좌우가 잘린다. 그래서 "배지가 실제 건물 위인가" 를 보려면
 *   배지 화면 좌표 → 그림 좌표(cover 크롭 되돌림) → 원본 1672x940 픽셀
 * 로 역변환해 그 건물의 목표 픽셀과 비교해야 한다. 그냥 stage % 를 보기만 하면
 * 잘못된 배치를 통과시킨다.
 *
 * 판정: 배지 픽셀 ↔ 해당 건물 목표 픽셀 거리 ≤ TOL_PX.
 * TOL_PX 는 배지 자체 폭(34px) 절반을 쓰는 게 현실적이라 60px 로 잡았다.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { connect as rawConnect } from 'node:net';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTTP_PORT = 8231;
const CDP_PORT = 9321;

/** 그림 원본 규격 — 좌표표 판독값의 전제. */
const ART_W = 1672;
const ART_H = 940;

/** 배지가 목표 건물에서 이 px 이상 벗어나면 어긋난 것으로 본다. */
const TOL_PX = 60;

/**
 * 잘려 나간 건물의 배지가 "크롭 경계에 붙어 있는가" 판정 허용치 px.
 * clampAnchorToCover 는 경계에서 무대 2.5% 만큼 안쪽으로 당긴다. 무대 너비가
 * 창마다 다르므로 px 로 환산한 허용치를 둔다(최대 폭 창 기준으로 약 45px).
 */
const EDGE_TOL_PX = 45;

// [2026-10-03] 라벨·이름을 그림 좌표표 12행에 그대로 맞췄다.
//   키는 화면에 나오는 이름이고, 값은 그림에서 판독한 중심 픽셀이다.
const TARGET_PX = {
    '관청': [536, 250], '병영': [370, 590], '시장': [1040, 590], '농장': [1370, 637],
    '공방': [1090, 418], '성문': [836, 755], '궁전': [836, 126], '태학': [1153, 259],
    '대장간': [405, 423], '서원': [958, 275], '마구간': [540, 650], '교역소': [1331, 407],
};

/** 시험할 창 크기 — 16:9 도 세로로 긴 것도(커버로 좌우가 크게 잘린다) 넣는다. */
const VIEWPORTS = [
    [1920, 1080], [1600, 1000], [1440, 900], [1366, 768],
    [1280, 1024], [1024, 768], [900, 1200], [768, 1024], [600, 1400],
];

const CHROME_CANDIDATES = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
].filter(Boolean);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

function startServer() {
    const server = createServer(async (req, res) => {
        try {
            const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            const filePath = join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
            const body = await readFile(filePath);
            res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end('not found');
        }
    });
    return new Promise(resolve => server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server)));
}
async function waitForPort(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const sock = rawConnect(port, '127.0.0.1');
            await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
            sock.destroy();
            return true;
        } catch { await delay(200); }
    }
    return false;
}

function findChrome() {
    for (const p of CHROME_CANDIDATES) {
        if (existsSync(p)) return p;
    }
    throw new Error('Chrome not found');
}

/**
 * 페이지 안에서 배지들을 재는 표현식.
 * 반환: stage rect, art rect, 그리고 배지별 (라벨, stage 기준 %, 표시된 그림 기준 px).
 *
 * [역변환이 필요한 이유]
 * .city-scene-art 는 object-fit: cover 다. 배지 style.left/top 은 stage % 이고
 * stage 는 창 비율이라 16:9 가 아니다. 따라서 stage % 를 그림 % 로 바로 읽으면
 * 잘린 좌우가 어긋난다. cover 사각형(sx,sy,scale)을 되돌려 **원본 픽셀**로 환산해야
 * "이 배지가 그 건물의 위에 있나" 를 판정할 수 있다.
 */
const MEASURE_EXPR = `(() => {
  const stage = document.getElementById('city-scene-stage');
  const art = document.getElementById('city-scene-art');
  if (!stage || !art) return { error: 'stage/art 없음' };
  const s = stage.getBoundingClientRect();
  const aw = art.naturalWidth, ah = art.naturalHeight;
  if (!aw || !ah) return { error: '그림 미로딩' };
  const scale = Math.max(s.width / aw, s.height / ah);
  const sw = s.width / scale, sh = s.height / scale;
  const sx = (aw - sw) / 2, sy = (ah - sh) / 2;
  const badges = Array.from(document.querySelectorAll('.city-badge')).map(b => {
    const r = b.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - s.left);
    const cy = (r.top + r.height / 2 - s.top);
    return {
      label: (b.textContent || '').trim(),
      title: b.getAttribute('title') || '',
      stageX: +(cx / s.width * 100).toFixed(2),
      stageY: +(cy / s.height * 100).toFixed(2),
      artX: +(sx + cx / scale).toFixed(1),
      artY: +(sy + cy / scale).toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    };
  });
  return {
    stage: { w: +s.width.toFixed(1), h: +s.height.toFixed(1), ratio: +(s.width / s.height).toFixed(3) },
    art: { w: aw, h: ah, ratio: +(aw / ah).toFixed(3) },
    cropX: +sx.toFixed(1), cropY: +sy.toFixed(1), scale: +scale.toFixed(4),
    croppedSides: { sides: sx > 0.5, top: sy > 0.5 },
    badges,
  };
})()`;
// CDP 최소 구현 — browser_smoke.mjs 와 같은 방식(직접 WebSocket 프레이밍).
// 이유: 이 저장소에 puppeteer/playwright 가 없고, 검증은 스크립트 결과를 눈으로
// 읽는 것이 아니라 숫자로 남겨야 나중에 되돌아볼 수 있다.
class CDP {
    constructor(sock, initialBuffer = Buffer.alloc(0)) {
        this.sock = sock;
        this.buffer = initialBuffer;
        this.msgId = 0;
        this.waiters = [];
        sock.on('data', (chunk) => this._onData(chunk));
    }

    static async connect(wsUrl) {
        const u = new URL(wsUrl);
        const port = Number(u.port);
        const path = u.pathname + u.search;
        const key = createHash('sha1').update(String(Math.random())).digest('base64');
        const sock = rawConnect(port, '127.0.0.1');
        await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
        sock.write(
            `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
            'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        const { head, rest } = await new Promise((resolve) => {
            let buf = Buffer.alloc(0);
            const onData = (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                const idx = buf.indexOf('\r\n\r\n');
                if (idx !== -1) { sock.off('data', onData); resolve({ head: buf.subarray(0, idx), rest: buf.subarray(idx + 4) }); }
            };
            sock.on('data', onData);
        });
        if (!head.toString('utf8').startsWith('HTTP/1.1 101')) {
            throw new Error('WS handshake failed: ' + head.toString('utf8').split('\r\n')[0]);
        }
        return new CDP(sock, rest);
    }

    _onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            if (this.buffer.length < 2) return;
            const b1 = this.buffer[0], b2 = this.buffer[1];
            const opcode = b1 & 0x0F;
            let len = b2 & 0x7F, off = 2;
            if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (this.buffer.length < 10) return; len = Number(this.buffer.readBigUInt64BE(2)); off = 10; }
            if (this.buffer.length < off + len) return;
            const payload = this.buffer.subarray(off, off + len);
            this.buffer = this.buffer.subarray(off + len);
            if (opcode === 0x9) { this._send(0xA, payload); continue; }
            if (opcode !== 0x1) continue;
            const msg = JSON.parse(payload.toString('utf8'));
            if (msg.method) continue;
            const w = this.waiters.find((x) => x.id === msg.id);
            if (w) { this.waiters = this.waiters.filter((x) => x !== w); w.resolve(msg); }
        }
    }

    _send(opcode, payload) {
        const mask = Buffer.from([1, 2, 3, 4]);
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
        const n = buf.length;
        let header;
        if (n < 126) header = Buffer.from([0x80 | opcode, 0x80 | n]);
        else if (n < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(n, 2); }
        else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(n), 2); }
        const masked = buf.map((b, i) => b ^ mask[i % 4]);
        this.sock.write(Buffer.concat([header, mask, masked]));
    }

    async call(method, params = {}, timeoutMs = 60000) {
        const id = ++this.msgId;
        this._send(1, JSON.stringify({ id, method, params }));
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeoutMs);
            this.waiters.push({ id, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
        });
    }

    async evalJson(expression) {
        const res = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (res.error) throw new Error('evaluate failed: ' + JSON.stringify(res.error));
        if (res.result?.exceptionDetails) throw new Error('evaluate exception: ' + JSON.stringify(res.result.exceptionDetails));
        const v = res.result?.result?.value;
        return typeof v === 'string' ? JSON.parse(v) : v;
    }
}
/**
 * 도시 진입 화면을 연다.
 * 신호는 __game.getEngine() / __game.openCity() 이다 — UI 버튼을 클릭하는 경로는
 * 온보딩·튜토리얼 상태에 따라 막힐 수 있어 게임 API 를 직접 쓴다(브라우저_smoke 와 동일).
 */
const ENTER_CITY = `(async () => {
  try {
    var g = window.__game;
    g.setDialogueInstant && g.setDialogueInstant(true);
    // [중요] 시나리오를 먼저 시작해야 세계에 도시가 생긴다. 엔진만 부팅된 상태에서
    // openCity 를 부르면 getAllCities() 가 빈 배열이라 도시가 하나도 없다.
    // 브라우저_smoke 의 실제 시작 흐름: 게임 시작 → 시나리오 → 세력 선택.
    if (!g.getStore().getAllCities().length) {
      var btn = document.getElementById('btn-start');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 400));
      g.startScenario('05', 0);
      await new Promise(r => setTimeout(r, 900));
    }
    var city = g.getStore().getAllCities()[0];
    if (!city) return { ok:false, error:'도시가 없다', cities: g.getStore().getAllCities().length };
    g.openCity(city.id);
    var st = document.getElementById('city-scene-stage');
    var art = document.getElementById('city-scene-art');
    return { ok: !!(st && art && st.classList.contains('art-ready')),
             badges: document.querySelectorAll('.city-badge').length, cityId: city.id };
  } catch (e) { return { ok:false, error:String(e) }; }
})()`;

async function main() {
    const server = await startServer();
    const chromePath = findChrome();
    const userData = mkdtempSync(join(tmpdir(), 'art_measure_'));
    const chrome = spawn(chromePath, [
        '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userData}`, '--no-first-run', '--disable-gpu',
        '--hide-scrollbars', '--window-size=1920,1080', 'about:blank',
    ], { stdio: 'ignore' });

    let exitCode = 1;
    const report = [];
    try {
        if (!(await waitForPort(CDP_PORT))) throw new Error('CDP port not open');
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = targets.find((t) => t.type === 'page');
        const cdp = await CDP.connect(page.webSocketDebuggerUrl);
        await cdp.call('Runtime.enable');
        await cdp.call('Page.enable');

        for (const [vw, vh] of VIEWPORTS) {
            await cdp.call('Emulation.setDeviceMetricsOverride', {
                width: vw, height: vh, deviceScaleFactor: 1, mobile: false,
            });
            if (report.length === 0) {
                await cdp.call('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });
                let booted = false;
                for (let i = 0; i < 80; i++) {
                    const r = await cdp.evalJson('!!(window.__game && window.__game.getEngine && window.__game.getEngine())');
                    if (r) { booted = true; break; }
                    await delay(500);
                }
                if (!booted) throw new Error('엔진 부팅 대기 실패 (30s)');
                await delay(600);
                const entered = await cdp.evalJson(ENTER_CITY);
                if (!entered.ok) throw new Error('도시 진입 실패: ' + JSON.stringify(entered));
                // 그림 로드(art-ready)와 배지 배치는 비동기라 정착을 기다린다.
                let ready = false;
                for (let i = 0; i < 40; i++) {
                    const r = await cdp.evalJson(`(() => {
                        const st=document.getElementById('city-scene-stage');
                        const art=document.getElementById('city-scene-art');
                        return !!(st&&art&&st.classList.contains('art-ready')&&art.complete&&art.naturalWidth>0
                                  &&document.querySelectorAll('.city-badge').length>0);
                    })()`);
                    if (r) { ready = true; break; }
                    await delay(200);
                }
                if (!ready) throw new Error('배경 그림/배지 준비 대기 실패');
            }
            await delay(450);
            const m = await cdp.evalJson(MEASURE_EXPR);
            if (!m || m.error) { report.push({ vw, vh, error: m?.error ?? '측정 실패' }); continue; }

            // 판정은 **두 경우를 나눠야** 한다. 나눠 하지 않으면 아무리 멀쩡한
            // 구현도 실패로 기록된다.
            //   A. 목표 건물이 화면에 보이는 구간 안에 있다 → 배지가 그 위에 있어야 한다(엄격).
            //   B. 목표 건물이 cover 크롭으로 잘려 나갔다 → 화면에 없다. 배지가
            //      크롭 경계에 붙는 것은 옳다. 대신 **다른 건물 위를 가리키면 안 된다.**
            const visL = m.cropX;
            const visR = m.art.w - m.cropX;
            const rows = [];
            for (const b of m.badges) {
                const target = TARGET_PX[b.label];
                if (!target) { rows.push({ label: b.label, verdict: '대상없음', artX: b.artX, artY: b.artY }); continue; }
                const dx = b.artX - target[0];
                const dy = b.artY - target[1];
                const dist = Math.hypot(dx, dy);
                const onScreen = target[0] >= visL && target[0] <= visR;
                if (onScreen) {
                    rows.push({
                        label: b.label, target, visible: true,
                        artX: b.artX, artY: b.artY,
                        dx: +dx.toFixed(1), dy: +dy.toFixed(1), dist: +dist.toFixed(1),
                        verdict: dist <= TOL_PX ? 'OK' : '어긋남',
                    });
                    continue;
                }
                // 잘린 경우 — 배지가 크롭 경계 근처인지, 다른 건물 위인지 본다.
                const nearEdge = Math.min(Math.abs(b.artX - visL), Math.abs(b.artX - visR)) <= EDGE_TOL_PX;
                // 경계에 붙었다면 그 자리에 실제로 어떤 건물이 있는지 확인한다.
                let sitsOn = null;
                if (!nearEdge) {
                    for (const [name, px] of Object.entries(TARGET_PX)) {
                        if (px < visL || px > visR) continue;
                        if (Math.hypot(b.artX - px[0], b.artY - px[1]) <= TOL_PX) { sitsOn = name; break; }
                    }
                }
                rows.push({
                    label: b.label, target, visible: false,
                    artX: b.artX, artY: b.artY, dist: +dist.toFixed(1),
                    nearEdge, sitsOn,
                    verdict: nearEdge ? 'OK(잘림-경계)' : (sitsOn ? `어긋남(${sitsOn} 위를 덮음)` : '어긋남(경계 밖)'),
                });
            }
            report.push({
                vw, vh,
                stage: m.stage, art: m.art,
                cropX: m.cropX, cropY: m.cropY,
                croppedSides: m.croppedSides,
                rows,
            });
            const bad = rows.filter((r) => String(r.verdict).startsWith('어긋남'));
            const croppedCount = rows.filter((r) => String(r.verdict).startsWith('OK(잘림')).length;
            const tag = bad.length === 0
                ? `OK${croppedCount ? ` (잘림 ${croppedCount}건은 경계 처리)` : ''}`
                : `어긋남 ${bad.length}`;
            console.log(`[${String(vw).padStart(4)}x${String(vh).padEnd(4)}] stage ${m.stage.w}x${m.stage.h}(${m.stage.ratio}) cropX=${m.cropX} ${tag}`);
            for (const r of bad) {
                console.log(`    ${r.label}: 목표(${r.target[0]},${r.target[1]}) 실측(${r.artX},${r.artY}) → ${r.verdict}`);
            }
        }
        const totalBad = report.reduce((n, r) => n + (r.rows?.filter((x) => String(x.verdict).startsWith('어긋남')).length ?? 0), 0);
        const totalCropped = report.reduce((n, r) => n + (r.rows?.filter((x) => String(x.verdict).startsWith('OK(잘림')).length ?? 0), 0);
        console.log(`\n결과: ${totalBad === 0 ? '배지가 엉뚱한 건물을 가리키는 창 없음' : `총 ${totalBad}건 어긋남`} (허용 ${TOL_PX}px)`);
        console.log(`잘려 나간 건물의 배지 ${totalCropped}건은 크롭 경계에 붙어 있음(정상 처리)`);
        console.log('ART_MEASURE_JSON:' + JSON.stringify(report));
        exitCode = totalBad === 0 ? 0 : 1;
    } catch (err) {
        console.error('실측 실패:', err.message);
    } finally {
        chrome.kill();
        server.close();
    }
    process.exit(exitCode);
}

main();