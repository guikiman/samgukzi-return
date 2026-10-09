/**
 * 브라우저 E2E 스모크 테스트 (headless Chrome + CDP)
 * 파일: tests/e2e/browser_smoke.mjs
 *
 * 검증 흐름 [E2E]:
 *   1. 프로젝트 루트를 http 서빙
 *   2. headless Chrome CDP 구동 → /index.html 로드
 *   3. window.__game.startScenario('05', 0)으로 시나리오 시작
 *   4. #btn-next-month로 24개월 자율 진행 (방문 모달 자동 사절)
 *   5. 통일 조건 강제 → 1턴 진행 → 엔딩 화면 + 내러티브 기록 확인
 *   6. 콘솔 에러/페이지 예외/404 수집 (favicon 404는 benign으로 제외)
 *
 * 실행: npm run test:e2e  (사전에 npm run build 필요)
 * 요구사항: Windows — Chrome 설치 경로 자동 탐색
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTTP_PORT = 8137;
const CDP_PORT = 9223;

const CHROME_CANDIDATES = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
].filter(Boolean);

// ------------------------------------------------------------ static server

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

function startServer() {
    const server = createServer(async (req, res) => {
        try {
            const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            let filePath = join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
            const body = await readFile(filePath);
            res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end('not found');
        }
    });
    return new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------ CDP over WebSocket (manual framing)

import { connect as rawConnect } from 'node:net';
import { createHash } from 'node:crypto';

class CDP {
    constructor(sock, initialBuffer = Buffer.alloc(0)) {
        this.sock = sock;
        this.buffer = initialBuffer;
        this.msgId = 0;
        this.events = [];
        this.waiters = [];
        sock.on('data', (chunk) => this._onData(chunk));
    }

    static async connect(wsUrl) {
        const u = new URL(wsUrl);
        const port = Number(u.port);
        // NOTE: URL 객체에는 .path가 없다 — .pathname을 써야 한다.
        const path = u.pathname + u.search;
        const key = createHash('sha1').update(String(Math.random())).digest('base64');
        const sock = rawConnect(port, '127.0.0.1');
        await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
        sock.write(
            `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
            'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        // 핸드셰이크 응답(101 + 헤더)을 \r\n\r\n까지 완전히 소진 — 미소진 바이트가
        // 이후 프레임 파서의 길이 계산을 어긋나게 만들어 CDP 타임아웃이 발생했다
        const { head, rest } = await new Promise((res) => {
            let buf = Buffer.alloc(0);
            const onData = (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                const idx = buf.indexOf('\r\n\r\n');
                if (idx !== -1) { sock.off('data', onData); res({ head: buf.subarray(0, idx), rest: buf.subarray(idx + 4) }); }
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
            if (opcode === 0x9) { this._send(0xA, payload); continue; } // ping→pong
            if (opcode !== 0x1) continue;
            const msg = JSON.parse(payload.toString('utf8'));
            if (msg.method) this.events.push(msg);
            else {
                const w = this.waiters.find((x) => x.id === msg.id);
                if (w) { this.waiters = this.waiters.filter((x) => x !== w); w.resolve(msg); }
            }
        }
    }

    _send(opcode, payload) {
        const mask = Buffer.from([1, 2, 3, 4]);
        // [결함 수정] UTF-8 멀티바이트(한국어 표현식) 프레임 길이를 바이트 기준으로 계산.
        // 기존에는 문자 수(payload.length)를 길이로 선언해 한국어 포함 요청이 잘려
        // 브라우저가 응답하지 않는 'CDP timeout: Runtime.evaluate'가 발생했다.
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

    async evaluate(expression, returnByValue = true) {
        // awaitPromise: 비동기 IIFE(async 함수)의 완료를 기다린다 [312 리플레이 프로브]
        const res = await this.call('Runtime.evaluate', { expression, returnByValue, awaitPromise: true });
        if (res.error) throw new Error(`evaluate failed: ${JSON.stringify(res.error)}`);
        if (res.result?.exceptionDetails) throw new Error(`evaluate exception: ${JSON.stringify(res.result.exceptionDetails)}`);
        return res.result?.result ?? {};
    }

    async evalJson(expression) {
        const r = await this.evaluate(expression);
        // returnByValue=true면 객체는 이미 역직렬화되어 온다 — 문자열일 때만 파싱
        return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    }
}

// ------------------------------------------------------------ helpers

async function waitForPort(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { await fetch(`http://127.0.0.1:${port}/json/version`); return true; }
        catch { await delay(300); }
    }
    return false;
}

function findChrome() {
    for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
    throw new Error('Chrome not found');
}

// ------------------------------------------------------------ main

async function main() {
    const server = await startServer();
    const chromePath = findChrome();
    const userData = mkdtempSync(join(tmpdir(), 'e2e_chrome_'));
    const chrome = spawn(chromePath, [
        '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userData}`, '--no-first-run', '--disable-gpu',
        '--disable-features=HttpsUpgrades', '--window-size=1600,1000', 'about:blank',
    ], { stdio: 'ignore' });

    let exitCode = 1;
    try {
        if (!(await waitForPort(CDP_PORT))) throw new Error('CDP port not open');
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = targets.find((t) => t.type === 'page');
        const cdp = await CDP.connect(page.webSocketDebuggerUrl);
        await cdp.call('Runtime.enable');
        await cdp.call('Page.enable');
        await cdp.call('Log.enable');
        await cdp.call('Network.enable');

        await cdp.call('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });

        // 엔진 부팅 대기
        let booted = false;
        for (let i = 0; i < 60; i++) {
            const r = await cdp.evaluate("!!(window.__game && window.__game.getEngine && window.__game.getEngine())");
            if (r.value) { booted = true; break; }
            await delay(500);
        }
        if (!booted) throw new Error('engine not booted in 30s');

        // ===== [Auth] 통합 브라우저 프로브 =====
        // 승인된 계약 + 백엔드 스토어 + UI 흐름이 실제로 배선되었는지,
        // 그리고 프로바이더 네트워크 호출이 전혀 없는지 확인한다.
        const authProbe = await (async () => {
            const waitFor = async (expression, label, tries = 60) => {
                for (let i = 0; i < tries; i++) {
                    const r = await cdp.evalJson(expression);
                    if (r && r.ok) return r;
                    await delay(100);
                }
                throw new Error(`auth probe timeout: ${label}`);
            };
            // 1) 배선 완료 + 초기 anonymous 상태
            const mounted = await waitFor(
                "(function(){var g=window.__game;if(!g||!g.getAuthRuntime)return {ok:false};" +
                "var rt=g.getAuthRuntime();return {ok:!!rt,mode:rt&&rt.mode,state:rt&&rt.state,panel:g.getAuthPanelState()};})()",
                'runtime mount');
            // 2) 게스트 세션 시작 (로컬 스토리지만 사용)
            const guest = await cdp.evalJson(
                "(async function(){var g=window.__game;var st=await g.signInAsGuest();" +
                "var rt=g.getAuthRuntime();return {status:st,mode:rt.mode,state:rt.state,flowState:rt.flowState," +
                "guestId:rt.guestSessionId,flowGuestId:rt.flowGuestSessionId,panel:g.getAuthPanelState()," +
                "banner:!!document.querySelector('#auth-panel-container [data-guest-session=\"true\"]')," +
                "upgrade:!!document.querySelector('#auth-panel-container [data-auth-action=\"upgrade\"]')};})()");
            // 3) 프로바이더 전이 주입 → authenticated (네트워크 없음)
            const session = { user: { id: 'e2e-user', email: 'e2e@example.test' }, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
            const signedIn = await waitFor(
                "(function(){var g=window.__game;" +
                "if(!g.emitAuthProviderEvent('SIGNED_IN'," + JSON.stringify(session) + "))return {ok:false,reason:'provider configured'};" +
                "var rt=g.getAuthRuntime();return {ok:rt.state==='authenticated'&&rt.flowState==='authenticated',state:rt.state,flowState:rt.flowState,panel:g.getAuthPanelState()," +
                "userId:!!document.querySelector('#auth-panel-container [data-auth-user-id]')," +
                "signOut:!!document.querySelector('#auth-panel-container [data-auth-action=\"sign-out\"]')," +
                "alert:!!document.querySelector('#auth-panel-container [role=\"alert\"]')};})()",
                'provider transition');
            // 4) 로그아웃 → anonymous 으로 복귀
            const signedOut = await cdp.evalJson(
                "(async function(){var g=window.__game;var st=await g.signOutAuth();var rt=g.getAuthRuntime();" +
                "return {status:st,state:rt.state,flowState:rt.flowState,guestId:rt.guestSessionId," +
                "flowGuestId:rt.flowGuestSessionId,panel:g.getAuthPanelState()," +
                "banner:!!document.querySelector('#auth-panel-container [data-guest-session=\"true\"]')};" +
                "})()");
            return { mounted, guest, signedIn, signedOut };
        })();

        // 실제 시작 화면 흐름 — 게임 시작 → 시나리오 → 뒤로 → 세력 → 뒤로 → 재선택 [9]
        const waitForDisplay = async (selector, display) => {
            // [결함 수정] budget 을 4초 → 12초로 늘렸다.
            // 첫 scenario-screen 호출은 loadScenarios() 의 캐시 미스라
            // fetch + res.json() 을 실제로 기다린다. 40×100ms = 4초 안에
            // 안 끝나면 scenarioFlowOpen 이 false 가 되어 E2E 가 통째로
            // 실패했다. 뒤의 두 번째 호출은 캐시 히트라 항상 즉시라
            // "첫 화면만 느리다" 는 신호가 지워져 원인을 놓치기 쉬웠다.
            // 화면 전환은 사용자가 체감할 지연이 아니라 내부 I/O 대기이므로
            // 여유를 주는 게 맞다. 실패를 throw 하지 않고 false 를 돌려주는
            // 기존 계약은 유지한다 — 판정 로직이 메시지를 담고 있다.
            for (let i = 0; i < 120; i++) {
                const value = await cdp.evaluate(`document.getElementById('${selector}').style.display === '${display}'`);
                if (value.value) return true;
                await delay(100);
            }
            return false;
        };
        // 타이틀 메뉴 3항목: 시작하기 / 이어하기 / 무장 편집 [신규 기능]
        // 무장편집은 시나리오 화면을 거치지 않고 곧바로 월드를 만들므로 별도로 확인한다.
        // startGame 은 isRunning 가드 때문에 한 번만 통과하므로, 여기서 먼저 구동한 뒤
        // 페이지를 새로고침해서 아래 시나리오 07 경로를 깨끗하게 다시 시작한다.
        const titleLabels = await cdp.evalJson(
            "(function(){return Array.from(document.querySelectorAll('.title-menu .btn-label')).map(e=>e.textContent.trim());})()");
        if (titleLabels.length !== 3) throw new Error(`title menu expected 3 items, got ${titleLabels.length}`);
        const editorBtnVisible = await cdp.evaluate("!!document.getElementById('btn-title-recruit') && document.getElementById('btn-title-recruit').offsetParent !== null");
        if (!editorBtnVisible.value) throw new Error('무장 편집 버튼이 보이지 않는다');

        // 1) 무장편집 화면이 열리는가
        await cdp.evaluate("document.getElementById('btn-title-recruit').click()");
        const editorOpen = await cdp.evaluate("document.getElementById('editor-screen').classList.contains('open')");
        if (!editorOpen.value) throw new Error('무장 편집 화면이 열리지 않는다');

        // 1b) 실제무장편집: 카드 선택 -> 초상/레이더/연령/특성이 그려진다
        const existingPainted = await cdp.evalJson(
            "(function(){var c=document.querySelector('.roster-card');if(!c)return {noCard:true};c.click();" +
            "return {portrait:!!document.querySelector('#ed-existing-portrait svg')," +
            "radar:!!document.querySelector('#ed-existing-radar svg')," +
            "traits:document.getElementById('ed-existing-traits').children.length," +
            "age:document.getElementById('ed-existing-age-text').textContent};})()");
        if (existingPainted.noCard) throw new Error('기존 무장 카드가 없다');
        if (!existingPainted.portrait) throw new Error('실제무장편집 초상이 그려지지 않는다');
        if (!existingPainted.radar) throw new Error('실제무장편집 레이더가 그려지지 않는다');
        if (!existingPainted.traits || existingPainted.traits < 1) throw new Error('특성 태그가 없다');
        if (!existingPainted.age) throw new Error('연령이 표시되지 않는다');

        // 1c) 신규무장편집 탭으로 전환 -> 초상/레이더/배치가 그려진다
        await cdp.evaluate("document.getElementById('tab-editor-new').click()");
        const newPainted = await cdp.evalJson(
            "(function(){return {portrait:!!document.querySelector('#ed-portrait svg')," +
            "radar:!!document.querySelector('#ed-radar svg')," +
            "age:document.getElementById('ed-age-text').textContent," +
            "deploy:document.querySelectorAll('#ed-deploy .moe-deploy-btn').length};})()");
        if (!newPainted.portrait) throw new Error('신규무장편집 초상이 그려지지 않는다');
        if (!newPainted.radar) throw new Error('신규무장편집 레이더가 그려지지 않는다');
        if (newPainted.deploy !== 4) throw new Error(`배치 버튼이 4개여야 한다: ${newPainted.deploy}`);
        // 기본 생년이 장수로 성립하는 나이가 되어야 한다 (만 4세 같은 값은 결함)
        const ageNum = Number((newPainted.age.match(/만\s*(-?\d+)/) ?? [])[1]);
        if (!Number.isFinite(ageNum) || ageNum < 16) throw new Error(`기본 나이가 부자연스럽다: ${newPainted.age}`);

        // 2) 빈 성명은 경고로 막힌다
        await cdp.evaluate("document.getElementById('ed-name').value=''; document.getElementById('btn-ed-apply').click()");
        const emptyNameBlocked = await cdp.evaluate("document.querySelector('.editor-warn').style.display === 'block'");
        if (!emptyNameBlocked.value) throw new Error('빈 성명으로 방어되지 않았다');

        // 3) 필드별 랜덤이 값을 채운다 (직접 입력과 병존하는지)
        const randomFilled = await cdp.evalJson(
            "(function(){var b=document.querySelector('#editor-new-panel [data-rand=birth]');b.click();" +
            "var n=document.querySelector('#editor-new-panel [data-rand=name]');n.click();" +
            "return {birth:document.getElementById('ed-birth').value,name:document.getElementById('ed-name').value};})()");
        if (randomFilled.birth === '' || randomFilled.name === '') throw new Error('필드 랜덤이 값을 채우지 않았다');

        // 4) 생년을 정하면 플레이 가능한 시나리오 목록이 나온다
        await cdp.evaluate("(function(){var n=document.getElementById('ed-name');n.value='한중윤';n.dispatchEvent(new Event('input'));var b=document.getElementById('ed-birth');b.value='165';b.dispatchEvent(new Event('input'));document.getElementById('btn-ed-apply').click();})()");
        const pickVisible = await cdp.evaluate("document.getElementById('pick-scenario-screen').style.display === 'flex'");
        if (!pickVisible.value) throw new Error('시나리오 선택 화면이 열리지 않는다');
        const pickProbe = await cdp.evalJson(
            "(function(){var cards=Array.from(document.querySelectorAll('#pick-scenario-list .pick-card'));" +
            "return {total:cards.length,playable:cards.filter(c=>!c.classList.contains('blocked')).length," +
            "blocked:cards.filter(c=>c.classList.contains('blocked')).length," +
            "hasReason:cards.some(c=>c.querySelector('.pick-reason')!==null),sub:document.getElementById('pick-scenario-sub').textContent};})()");
        if (pickProbe.total === 0) throw new Error('시나리오 카드가 하나도 없다');
        if (pickProbe.playable === 0) throw new Error('165년생에게 가능한 시나리오가 없다');
        // 탈락 항목은 사유를 보여줘야 한다 (숨기면 왜 안 되는지 알 수 없다)
        if (pickProbe.blocked > 0 && !pickProbe.hasReason) throw new Error('탈락 시나리오에 사유가 없다');

        // 5) 시나리오 → 세력 → 시작 (custom 세력으로 실제로 뜨는지)
        await cdp.evaluate("(function(){var c=document.querySelector('#pick-scenario-list .pick-card:not(.blocked)');c.click();})()");
        const factionVisible = await cdp.evaluate("document.getElementById('faction-screen').style.display === 'flex'");
        if (!factionVisible.value) throw new Error('세력 선택 화면이 열리지 않는다');
        await cdp.evaluate("document.querySelector('.faction-card').click()");
        let recruitStarted = false;
        for (let i = 0; i < 60; i++) {
            const rs = await cdp.evalJson(
                "(function(){var s=window.__game.getStore().getGlobalState();return {pf:s.playerFactionId,y:s.time.year};})()");
            if (rs.pf === 'fac_custom') { recruitStarted = true; break; }
            await delay(500);
        }
        if (!recruitStarted) throw new Error('신규 장수 세력(fac_custom)으로 시작되지 않았다');
        // 생성된 장수가 실제로 조회되는지 (월드에 잘 들어갔는지)
        const recruitOfficerVisible = await cdp.evalJson(
            "(function(){var s=window.__game.getStore();var o=s.getOfficer('off_custom_player');return o?{name:o.name,status:o.status,faction:o.factionId,rank:o.rank}:null;})()");
        if (!recruitOfficerVisible || recruitOfficerVisible.faction !== 'fac_custom') {
            throw new Error('생성된 장수가 스토어에서 조회되지 않는다');
        }
        // 6) 실제무장편집 경로: 편집값이 월드에 반영되는가
        //    (기존에는 선택이 화면에만 남고 월드는 그대로였다)
        await cdp.evaluate("document.getElementById('btn-editor-back').click()");
        await delay(400);
        await cdp.call('Page.reload');
        await delay(1200);
        let existingReloaded = false;
        for (let i = 0; i < 60; i++) {
            const r = await cdp.evaluate("!!document.getElementById('btn-title-recruit')");
            if (r.value) { existingReloaded = true; break; }
            await delay(250);
        }
        if (!existingReloaded) throw new Error('실제무장편집 경로용 새로고침 실패');

        await cdp.evaluate("document.getElementById('btn-title-recruit').click()");
        await delay(500);
        // 편집값을 만든다: 이름을 바꾸고 능력치 하나를 극단으로 밀어 둔다
        const pickedName = await cdp.evalJson(
            "(function(){var c=document.querySelector('.roster-card');if(!c)return {missing:true};c.click();" +
            "var n=document.getElementById('ed-existing-name');n.value='편집테스트';" +
            "var s=document.querySelector('#ed-existing-stats input[type=range]');s.value='99';s.dispatchEvent(new Event('input'));" +
            "return {name:document.getElementById('ed-existing-name').value," +
            "slider:document.querySelector('#ed-existing-stats input[type=range]').value};})()");
        if (pickedName.missing) throw new Error('기존 무장 카드가 없다');
        if (pickedName.name !== '편집테스트') throw new Error('실제무장편집 이름 입력이 되지 않는다');
        if (pickedName.slider !== '99') throw new Error('실제무장편집 슬라이더가 값을 받지 않는다');
        const slidersReady = await cdp.evaluate("document.querySelectorAll('#ed-existing-stats input[type=range]').length");
        if (slidersReady.value !== 5) throw new Error(`실제무장편집 슬라이더가 5개여야 한다: ${slidersReady.value}`);

        await cdp.evaluate("document.getElementById('btn-ed-apply-existing').click()");
        await delay(500);
        const pickCards = await cdp.evaluate("document.querySelectorAll('#pick-scenario-list .pick-card:not(.blocked)').length");
        if (!pickCards.value) throw new Error('실제무장편집 경로에서 시나리오가 뜨지 않는다');
        await cdp.evaluate("document.querySelector('#pick-scenario-list .pick-card:not(.blocked)').click()");
        await delay(400);
        await cdp.evaluate("document.querySelector('.faction-card').click()");

        // 월드에서 실제로 '편집테스트' 가 존재하고 능력치가 반영됐는지 본다
        let existingStart = null;
        for (let i = 0; i < 60; i++) {
            existingStart = await cdp.evalJson(
                "(function(){var s=window.__game.getStore();if(!s)return null;" +
                "var o=s.getAllOfficers().find(function(x){return x.name==='편집테스트';});" +
                "if(!o)return null;var g=s.getGlobalState();" +
                "return {faction:o.factionId,player:g.playerFactionId,leadership:o.stats.leadership,rank:o.rank};})()");
            if (existingStart) break;
            await delay(500);
        }
        if (!existingStart) throw new Error('편집한 무장이 월드에 반영되지 않았다');
        if (existingStart.leadership !== 99) {
            throw new Error(`편집한 능력치가 반영되지 않았다: ${existingStart.leadership}`);
        }
        if (existingStart.player !== existingStart.faction) {
            throw new Error('플레이어 세력과 소속 세력이 다르다');
        }
        const recruitProbe = {
            titleLabels, editorOpen: true, existingPainted, newPainted,
            emptyNameBlocked: true, randomFilled, pickProbe,
            recruitStarted, officer: recruitOfficerVisible, existingStart,
        };

        // isRunning 가드를 풀기 위해 새로고침 — 아래 시나리오 경로를 위해 타이틀로 복귀
        await cdp.call('Page.reload');
        await delay(1200);
        let recruitReloadBooted = false;
        for (let i = 0; i < 60; i++) {
            const r = await cdp.evaluate("!!document.getElementById('btn-title-recruit')");
            if (r.value) { recruitReloadBooted = true; break; }
            await delay(250);
        }
        if (!recruitReloadBooted) throw new Error('새로고침 후 타이틀로 복귀하지 못했다');
        await cdp.evaluate("document.getElementById('btn-title-new').click()");
        const scenarioFlowOpen = await waitForDisplay('scenario-screen', 'flex');
        await cdp.evaluate("document.getElementById('btn-scenario-back').click()");
        const titleBackVisible = await cdp.evaluate("document.getElementById('title-screen').style.display !== 'none'");
        await cdp.evaluate("document.getElementById('btn-title-new').click()");
        await waitForDisplay('scenario-screen', 'flex');
        await cdp.evaluate("document.querySelector('.scenario-card[data-id=\\\"07\\\"]').click()");
        const factionFlowOpen = await waitForDisplay('faction-screen', 'flex');
        await cdp.evaluate("document.getElementById('btn-faction-back').click()");
        const scenarioBackAgain = await waitForDisplay('scenario-screen', 'flex');
        await cdp.evaluate("document.querySelector('.scenario-card[data-id=\\\"07\\\"]').click()");
        await waitForDisplay('faction-screen', 'flex');
        await cdp.evaluate("document.querySelector('.faction-card[data-idx=\\\"1\\\"]').click()");
        const officerFlowOpen = await waitForDisplay('officer-screen', 'flex');
        const officerCards = await cdp.evaluate("document.querySelectorAll('.officer-card').length");
        if (!officerCards.value) throw new Error('무장 선택 목록이 비어 있다');
        await cdp.evaluate("document.querySelector('.officer-card').click()");

        // 07 삼국鼎峙 실제 플레이 프로브 — 외부 능력치·도시 프로필·관계 JSON·연의전 [5][269][300]
        let scenario07Started = false;
        for (let i = 0; i < 60; i++) {
            const gs = await cdp.evalJson(
                "(function(){var s=window.__game.getStore().getGlobalState();return {pf:s.playerFactionId,t:s.turnCount,y:s.time.year};})()");
            if (gs.pf === 'fac_1' && gs.t === 0 && gs.y === 220) { scenario07Started = true; break; }
            await delay(500);
        }
        if (!scenario07Started) throw new Error('scenario 07 start failed');
        const flowProbe = { scenarioFlowOpen, titleBackVisible: titleBackVisible.value, factionFlowOpen, scenarioBackAgain, officerFlowOpen, officerCards: officerCards.value, recruitProbe };
        await cdp.evaluate("document.getElementById('btn-next-month').click()");
        for (let i = 0; i < 75; i++) {
            const r = await cdp.evaluate("!document.getElementById('btn-next-month').disabled");
            if (r.value) break;
            await delay(200);
        }
        const scenario07Probe = await cdp.evalJson(
            "(function(){var g=window.__game,s=g.getStore(),e=g.getEngine();" +
            "var officers=s.getAllOfficers(),cities=s.getAllCities();" +
            "return {cityNames:cities.map(function(c){return c.name;})," +
            "qingdu:cities.find(function(c){return c.name==='청두';}).developmentStats.farming," +
            "caoPi:officers.find(function(o){return o.id==='cao_pi';}).stats.intelligence," +
            "relationships:Object.keys(s.getState().relationships).length," +
            "eventProcessed:e.eventEngine.queueMgr.isProcessed('ev_07_jiangwan_peace')," +
            "eventText:e.chronicle.list().map(function(x){return x.text;}).join('|')};})()");

        // AI BattleCommand 직접 실행 — 포로 처분 로그·연대기까지 브라우저에서 검증 [121-130][131-145]
        const captiveBattleProbe = await cdp.evalJson("window.__game.runTestBattle()");
        // 월간 보고서 UI에도 같은 포로 처분 결과가 표시되는지 확인 [121-130][131-145]
        const monthlyReportProbe = await cdp.evalJson(
            "(function(){document.getElementById('btn-report').click();" +
            "var panel=document.getElementById('monthly-report-panel');var text=document.getElementById('mr-ported').textContent;" +
            "var visible=panel.style.display==='block';document.getElementById('mr-close').click();" +
            "return {visible:visible,hasCaptive:text.includes('포로')};})()"
        );
        const cityChronicleProbe = await cdp.evalJson(
            "(function(){try{var g=window.__game;g.openCity(" + JSON.stringify(captiveBattleProbe.targetCityId) + ");" +
            "var text=document.getElementById('cdp-captive-history').textContent;g.closeCity();" +
            "return {hasHistory:text.includes('포로')};}catch(e){return {hasHistory:false,error:String(e)};}})()"
        );
        const chronicleFilterProbe = await cdp.evalJson(
            "(function(){document.getElementById('tab-chronicle').click();" +
            "var content=document.getElementById('chronicle-content');" +
            "var result={factionFilters:content.querySelectorAll('.ch-faction-filter').length," +
            "hasCapture:content.textContent.includes('포로')};" +
            "document.getElementById('tab-log').click();return result;})()"
        );

        // 중국 전도 도시 표시: 초기 전체 도시 → 방문·소유 도시 필터 전환 [49]
        const mapVisibilityProbe = await cdp.evalJson(
            "(function(){var g=window.__game,b=document.getElementById('btn-map-visibility');" +
            "var initial={mode:g.getCityVisibilityMode(),visible:g.getVisibleCityIds().length,all:g.getWorldCities().length,text:b.textContent};" +
            "b.click();var discovered={mode:g.getCityVisibilityMode(),visible:g.getVisibleCityIds().length,all:g.getWorldCities().length,text:b.textContent,factions:g.getFactionLabels().map(function(f){return f.name;})};" +
            "b.click();return {initial:initial,discovered:discovered,restored:g.getCityVisibilityMode()};})()");

        // 지도 스크린샷 회귀 프로브 — 실제 캔버스 픽셀이 캡처되고 정적인 지도에서 안정적인지 확인
        const mapScreenshotProbe = await cdp.evalJson(
            "(async function(){var c=document.getElementById('game-canvas'),ctx=c.getContext('2d');" +
            "function sample(){var x=100,y=100,w=Math.min(400,c.width-x),h=Math.min(300,c.height-y);" +
            "var d=ctx.getImageData(x,y,w,h).data,hash=2166136261;" +
            "for(var i=0;i<d.length;i+=997){hash^=d[i];hash=Math.imul(hash,16777619);}return hash>>>0;}" +
            "var first=sample(),png=c.toDataURL('image/png'),stable=false,previous=first;" +
            "for(var frame=0;frame<12;frame++){await new Promise(function(r){requestAnimationFrame(function(){r();});});var current=sample();if(current===previous){stable=true;break;}previous=current;}" +
            "var second=previous,corner=Array.from(ctx.getImageData(2,2,1,1).data);" +
            "var imageRequests=performance.getEntriesByType('resource').map(function(e){return e.name;}).filter(function(u){return /\\.(png|jpe?g|webp|gif|svg)(\\?|$)/i.test(u);});" +
            "return {width:c.width,height:c.height,pngLength:png.length,hashStable:stable,corner:corner,imageRequests:imageRequests,hasBitmapApi:typeof window.__game.getChinaMap().isMapImageReady==='function'};})()");

        // 중국 전도 실제 캔버스 클릭 — 모든 도시가 pointerup에서 선택되는지 검증 [461-480]
        const mapClickPoints = await cdp.evalJson(
            "(function(){var g=window.__game,s=g.getStore(),c=document.getElementById('game-canvas'),r=c.getBoundingClientRect();" +
            "return s.getAllCities().map(function(city){var p=g.getCityScreenPosition(city.id);" +
            "return {id:city.id,name:city.name,x:r.left+p.x*r.width/c.width,y:r.top+p.y*r.height/c.height};});})()");
        // 성문 검문 대비: 플레이어 국고를 채워 뇌물 선택지가 항상 활성화되게 한다
        await cdp.evaluate("(function(){var s=window.__game.getStore(),gs=s.getGlobalState(),f=s.getFaction(gs.playerFactionId);s.updateFaction(f.id,{gold:f.gold+1000000});return true;})()");
        const mapClickResults = [];
        for (const point of mapClickPoints) {
            await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
            await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
            await delay(40);
            // 2026-09-30 — 지도 클릭은 두 번 클릭 규칙이다.
            // 1회: 좌측 정보 단(도시 정보)에 그 도시가 실린다. 2회: 도시 진입.
            // 한 번만 눌렀다가 진입을 기대하면 이 규칙을 못 잡는다.
            const sidebarCity = await cdp.evaluate("(document.getElementById('city-detail')||{}).textContent||''");
            const sidebarListed = sidebarCity.value.indexOf(point.name) >= 0;
            await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
            await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
            await delay(40);
            // 성문 검문이 뜨면 뇌물 선택지로 통과한 뒤 도시명을 읽는다
            const gated = await cdp.evaluate("document.getElementById('dialogue-modal').style.display==='flex'&&!!document.querySelector('.dlg-choice[data-choice=\"bribe\"]:not([disabled])')");
            if (gated.value) {
                await cdp.evaluate("document.querySelector('.dlg-choice[data-choice=\"bribe\"]').click()");
                await delay(120);
            }
            // 황제 알현 창은 성문 검문 다음에 열린다(enterCity 훅). 선택을 눌러도 결과만
            // 갱신될 뿐 창은 스스로 닫히지 않으므로, 닫기 버튼을 눌러 명시적으로 닫는다.
            // 부족 교섭 창이 이어서 뜰 수 있어 최대 몇 번까지 정리한다.
            for (let d = 0; d < 3; d++) {
                const audienceOpen = await cdp.evaluate("document.getElementById('dialogue-modal').style.display==='flex'");
                if (!audienceOpen.value) break;
                await cdp.evaluate("(function(){var c=document.getElementById('dialogue-close')||document.querySelector('#dialogue-modal [data-close]')||document.querySelector('.dlg-close');if(c)c.click();else document.getElementById('dialogue-modal').style.display='none';return true;})()");
                await delay(120);
            }
            const selected = await cdp.evaluate("document.getElementById('cdp-city-name').textContent");
            mapClickResults.push({ id: point.id, expected: point.name, actual: selected.value, gated: gated.value, sidebarListed: sidebarListed });
            // 도시 진입 전체 화면을 닫아 다음 도시 좌표도 지도에서 계속 검증한다.
            await cdp.evaluate("document.getElementById('cdp-close').click()");
            await delay(40);
        }
        const mapClickProbe = { points: mapClickPoints.length, results: mapClickResults, coordinates: mapClickPoints };

        // 도시 시설·무장 선택형 대화와 이전/다음 탐색 프로브 [24][49][441-460]
        // 타이포그래피는 창을 연 직후에도 글자가 0 자일 수 있다. 이 프로브는
        // 완성된 대사를 읽어야 하므로, 검사 동안에만 즉시 표시로 고정한다.
        await cdp.evaluate("window.__game.setDialogueInstant(true)");
        const dialogueProbe = await cdp.evalJson(
            "(function(){var g=window.__game,s=g.getStore();" +
            "var city=s.getAllCities()[0];g.openCity(city.id);" +
            "var scene=document.getElementById('city-scene-canvas'),sr=scene.getBoundingClientRect();" +
            "scene.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:sr.left+sr.width/2,clientY:sr.top+sr.height*0.45}));" +
            "var facilities=document.querySelectorAll('.cdp-facility');" +
            "var facilityNames=Array.prototype.map.call(facilities,function(el){return el.textContent.trim();});" +
            "var facility=facilities[0];if(facility)facility.click();" +
            "var facilityOpen=document.getElementById('dialogue-modal').style.display==='flex';" +
            "var facilityTitle=document.getElementById('dialogue-title').textContent;" +
            "document.getElementById('dialogue-close').click();" +
            "var officer=document.querySelector('#cdp-officers .cdp-officer-clickable');if(officer)officer.click();" +
            "var officerOpen=document.getElementById('dialogue-modal').style.display==='flex';" +
            "var officerTitle=document.getElementById('dialogue-title').textContent;" +
            "var choices=document.querySelectorAll('#dialogue-choices .dlg-choice').length;" +
            "var giftBeforeGold=g.getStore().getFaction(g.getStore().getGlobalState().playerFactionId).gold;" +
            "var giftBeforeAffinity=document.querySelector('.od-affinity-row b')?.textContent||'';" +
            "var giftItem=document.querySelector('[data-gift-item]');" +
            "var giftGold=document.querySelector('[data-gift-gold]');" +
            "if(giftItem&&giftGold){giftItem.value='JADE';giftItem.dispatchEvent(new Event('input',{bubbles:true}));giftGold.value='500';giftGold.dispatchEvent(new Event('input',{bubbles:true}));}" +
            "var giftPreview=document.querySelector('[data-gift-preview]')?.textContent||'';" +
            "var giftSend=document.querySelector('[data-gift-send]');if(giftSend)giftSend.click();" +
            "var giftResult=document.getElementById('dialogue-result').textContent;" +
            "var giftAfterGold=g.getStore().getFaction(g.getStore().getGlobalState().playerFactionId).gold;" +
            "var giftAfterAffinity=document.querySelector('.od-affinity-row b')?.textContent||'';" +
            "var page=document.getElementById('dialogue-page').textContent;" +
            "document.getElementById('dialogue-next').click();var nextPage=document.getElementById('dialogue-page').textContent;" +
            "document.getElementById('dialogue-prev').click();var prevPage=document.getElementById('dialogue-page').textContent;" +
            "document.getElementById('dialogue-close').click();" +
            // 대화창 개편: 좌측 화자 열 + 번호 선택지 [신규 기능]
            "var o2=document.querySelector('#cdp-officers .cdp-officer-clickable');if(o2)o2.click();" +
            "var dlgFrame=document.querySelector('#dialogue-modal .dlg-stage');" +
            "var dlgPortraitSvg=!!document.querySelector('#dlg-left-figure svg');" +
            "var dlgSpeakerText=document.getElementById('dlg-left-name').textContent.trim();" +
            "var dlgOrgText=document.getElementById('dlg-left-org').textContent.trim();" +
            "var dlgRankText=document.getElementById('dlg-left-rank').textContent.trim();" +
            "var dlgBodyText=document.getElementById('dialogue-text').textContent;" +
            "var dlgChoiceIdx=document.querySelectorAll('#dialogue-choices .dlg-choice-idx').length;" +
            "var dlgStepText=document.getElementById('dialogue-progress-label').textContent.trim();" +
            "var dlgPrevDisabled=document.getElementById('dialogue-prev').disabled;" +
            "var accent=dlgFrame?dlgFrame.style.getPropertyValue('--dlg-accent'):'';" +
            "var dlgRightHidden=document.querySelector('.dlg-slot-right').dataset.empty==='1';" +
            // 키보드 조작: → 다음, ← 이전, 숫자 선택지 [신규 기능]
            "document.getElementById('dialogue-modal').focus();" +
            "var kbdBefore=document.getElementById('dialogue-page').textContent;" +
            "document.getElementById('dialogue-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));" +
            "var kbdNext=document.getElementById('dialogue-page').textContent;" +
            "document.getElementById('dialogue-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));" +
            "var kbdPrev=document.getElementById('dialogue-page').textContent;" +
            "document.getElementById('dialogue-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}));" +
            "var kbdChoiceResult=document.getElementById('dialogue-result').textContent;" +
            "var kbdChoiceShown=document.getElementById('dialogue-result').style.display!=='none';" +
            "document.getElementById('dialogue-close').click();" +
            // 시설 대화는 사람이 아니라 글자 표식이 왼쪽에 있어야 한다
            "var f2=document.querySelector('.cdp-facility');if(f2)f2.click();" +
            "var placeGlyph=document.querySelector('#dlg-left-figure.dlg-place')?.textContent||'';" +
            "var placeIsGlyph=!!document.querySelector('#dlg-left-figure.dlg-place') && !document.querySelector('#dlg-left-figure svg');" +
            "document.getElementById('dialogue-close').click();" +
            // 시장 클릭 -> 불량배 연쇄 대화 / 교역소 구매 [신규 기능]
            "document.getElementById('dialogue-close').click();" +
            "var city2=s.getAllCities().find(function(c){return c.ownerId===s.getGlobalState().playerFactionId;})||s.getAllCities()[0];" +
            "city2.developmentStats.publicOrder=8;city2.developmentStats.commerce=12;g.openCity(city2.id);" +
            "s.getAllOfficers().forEach(function(o){try{s.updateOfficer(o.id,{actionPoints:100});}catch(e){}});" +
            "var mk=document.querySelector('[data-facility=MARKET]');if(mk)mk.click();" +
            "var mktOpen=document.getElementById('dialogue-modal').style.display==='flex';" +
            "var mktTitle=document.getElementById('dialogue-title').textContent;" +
            "var mktCh1=document.querySelectorAll('#dialogue-choices .dlg-choice').length;" +
            "var mktFirst=document.querySelectorAll('#dialogue-choices .dlg-choice')[0]||{disabled:true};" +
            "if(!mktFirst.disabled)mktFirst.click();" +
            "var mktResult=document.getElementById('dialogue-result').textContent;" +
            "var mktResultShown=document.getElementById('dialogue-result').style.display!=='none';" +
            "document.getElementById('dialogue-close').click();" +
            "g.openTradeDialogue(city2.id);" +
            "var trOpen=document.getElementById('dialogue-modal').style.display==='flex';" +
            "var trRows=document.querySelectorAll('#dialogue-trade .dlg-trade-row').length;" +
            "var trGold0=s.getFaction(s.getGlobalState().playerFactionId).gold;" +
            "var trDeal=document.querySelectorAll('#dialogue-choices .dlg-choice')[0];if(trDeal)trDeal.click();" +
                        "var trPrice=parseInt(document.querySelectorAll('#dialogue-trade .dlg-trade-row')[0].querySelectorAll('.dlg-trade-price')[1].textContent,10);" +
"var trBuy=document.querySelector('[data-trade-buy=grain]');if(trBuy&&!trBuy.disabled)trBuy.click();" +
            "var trGold1=s.getFaction(s.getGlobalState().playerFactionId).gold;" +
            "var trNote=document.getElementById('dialogue-result').textContent;" +
            "document.getElementById('dialogue-close').click();" +
            "var scene=document.getElementById('city-scene-canvas');" +
            // 2026-09-30 개편 — 건물 상세·추천 힌트·건물 칩 블록은 삭제됐다. 요소가 아예 없는 것이
            // 맞으므로 "없음"을 확인한다. 남겨두면 HUD 가 그림 위로 되살아난다.
            "var removedBlock={hint:!document.getElementById('city-hint-bar'),summary:!document.getElementById('city-scene-summary'),detail:!document.getElementById('city-building-detail'),stats:!document.getElementById('cdp-stats'),infoPane:!document.querySelector('#city-detail-panel .cdp-info-pane'),loyaltyChip:!Array.prototype.some.call(document.querySelectorAll('#cdp-summary .cdp-chip'),function(c){return c.textContent.indexOf('충성')>=0;})};" +
            "return {facilityOpen:facilityOpen,facilityTitle:facilityTitle,facilityCount:facilities.length,facilityNames:facilityNames,officerOpen:officerOpen," +
            "officerTitle:officerTitle,choices:choices,giftBeforeGold:giftBeforeGold,giftBeforeAffinity:giftBeforeAffinity,giftPreview:giftPreview,giftResult:giftResult,giftAfterGold:giftAfterGold,giftAfterAffinity:giftAfterAffinity,page:page,nextPage:nextPage,prevPage:prevPage," +
            "dlgPortraitSvg:dlgPortraitSvg,dlgRightHidden:dlgRightHidden,dlgSpeakerText:dlgSpeakerText,dlgOrgText:dlgOrgText,dlgRankText:dlgRankText," +
            "dlgBodyText:dlgBodyText,dlgChoiceIdx:dlgChoiceIdx,dlgStepText:dlgStepText,dlgPrevDisabled:dlgPrevDisabled," +
            "kbdBefore:kbdBefore,kbdNext:kbdNext,kbdPrev:kbdPrev,kbdChoiceShown:kbdChoiceShown,kbdChoiceResult:kbdChoiceResult," +
            "accent:accent,placeGlyph:placeGlyph,placeIsGlyph:placeIsGlyph,dlgRightHidden:dlgRightHidden," +
            "mktOpen:mktOpen,mktTitle:mktTitle,mktCh1:mktCh1,mktResult:mktResult,mktResultShown:mktResultShown," +
            "trOpen:trOpen,trRows:trRows,trGold0:trGold0,trGold1:trGold1,trNote:trNote,trPrice:trPrice," +
            "accent:accent,placeGlyph:placeGlyph,placeIsGlyph:placeIsGlyph,dlgRightHidden:dlgRightHidden," +
            "mktOpen:mktOpen,mktTitle:mktTitle,mktCh1:mktCh1,mktResult:mktResult,mktResultShown:mktResultShown," +
            "trOpen:trOpen,trRows:trRows,trGold0:trGold0,trGold1:trGold1,trNote:trNote,trPrice:trPrice," +
            "trOpen:trOpen,trRows:trRows,trGold0:trGold0,trGold1:trGold1,trNote:trNote,trPrice:trPrice,removedBlock:removedBlock,citySceneWidth:scene.width,citySceneHeight:scene.height,entryMode:document.getElementById('city-detail-panel').classList.contains('city-entry-mode'),"
            // 배경 그림이 실제로 로드됐는지 — 조용히 절차 렌더로 물러나면 검증이 통과해 버린다.
            + "artReady:document.getElementById('city-scene-stage').classList.contains('art-ready'),"
            + "artComplete:(function(){var i=document.getElementById('city-scene-art');return !!(i&&i.complete&&i.naturalWidth>0);})(),"
            + "artSrc:(function(){var i=document.getElementById('city-scene-art');return i?i.getAttribute('src'):null;})(),"
            + "bleedMode:document.getElementById('city-detail-panel').classList.contains('city-bleed'),"
            // 모드 전환 버튼(🏛 도시 관리)이 더 이상 없는지 + 반투명 HUD 가 실제로 보이는지.
            + "backButton:!!document.querySelector('.city-bleed-toggle'),"
            + "layoutPanes:(function(){function vis(e){if(!e)return false;var r=e.getBoundingClientRect();return r.width>40&&r.height>20;}return {"
            + "side:!document.querySelector('#city-detail-panel .cdp-side-pane'),"
            + "head:vis(document.querySelector('#city-detail-panel .cdp-header')),"
            // [2026-10-03] 좌·우 레일을 걷어내 그림 위 시트로 대체했다. 레일 내용은 시트 안에
            //   있으므로 **배지를 눌러 시트를 연 뒤에** 재야 한다. 닫힌 채로 재면 아무것도
            //   존재하지 않아 통과도 실패도 하지 않는다(조용한 빈 검사).
            + "hudBottom:vis(document.querySelector('#city-scene-stage .cdp-stage-hud-bottom')),"
            + "headerInStage:!!document.querySelector('#city-scene-stage .cdp-header'),"
            + "sheetOpen:(function(){var b=document.querySelector('#city-scene-badges .city-badge');if(b)b.click();"
            + "var e=document.getElementById('cdp-scene-sheet');return !!(e&&!e.hidden);})(),"
            + "commander:vis(document.querySelector('#cdp-sheet-body #city-commander')),"
            + "commandsInSheet:!!document.querySelector('#cdp-scene-sheet #cdp-command-groups'),"
            + "factionsInSheet:!!document.querySelector('#cdp-scene-sheet #cdp-factions'),"
            + "officersInSheet:!!document.querySelector('#cdp-scene-sheet #cdp-officers'),"
            + "facilitiesInStage:!!document.querySelector('#city-scene-stage #cdp-facilities'),"
            // 2026-09-30 개편 — 출진·등용·습격 은 좌측 목록의 대화창으로 되살렸다.
            + "expeditionGone:!document.getElementById('cdp-expedition-section'),"
            + "recruitGone:!document.getElementById('cdp-recruit-section'),"
            + "raidGone:!document.getElementById('cdp-raid-section'),"
            + "tabsGone:!document.getElementById('cdp-side-tabs'),"
            + "commandGroups:document.querySelectorAll('#cdp-command-groups .cdp-command-group').length,"
            + "commandLabels:Array.prototype.map.call(document.querySelectorAll('#cdp-command-groups .cdp-action-btn'),function(b){return b.textContent;}),"
            + "factionRows:document.querySelectorAll('#cdp-factions .cdp-faction-row').length,"
            + "freeOfficers:document.querySelectorAll('#cdp-officers .cdp-officer-row.is-free').length,"
            // 명령은 그룹별로 세로 1열 — 그룹 안에서 같은 x, 아래로 내려가는지 + 글자 잘림 없음.
            + "commandCol:(()=>{var gs=document.querySelectorAll('#cdp-command-groups .cdp-command-group');if(gs.length<2)return false;"
            + "for(var i=0;i<gs.length;i++){var b=gs[i].querySelectorAll('.cdp-action-btn');if(!b.length)continue;"
            + "var xs=Array.prototype.map.call(b,function(c){return Math.round(c.getBoundingClientRect().left);});"
            + "var ys=Array.prototype.map.call(b,function(c){return Math.round(c.getBoundingClientRect().top);});"
            + "if(!xs.every(function(x){return Math.abs(x-xs[0])<=2;}))return false;"
            + "if(!ys.every(function(y,k){return k===0||y>ys[k-1];}))return false;}"
            + "return Array.prototype.every.call(document.querySelectorAll('#cdp-command-groups .cdp-action-btn'),function(c){return c.scrollWidth<=c.clientWidth+1;});})(),"
            + "facilityRow:(()=>{var f=document.getElementById('cdp-facilities');if(!f)return false;"
            + "var ys=Array.prototype.map.call(f.children,function(c){return Math.round(c.getBoundingClientRect().top);});"
            + "return ys.length>1&&ys.every(function(y){return Math.abs(y-ys[0])<=2;});})(),"
            + "actions:document.querySelectorAll('#cdp-actions .cdp-action-btn').length,"
            + "groupedActions:document.querySelectorAll('#cdp-command-groups .cdp-action-btn').length,"
            + "officers:document.querySelectorAll('#cdp-officers .cdp-officer-row').length,"
            // 그림이 화면을 가득 채우는지 — 창 비율 그대로여야 한다(2026-10-02: 16:9 고정 해제).
            + "fullBleed:(function(){var st=document.getElementById('city-scene-stage').getBoundingClientRect();"
            + "return Math.abs(st.width-window.innerWidth)<=2&&Math.abs(st.height-window.innerHeight)<=2"
            + "&&Math.abs(st.left)<=2&&Math.abs(st.top)<=2;})()};})(),"
            // fits: 그림이 창 안에 들어 있는가. 진입 페이드(fadeUp)가 0.3초 동안 18px
            // 아래로 미끄러지므로 그만큼의 여유를 둔다 — 안정 후에는 정확히 맞아야 한다.
            + "stageBox:(function(){var r=document.getElementById('city-scene-stage').getBoundingClientRect();var tol=24;return {w:Math.round(r.width),h:Math.round(r.height),ratio:+(r.width/Math.max(1,r.height)).toFixed(3),fits:r.top>=-tol&&r.bottom<=window.innerHeight+tol&&r.left>=-tol&&r.right<=window.innerWidth+tol,top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right),vw:window.innerWidth,vh:window.innerHeight};})(),"
            + "badges:Array.prototype.map.call(document.querySelectorAll('#city-scene-badges .city-badge'),function(b){return b.style.left+','+b.style.top;})"
            +"};})()");

        // 도시 건물 투자·운영 상태와 지도 카메라 보존 [49][D32]
        // 2026-09-30 개편 — 건물 상세 DOM(#city-building-detail)이 삭제돼 문자열을 못 읽는다.
        // 투자 로직 자체는 그대로 살아 있으므로 API 로만 확인한다(마우스 UI 는 없음).
        const buildingProbe = await cdp.evalJson(
            "(function(){var g=window.__game,s=g.getStore(),gs=s.getGlobalState();" +
            "var city=s.getAllCities().find(function(c){return c.ownerId===gs.playerFactionId;});" +
            "g.openCity(city.id);var before=g.getCitySceneBuildings();g.selectCitySceneBuildingByIndex(0);" +
            "var selected=g.getCitySceneBuildings()[0];g.investSelectedCityBuilding();" +
            "var after=g.getCitySceneBuildings();var state=g.getCityBuildingStates()[city.id]||{};" +
            "var view=g.getMapView();g.closeCity();return {count:before.length,selected:!!selected,invested:after[0].investment>before[0].investment," +
            "stateCount:Object.keys(state).length,view:view};})()");

        // 내정 자동 배정: 플레이어 도시에서 능력치 기반 임무를 등록하는지 확인 [49][76-85]
        const domesticProbe = await cdp.evalJson(
            "(function(){var g=window.__game,s=g.getStore(),gs=s.getGlobalState(),e=g.getEngine();" +
            "var city=s.getAllCities().find(function(c){return c.ownerId===gs.playerFactionId;});" +
            "g.openCity(city.id);" +
            "var _bdg=document.querySelector('#city-scene-badges .city-badge');if(_bdg)_bdg.click();" +
            "var _btn=document.querySelector('[data-action=auto-domestic]');if(_btn)_btn.click();" +
            "var _res=document.getElementById('cdp-action-result');" +
            "return {pending:e.domesticScheduler.pendingCount,result:_res?_res.textContent:''};})()");

        // 시나리오별 검증 후 기존 05 회귀 흐름을 위해 페이지 초기화
        await cdp.call('Page.reload');
        await delay(1200);
        booted = false;
        for (let i = 0; i < 60; i++) {
            const r = await cdp.evaluate("!!(window.__game && window.__game.getEngine && window.__game.getEngine())");
            if (r.value) { booted = true; break; }
            await delay(500);
        }
        if (!booted) throw new Error('engine not rebooted after scenario 07 probe');

        // 시나리오 시작 (fac_0 = 조조)
        await cdp.evaluate("window.__game.startScenario('05', 0)");
        let started = false;
        for (let i = 0; i < 60; i++) {
            const gs = await cdp.evalJson(
                "(function(){var s=window.__game.getStore().getGlobalState();return {pf:s.playerFactionId,t:s.turnCount};})()");
            if (gs.pf && gs.t === 0) { started = true; break; }
            await delay(500);
        }
        if (!started) throw new Error('scenario start failed');

        // 24개월 진행 — 방문 모달 자동 사절
        const progress = [];
        for (let m = 1; m <= 24; m++) {
            await cdp.evaluate(
                "(function(){var b=document.querySelector('.rm-option[data-visit=\"decline\"]');" +
                "if(b && b.offsetParent!==null) b.click();})()");
            await cdp.evaluate("document.getElementById('btn-next-month').click()");
            let done = false;
            for (let i = 0; i < 75; i++) {
                const r = await cdp.evaluate("!document.getElementById('btn-next-month').disabled");
                if (r.value) { done = true; break; }
                await delay(200);
            }
            if (!done) throw new Error(`turn ${m} did not finish in 15s`);
            if (m % 6 === 0) {
                progress.push(await cdp.evalJson(
                    "(function(){var s=window.__game.getStore().getGlobalState();" +
                    "return {y:s.time.year,m:s.time.month,t:s.turnCount};})()"));
            }
        }

        // 통일 조건 강제 → 엔딩 판정
        // ===== [461-480] 신규 UI 검증 =====
        // (a) 인맥 패널 오픈 + 그래프 렌더 + 닫기
        const graphProbe = await cdp.evalJson(
            "(function(){var b=document.getElementById('btn-graph');b.click();" +
            "var panel=document.getElementById('graph-panel');var canvas=document.getElementById('gp-canvas');" +
            "var detail=document.getElementById('gp-detail').textContent;" +
            "var out={open:panel.style.display,cw:canvas.width,rows:detail.split('gp-rel-row').length-1," +
            "hint:detail.indexOf('노드')>=0};" +
            "b.click();out.closed=panel.style.display==='none';return out;})()");

        // (b) 접근성 패널 — 색약 모드 버튼 클릭 시 active 전환
        const a11yProbe = await cdp.evalJson(
            "(function(){var b=document.getElementById('btn-settings');b.click();" +
            "var cbBtn=document.querySelector('#a11y-content [data-cb=\"deuteranopia\"]');" +
            "if(!cbBtn) return {err:'no cb button'};" +
            "cbBtn.click();" +
            "var out={open:document.getElementById('a11y-panel').style.display};" +
            "out.cbActive=!!document.querySelector('#a11y-content [data-cb=\"deuteranopia\"].active');" +
            "document.getElementById('a11y-close').click();return out;})()");

        // (c) 키보드 단축키 — H/Escape/P [461-480]
        // Escape 는 "가장 위 오버레이" 하나만 닫는다(closeTopOverlay 순서). 앞선 프로브가
        // 패널을 열어 둔 채면 Escape 가 그 패널을 닫아 도움말이 닫히지 않으므로,
        // 측정 전제로 열린 오버레이를 먼저 모두 닫는다.
        const keyboardProbe = await cdp.evalJson(
            "(function(){var out={};" +
            "['dialogue-modal','roaming-modal','replay-panel','vengeance-modal','a11y-panel','graph-panel','trace-panel','save-slots-panel','diplomacy-panel','monthly-report-panel','city-detail-panel'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display='none';});" +
            // [2026-10-03 제거] 튜토리얼 안내(#tutorial-panel)와 H 단축키를 삭제했다.
            //   대상이 없어 조용히 통과하는 검증은 검증이 아니다 — 아래는 살아있는
            //   패널(G 관계망)로 같은 경로(Escape 로 닫기)를 검증한다.
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'g',bubbles:true}));" +
            "out.helpOpen=document.getElementById('graph-panel').style.display==='block';" +
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));" +
            "out.helpClosed=document.getElementById('graph-panel').style.display==='none';" +
            "var p=document.getElementById('btn-pause');" +
            // 2026-09-30 상단 바가 아이콘 전용으로 바뀌어 textContent 는 더 이상 상태를
            // 말하지 않는다(라벨은 CSS 로 숨겨진 채 남아 있다). 접근 가능한 이름(aria-label)과
            // 아이콘 속성을 함께 본다 — 아이콘 전용 버튼이라면 이 둘이 상태의 유일한 신호다.
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}));" +
            "out.paused=p.getAttribute('aria-label')==='재개'&&p.dataset.icon==='▶';" +
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'p',bubbles:true}));" +
            "out.resumed=p.getAttribute('aria-label')==='일시정지'&&p.dataset.icon==='⏸';" +
            // 아이콘이 실제로 렌더되는지도 확인한다 — data-icon 만 있고 ::before 가 없으면 조용히 빈 버튼이다.
            "out.iconsRendered=(function(){var cs=getComputedStyle(document.getElementById('btn-pause'),'::before');"
            + "return cs&&cs.content&&cs.content!=='none'&&cs.content.indexOf('attr')===-1;})();" +
            "out.labelsHidden=(function(){var l=document.querySelector('#btn-pause .btn-label');"
            + "return !!l&&getComputedStyle(l).display==='none';})();" +
            "return out;})()");

        // (d) 모바일 반응형 + 실제 터치 이벤트 [461-480]
        await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        const touchPoint = await cdp.evalJson(
            "(function(){var r=document.getElementById('game-canvas').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()");
        await cdp.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchPoint, id: 1 }] });
        await cdp.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const mobileProbe = await cdp.evalJson(
            "(function(){var c=document.getElementById('game-canvas'),controls=document.getElementById('controls');" +
            "return {touchAction:getComputedStyle(c).touchAction,canvasWidth:c.getBoundingClientRect().width," +
            "controlsScrollable:controls.scrollWidth>=controls.clientWidth,viewport:innerWidth};})()");
        await cdp.call('Emulation.clearDeviceMetricsOverride');

        // (e) 세이브 스냅샷 — 슬롯 저장 시 meta.uiSettings 동반 여부
        const saveLoadProbe = await cdp.evalJson(
            "(async function(){var out={};var g=window.__game,s=g.getStore();" +
            "var c=document.getElementById('game-canvas'),r=c.getBoundingClientRect(),city=s.getAllCities()[0],p=g.getCityScreenPosition(city.id);" +
            "var x=r.left+p.x*r.width/c.width,y=r.top+p.y*r.height/c.height;" +
            "c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:71,pointerType:'mouse',button:0,buttons:1}));" +
            "c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:71,pointerType:'mouse',button:0,buttons:0}));" +
            // 2026-09-30 두 번 클릭 규칙 — 첫 클릭은 좌측 정보 단만 채우고, 방문 처리는
            // "같은 도시 재클릭 → 진입" 에서 이뤄진다. 한 번만 눌러서는 방문되지 않는다.
            "c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:71,pointerType:'mouse',button:0,buttons:1}));" +
            "c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:71,pointerType:'mouse',button:0,buttons:0}));" +
            "out.visitedAfterClick=(s.getGlobalState().visitedCityIds||[]).indexOf(city.id)>=0;" +
            "if(document.getElementById('cdp-close'))document.getElementById('cdp-close').click();" +
            "var playerCity=s.getAllCities().find(function(c){return c.ownerId===s.getGlobalState().playerFactionId;});" +
            "g.openCity(playerCity.id);g.selectCitySceneBuildingByIndex(0);g.investSelectedCityBuilding();g.closeCity();" +
            "document.getElementById('btn-slots').click();" +
            "var slot=document.querySelector('.ss-slot[data-slot=\"1\"]');" +
            "if(!slot) return {err:'no slot'};slot.click();" +
            "out.saved=!!localStorage.getItem('sik_re_slot_1');" +
            "var payload=JSON.parse(localStorage.getItem('sik_re_slot_1')||'{}');" +
            "out.uiInSave=!!(payload.meta&&payload.meta.uiSettings);" +
            "var mod=await import('./dist/src/core/save_compressor.js');" +
            "var decoded=JSON.parse(new mod.SaveCompressor().decompress(payload.data));" +
            "out.visitedInCompressedSave=(decoded.globalState.visitedCityIds||[]).indexOf(city.id)>=0;" +
            "var payload2=JSON.parse(localStorage.getItem('sik_re_slot_1')||'{}');var decoded2=JSON.parse(new mod.SaveCompressor().decompress(payload2.data));" +
            "out.buildingStateInCompressedSave=!!(decoded2.globalState.cityBuildingStates&&decoded2.globalState.cityBuildingStates[playerCity.id]);" +
            "document.getElementById('ss-close').click();return out;})()");

        const forced = await cdp.evalJson(
            "(function(){var s=window.__game.getStore();var gs=s.getGlobalState();" +
            "var facs=s.getState().factions;var target=(facs[gs.playerFactionId]!==undefined)?gs.playerFactionId:Object.keys(facs)[0];" +
            "var n=0;s.getAllCities().forEach(function(c){if(c.ownerId!==target){s.updateCity(c.id,{ownerId:target});n++;}});" +
            "return {moved:n,target:target};})()");
        await cdp.evaluate("document.getElementById('btn-next-month').click()");
        for (let i = 0; i < 75; i++) {
            const r = await cdp.evaluate("!document.getElementById('btn-next-month').disabled");
            if (r.value) break;
            await delay(200);
        }

        const ending = await cdp.evalJson(
            "(function(){var g=window.__game,ps=g.getPortedSystems();" +
            "return {display:document.getElementById('ending-screen').style.display," +
            "title:(document.getElementById('ending-title')||{}).textContent," +
            "narratives:ps.narrativeManager.getEvents().length};})()");

        // 에러 수집
        const consoleErrors = [];
        const pageErrors = [];
        const notFound = [];
        for (const e of cdp.events) {
            if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
                const a = e.params.args?.[0];
                consoleErrors.push(a?.value !== undefined ? String(a.value) : '<console.error>');
            } else if (e.method === 'Runtime.exceptionThrown') {
                const d = e.params.exceptionDetails ?? {};
                pageErrors.push(d.exception?.description ?? d.text ?? '<exception>');
            } else if (e.method === 'Log.entryAdded' && e.params.entry?.level === 'error') {
                consoleErrors.push(e.params.entry.text ?? '<log.error>');
            } else if (e.method === 'Network.responseReceived' && e.params.response?.status === 404) {
                notFound.push(e.params.response.url ?? '<unknown>');
            }
        }

        // ===== [312] 리플레이 공유→재생 흐름 검증 =====
        // 1. 인-페이지에서 가상 리플레이 로그를 압축 → URL 파라미터 생성
        // 2. 해당 URL로 재내비게이션 → ReplayViewer 자동 재생 확인
        const replayProbe = await cdp.evalJson(
            "(async function(){" +
            "var mod=await import('./dist/src/core/replay_share_manager.js');" +
            "var vm=await import('./dist/src/core/replay_viewer.js');" +
            "var logs=['DEPLOY','MOVE','ATTACK','MOVE','ATTACK'].map(function(a,i){return {" +
            "turn:Math.floor(i/2)+1,officerId:i%2===0?'friendly_1':'enemy_1',actionType:a," +
            "targetId:a==='ATTACK'?(i%2===0?'enemy_1':'friendly_1'):null,value:a==='ATTACK'?200:0,x:i%3,y:Math.floor(i/3)%3};});" +
            "var encoded=await mod.encodeReplayLogs(logs);" +
            "var decoded=await mod.decodeReplayLogs(encoded);" +
            "var viewer=new vm.ReplayViewer({addLog:function(){}});" +
            "var units=viewer.load(decoded);viewer.play();" +
            "for(var i=0;i<40&&!viewer.isFinished;i++){viewer.update(200);}" +
            "return {encoded:encoded.length>0,roundTrip:JSON.stringify(decoded)===JSON.stringify(logs)," +
            "units:units,finished:viewer.isFinished,urlLen:('?replay='+encoded).length};" +
            "})()");

        // ===== [312][461-480] 리플레이 속도 UI: 기본값·선택·다음 프레임·키보드·실제 터치 =====
        // 동일한 UI 모듈을 브라우저에서 검증하고, 속도 적용은 다음 프레임에 뷰어へ 전달되는
        // 실제 main 연결부와 동일한 콜백 경로를 fixture로 확인한다.
        await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        const replayUiProbe = await cdp.evalJson(
            "(async function(){var mod=await import('./dist/src/ui/replay_speed_controls.js'),viewer={speed:1,setSpeed:function(speed){this.speed=speed;}};" +
            "var host=document.createElement('fieldset');host.id='replay-e2e-fixture';host.className='replay-speed-controls';host.style.position='fixed';host.style.left='8px';host.style.top='100px';host.style.zIndex='9999';" +
            "host.innerHTML='<legend>속도</legend><label><input type=radio name=replay-speed value=0.5>0.5x</label><label><input type=radio name=replay-speed value=1 checked>1x</label><label><input type=radio name=replay-speed value=2>2x</label><label><input type=radio name=replay-speed value=4>4x</label>';document.body.appendChild(host);" +
            "var calls=[],controls=new mod.ReplaySpeedControls(host,function(speed){calls.push(speed);host.__replaySpeed=speed;viewer.setSpeed(speed);});controls.reset();controls.setVisible(true);" +
            "var inputs=Array.from(host.querySelectorAll('input[name=replay-speed]')),four=host.querySelector('input[value=\"4\"]'),two=host.querySelector('input[value=\"2\"]'),half=host.querySelector('input[value=\"0.5\"]'),fr=four.getBoundingClientRect(),tr=two.getBoundingClientRect();half.focus();" +
            "return {loaded:!!viewer,defaults:{speed:viewer.speed,selected:(host.querySelector('input:checked')||{}).value,visible:!host.hidden},options:inputs.map(function(i){return i.value;}).join(',')," +
            "fourPoint:{x:Math.round(fr.left+fr.width/2),y:Math.round(fr.top+fr.height/2)},twoPoint:{x:Math.round(tr.left+tr.width/2),y:Math.round(tr.top+tr.height/2)},calls:calls};})()");
        await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: replayUiProbe.fourPoint.x, y: replayUiProbe.fourPoint.y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: replayUiProbe.fourPoint.x, y: replayUiProbe.fourPoint.y, button: 'left', buttons: 0, clickCount: 1 });
        await delay(80);
        const afterClickProbe = await cdp.evalJson(
            "(function(){var host=document.getElementById('replay-e2e-fixture');return {afterClickSelected:(host.querySelector('input:checked')||{}).value,afterClickSpeed:host.__replaySpeed};})()");
        await cdp.evalJson("(function(){document.getElementById('replay-e2e-fixture').querySelector('input[value=\"0.5\"]').focus();})()");
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await delay(80);
        const afterKeyProbe = await cdp.evalJson(
            "(function(){var host=document.getElementById('replay-e2e-fixture');return {afterKeySelected:(host.querySelector('input:checked')||{}).value,afterKeySpeed:host.__replaySpeed};})()");
        await cdp.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: replayUiProbe.twoPoint.x, y: replayUiProbe.twoPoint.y, id: 7 }] });
        await cdp.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await delay(80);
        const touchProbe = await cdp.evalJson(
            "(function(){var host=document.getElementById('replay-e2e-fixture');return {touchSelected:(host.querySelector('input:checked')||{}).value,touchSpeed:host.__replaySpeed};})()");
        const recoveryProbe = await cdp.evalJson(
            "(function(){var host=document.getElementById('replay-e2e-fixture'),bad=host.querySelector('input[value=\"2\"]');bad.value='not-a-speed';bad.checked=true;bad.dispatchEvent(new Event('change',{bubbles:true}));var out={recoverySelected:(host.querySelector('input:checked')||{}).value,recoverySpeed:host.__replaySpeed};host.remove();return out;})()");
        Object.assign(replayUiProbe, afterClickProbe, afterKeyProbe, touchProbe, recoveryProbe);
        await cdp.call('Emulation.clearDeviceMetricsOverride');

        // ===== [49] 도시 진입 화면 — 뷰포트별 배경 채움 실측 ==========================
        // 위의 dialogueProbe 는 1600x1000 창 *하나* 만 본다(그 창이 16:1.x 여서
        // 여백이 10% 로 작게 보인다). 사용자 스크린샷은 ~970x1200 였고, 거기서는
        // @media (max-width:1000px) 분기 + 세로 창이 겹쳐 하단 검정 띠가 57% 까지 찼다.
        // 그래서 아래 7개 뷰포트를 실제로 돌려 "그림이 시야를 다 덮는가" 를 잰다.
        const cityViewportProbe = await (async () => {
            const VIEWS = [[1920, 1080], [1600, 1000], [1440, 900], [1280, 800], [1000, 900], [960, 1200], [800, 600]];
            const rows = [];
            for (const [w, h] of VIEWS) {
                await cdp.call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
                await delay(350);
                // 무대 rect 는 리사이즈 직후 한 프레임 늦게 확정된다.
                await cdp.evalJson("(async function(){return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});})()");
                rows.push(await cdp.evalJson(
                    "(function(){var q=function(s){return document.querySelector(s);};" +
                    "var st=q('#city-scene-stage'),sr=st.getBoundingClientRect();" +
                    // 여백이 남아 있는가: 무대 rect 가 창을 그대로 덮는가.
                    // 2026-10-02 에 여백 백드롭을 걷어냈으므로 이제 무대 하나가 곧 화면이다.
                    "var cw=sr.width,ch=sr.height;" +
                    "var rel=function(sel){var e=q(sel);if(!e)return null;var r=e.getBoundingClientRect();" +
                    "if(r.width<=0&&r.height<=0)return null;" +
                    "return {x:+(r.left-sr.left).toFixed(1),y:+(r.top-sr.top).toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)," +
                    "right:+(r.right-sr.left).toFixed(1),bottom:+(r.bottom-sr.top).toFixed(1)};};return {" +
                    "vw:innerWidth,vh:innerHeight,media1000:matchMedia('(max-width: 1000px)').matches," +
                    "stage:{x:+sr.left.toFixed(1),y:+sr.top.toFixed(1),w:+sr.width.toFixed(1),h:+sr.height.toFixed(1)," +
                    "ratio:+(sr.width/Math.max(1,sr.height)).toFixed(4)}," +
                    "pane:{w:+q('#city-detail-panel .cdp-stage-pane').getBoundingClientRect().width.toFixed(1)," +
                    "h:+q('#city-detail-panel .cdp-stage-pane').getBoundingClientRect().height.toFixed(1)}," +
                    // 무대가 창 밖으로 넘쳤는지 — 앵커가 잘려 나가는 경향의 지표.
                    "overflowPx:+(((Math.max(0,sr.right-innerWidth))+Math.max(0,sr.bottom-innerHeight)"
                    +"+Math.max(0,-sr.left)+Math.max(0,-sr.top))).toFixed(1)," +
                    "uncoveredPct:+(((innerWidth*innerHeight)-(cw*ch))/(innerWidth*innerHeight)*100).toFixed(1)," +
                    "hud:{header:rel('.cdp-header'),sheet:rel('.cdp-scene-sheet'),bottom:rel('.cdp-stage-hud-bottom')}," +
                    "badges:Array.prototype.map.call(document.querySelectorAll('#city-scene-badges .city-badge'),function(b){return b.style.left+','+b.style.top;})};})()"));
            }
            await cdp.call('Emulation.clearDeviceMetricsOverride');
            return rows;
        })();

        // 대화가 모두 끝났으므로 타이포그래피를 돌려놓는다.
        // 이후 프로브는 사람이 보는 그대로의 화면을 검사해야 한다.
        await cdp.evaluate("window.__game.setDialogueInstant(false)");

        const result = { flowProbe, scenario07Probe, captiveBattleProbe, monthlyReportProbe, cityChronicleProbe, chronicleFilterProbe, mapVisibilityProbe, mapScreenshotProbe, mapClickProbe, dialogueProbe, buildingProbe, domesticProbe, progress, graphProbe, a11yProbe, keyboardProbe, mobileProbe, saveLoadProbe, replayProbe, replayUiProbe, authProbe, forced, ending, consoleErrors: consoleErrors.slice(0, 10), notFound: notFound.slice(0, 5), pageErrors: pageErrors.slice(0, 10) };
        console.log(JSON.stringify(result, null, 2));

        const resource404 = consoleErrors.filter((e) => e.includes('Failed to load resource'));
        const otherConsole = consoleErrors.filter((e) => !e.includes('Failed to load resource'));
        const onlyFavicon404 = notFound.length === 0 || notFound.every((u) => u.includes('favicon') || u.endsWith('.ico'));
        const regressionChecks = {
            flow: flowProbe.scenarioFlowOpen && flowProbe.titleBackVisible && flowProbe.factionFlowOpen && flowProbe.scenarioBackAgain && flowProbe.officerFlowOpen && flowProbe.officerCards > 0,
            recruit: flowProbe.recruitProbe?.titleLabels?.length === 3
                && flowProbe.recruitProbe.titleLabels[0] === '시작하기'
                && flowProbe.recruitProbe.titleLabels[1] === '이어하기'
                && flowProbe.recruitProbe.titleLabels[2] === '무장 편집'
                && flowProbe.recruitProbe.editorOpen
                && flowProbe.recruitProbe.existingPainted.portrait
                && flowProbe.recruitProbe.existingPainted.radar
                && flowProbe.recruitProbe.existingPainted.traits >= 1
                && flowProbe.recruitProbe.newPainted.portrait
                && flowProbe.recruitProbe.newPainted.radar
                && flowProbe.recruitProbe.newPainted.deploy === 4
                && flowProbe.recruitProbe.existingStart?.leadership === 99
                && flowProbe.recruitProbe.existingStart?.player === flowProbe.recruitProbe.existingStart?.faction
                && flowProbe.recruitProbe.emptyNameBlocked
                && flowProbe.recruitProbe.randomFilled.birth !== ''
                && flowProbe.recruitProbe.randomFilled.name !== ''
                && flowProbe.recruitProbe.pickProbe.total > 0
                && flowProbe.recruitProbe.pickProbe.playable > 0
                && (flowProbe.recruitProbe.pickProbe.blocked === 0 || flowProbe.recruitProbe.pickProbe.hasReason)
                && flowProbe.recruitProbe.recruitStarted,
            // [결함 수정] length === 6 은 2차도시가 3개뿐이던 옛 스텁 데이터 기준이다.
            // 07 시나리오를 위 4·촉 3·오 3 = 9도시로 보강하면서 깨졌다.
            scenario: scenario07Probe.cityNames.includes('청두') && scenario07Probe.cityNames.length === 24 && scenario07Probe.qingdu === 70 && scenario07Probe.caoPi === 76 && scenario07Probe.relationships === 8 && scenario07Probe.eventProcessed && scenario07Probe.eventText.includes('강완의 안정'),
            captiveBattle: captiveBattleProbe.success === true && captiveBattleProbe.commandType === 'BATTLE' && captiveBattleProbe.captiveOutcomes.length > 0 && captiveBattleProbe.logMessages.some(message => message.includes('포획')) && captiveBattleProbe.chronicleText.some(text => text.includes('포로')),
            monthlyReport: monthlyReportProbe.visible === true && monthlyReportProbe.hasCaptive === true,
            cityChronicle: cityChronicleProbe.hasHistory === true,
            chronicleFilter: chronicleFilterProbe.factionFilters > 0 && chronicleFilterProbe.hasCapture === true,
            // [결함 수정] points === 6 은 2차도시가 3개뿐이던 옛 스텁 데이터 기준.
            // 클릭 대상 도시 수를 전역 도시 수에 맞춰 검증한다.
            map: mapClickProbe.points === mapVisibilityProbe.initial.all && mapVisibilityProbe.initial.mode === 'all' && mapVisibilityProbe.initial.visible === mapVisibilityProbe.initial.all && mapVisibilityProbe.discovered.mode === 'discovered' && mapVisibilityProbe.discovered.visible > 0 && mapVisibilityProbe.discovered.visible < mapVisibilityProbe.discovered.all && mapVisibilityProbe.discovered.factions.length >= 3 && mapVisibilityProbe.restored === 'all',
            screenshot: mapScreenshotProbe.width > 0 && mapScreenshotProbe.height > 0 && mapScreenshotProbe.pngLength > 1000 && mapScreenshotProbe.hashStable && mapScreenshotProbe.corner.length === 4 && mapScreenshotProbe.hasBitmapApi === false && !mapScreenshotProbe.imageRequests.some(url => url.includes('china-national-map')),
            mapClicks: mapClickProbe.results.every(item => item.actual === item.expected && item.sidebarListed === true),
            dialogue: dialogueProbe.facilityOpen && dialogueProbe.facilityCount === 8 && dialogueProbe.facilityNames.some(name => name.includes('훈련장')) && dialogueProbe.officerOpen && dialogueProbe.choices >= 2 && dialogueProbe.giftPreview.includes('옥비') && dialogueProbe.giftPreview.includes('희귀') && dialogueProbe.giftPreview.includes('+14') && dialogueProbe.giftAfterGold === dialogueProbe.giftBeforeGold - 500 && dialogueProbe.giftAfterAffinity !== dialogueProbe.giftBeforeAffinity,
            buildings: buildingProbe.count >= 5 && buildingProbe.selected === true && buildingProbe.invested && buildingProbe.stateCount >= 1,
            domestic: domesticProbe.pending >= 1 && domesticProbe.result.includes('자동 내정'),
            ui: graphProbe.open === 'block' && graphProbe.closed && (graphProbe.rows > 0 || graphProbe.hint === true) && a11yProbe.open === 'block' && a11yProbe.cbActive && keyboardProbe.helpOpen && keyboardProbe.helpClosed && keyboardProbe.paused && keyboardProbe.resumed && mobileProbe.touchAction === 'none' && mobileProbe.canvasWidth > 0 && mobileProbe.viewport === 390,
            persistence: saveLoadProbe.saved && saveLoadProbe.uiInSave && saveLoadProbe.visitedAfterClick && saveLoadProbe.visitedInCompressedSave && saveLoadProbe.buildingStateInCompressedSave,
            replay: replayProbe.encoded && replayProbe.roundTrip && replayProbe.units === 2 && replayProbe.finished && replayProbe.urlLen < 100 * 1024,
            replaySpeedUi: replayUiProbe.loaded
                && replayUiProbe.defaults.visible
                && replayUiProbe.defaults.speed === 1
                && replayUiProbe.defaults.selected === '1'
                && replayUiProbe.options === '0.5,1,2,4'
                && replayUiProbe.afterClickSpeed === 4
                && replayUiProbe.afterClickSelected === '4'
                && replayUiProbe.afterKeySpeed === 0.5
                && replayUiProbe.afterKeySelected === '0.5'
                && replayUiProbe.touchSpeed === 2
                && replayUiProbe.touchSelected === '2'
                && replayUiProbe.recoverySpeed === 1
                && replayUiProbe.recoverySelected === '1',
            // [Auth] 통합 배선: 오프라인 모드 + 게스트 + 프로바이더 전이 + 로그아웃
            auth: authProbe.mounted.ok === true
                && authProbe.mounted.mode === 'offline'
                && authProbe.mounted.state === 'anonymous'
                && authProbe.mounted.panel === 'anonymous'
                && authProbe.guest.status === 'anonymous'
                && authProbe.guest.state === 'anonymous'
                && authProbe.guest.flowState === 'anonymous'
                && authProbe.guest.panel === 'anonymous'
                && authProbe.guest.banner === true
                && authProbe.guest.upgrade === true
                && typeof authProbe.guest.guestId === 'string'
                && authProbe.guest.guestId.length > 0
                && authProbe.guest.guestId === authProbe.guest.flowGuestId
                && authProbe.signedIn.ok === true
                && authProbe.signedIn.state === 'authenticated'
                && authProbe.signedIn.flowState === 'authenticated'
                && authProbe.signedIn.panel === 'authenticated'
                && authProbe.signedIn.userId === true
                && authProbe.signedIn.signOut === true
                && authProbe.signedIn.alert === false
                && authProbe.signedOut.status === 'anonymous'
                && authProbe.signedOut.state === 'anonymous'
                && authProbe.signedOut.flowState === 'anonymous'
                && authProbe.signedOut.guestId === null
                && authProbe.signedOut.flowGuestId === null
                && authProbe.signedOut.panel === 'anonymous'
                && authProbe.signedOut.banner === false,
            ending: ending.display === 'flex' && ending.narratives >= 1,
        };
        console.log('REGRESSION_CHECKS:', JSON.stringify(regressionChecks));
        const cityChecks = {
            sceneSize: dialogueProbe.citySceneWidth === 480 && dialogueProbe.citySceneHeight === 240,
            // 진입 화면 단일 구성: 모드 전환 버튼이 없고, 배경 그림이 실제로 로드됐으며,
            // 16:9 무대가 화면 안에 들어가며, 유리 패널(상단 바·우측 통제 열·하단 무장
            // 스트립)이 그림 위에 겹쳐 보인다. artReady 를 확인하지 않으면 그림이 404
            // 나서 조용히 절차 렌더로 물러나도 테스트는 통과한다 — 실제로 그랬다.
            entryLayout: dialogueProbe.backButton === false
                && dialogueProbe.bleedMode === false
                && dialogueProbe.artReady === true
                && dialogueProbe.artComplete === true
                && /city-scene-base\.webp$/.test(dialogueProbe.artSrc ?? '')
                // 2026-10-02 — 무대는 16:9 고정이 아니라 창 크기 그대로다.
                // 비율은 창 비율이어야 하고, 창 안에 딱 들어 있어야 한다.
                && Math.abs(dialogueProbe.stageBox.ratio - dialogueProbe.stageBox.vw / dialogueProbe.stageBox.vh) < 0.02
                && dialogueProbe.stageBox.fits === true
            && dialogueProbe.layoutPanes.head === true
            && dialogueProbe.layoutPanes.side === true
            // [2026-10-03] 좌·우 레일을 걷어내 그림 위 시트로 대체했다. hudLeft/hudRight 는
            //   검사 대상이 사라졌으므로, 대신 "배지를 누르면 시트가 열리고 내용이 차 있는가"
            //   를 본다 — 닫힌 채로 재면 없는 걸 재는 셈이라 아무것도 검증 못 한다.
            && dialogueProbe.layoutPanes.hudBottom === true
            && dialogueProbe.layoutPanes.sheetOpen === true
            && dialogueProbe.layoutPanes.commander === true
            && dialogueProbe.layoutPanes.commandsInSheet === true
            && dialogueProbe.layoutPanes.factionsInSheet === true
            && dialogueProbe.layoutPanes.officersInSheet === true
            && dialogueProbe.layoutPanes.headerInStage === true
            && dialogueProbe.layoutPanes.commandGroups === 4
            // 사용자가 "5개밖에 없다"고 지적한 목록 — 内政 5 + 支配 2 + 人事 1 + 外交 2 = 10
            && dialogueProbe.layoutPanes.commandLabels.length >= 10
            && dialogueProbe.layoutPanes.commandLabels.some(l => l.indexOf('出征') >= 0)
            && dialogueProbe.layoutPanes.commandLabels.some(l => l.indexOf('登用') >= 0)
            && dialogueProbe.layoutPanes.commandLabels.some(l => l.indexOf('外交') >= 0)
            && dialogueProbe.layoutPanes.facilitiesInStage === true
            && dialogueProbe.layoutPanes.expeditionGone === true
            && dialogueProbe.layoutPanes.recruitGone === true
            && dialogueProbe.layoutPanes.raidGone === true
            && dialogueProbe.layoutPanes.tabsGone === true
            && dialogueProbe.layoutPanes.factionRows === 1
            // 재야 무장 수는 월드 상태에 달려 있다( probed 도시에 재야가 없을 수도 있다).
            // "있을 때 목록에 합쳐진다" 는 성질을 여기서 못 재므로 원래 병합을 단위 테스트로
            // 보장한다( tests/city_officer_roster.test.ts ). 여긴 개수를 보고만 한다.
            && dialogueProbe.layoutPanes.commandCol === true
            && dialogueProbe.layoutPanes.facilityRow === true
            && dialogueProbe.layoutPanes.actions === 0
                && dialogueProbe.layoutPanes.officers >= 1
                && dialogueProbe.layoutPanes.fullBleed === true
                && dialogueProbe.badges.length >= 5,
            entryMode: dialogueProbe.entryMode === true,
            layoutPanes: dialogueProbe.layoutPanes,
            stageBox: dialogueProbe.stageBox,
            removedBlock: dialogueProbe.removedBlock,
        };
        console.log('CITY_CHECKS:', JSON.stringify(cityChecks));
        const ok = pageErrors.length === 0
            && otherConsole.length === 0
            && flowProbe.scenarioFlowOpen === true
            && flowProbe.titleBackVisible === true
            && flowProbe.factionFlowOpen === true
            && flowProbe.scenarioBackAgain === true
            && scenario07Probe.cityNames.includes('청두')
            // [결함 수정] 2차도시 보강으로 6 → 9 (위 4 + 촉 3 + 오 3)
            && scenario07Probe.cityNames.length === 24
            && scenario07Probe.qingdu === 70
            && scenario07Probe.caoPi === 76
            && scenario07Probe.relationships === 8
            && scenario07Probe.eventProcessed === true
            && scenario07Probe.eventText.includes('강완의 안정')
            && captiveBattleProbe.success === true
            && captiveBattleProbe.commandType === 'BATTLE'
            && captiveBattleProbe.captiveOutcomes.length > 0
            && captiveBattleProbe.logMessages.some(message => message.includes('포획'))
            && captiveBattleProbe.chronicleText.some(text => text.includes('포로'))
            && monthlyReportProbe.visible === true
            && monthlyReportProbe.hasCaptive === true
            && cityChronicleProbe.hasHistory === true
            && chronicleFilterProbe.factionFilters > 0
            && chronicleFilterProbe.hasCapture === true
            && mapClickProbe.points === mapVisibilityProbe.initial.all
            && mapVisibilityProbe.initial.mode === 'all'
            && mapVisibilityProbe.initial.visible === mapVisibilityProbe.initial.all
            && mapVisibilityProbe.discovered.mode === 'discovered'
            && mapVisibilityProbe.discovered.visible > 0
            && mapVisibilityProbe.discovered.visible < mapVisibilityProbe.discovered.all
            && mapVisibilityProbe.discovered.factions.length >= 3
            && mapVisibilityProbe.restored === 'all'
            && mapScreenshotProbe.width > 0
            && mapScreenshotProbe.height > 0
            && mapScreenshotProbe.pngLength > 1000
            && mapScreenshotProbe.hashStable === true
            && mapScreenshotProbe.corner.length === 4
            && mapScreenshotProbe.hasBitmapApi === false
            && !mapScreenshotProbe.imageRequests.some(url => url.includes('china-national-map'))
            && mapClickProbe.results.every(item => item.actual === item.expected)
            && dialogueProbe.facilityOpen === true
            && dialogueProbe.facilityCount === 8
            && dialogueProbe.facilityNames.some(name => name.includes('훈련장'))
            && dialogueProbe.officerOpen === true
            && dialogueProbe.choices >= 2
            && dialogueProbe.giftPreview.includes('옥비')
            && dialogueProbe.giftPreview.includes('희귀')
            && dialogueProbe.giftPreview.includes('+14')
            && dialogueProbe.giftAfterGold === dialogueProbe.giftBeforeGold - 500
            && dialogueProbe.giftAfterAffinity !== dialogueProbe.giftBeforeAffinity
            && dialogueProbe.citySceneWidth === 480
            && dialogueProbe.citySceneHeight === 240
            && dialogueProbe.removedBlock.hint === true
            && dialogueProbe.removedBlock.summary === true
            && dialogueProbe.removedBlock.detail === true
            && dialogueProbe.removedBlock.stats === true
            && dialogueProbe.removedBlock.infoPane === true
            && dialogueProbe.removedBlock.loyaltyChip === true
            && dialogueProbe.entryMode === true
            // 진입 화면 단일 구성과 배경 그림 로드를 실제로 판정한다.
            && cityChecks.entryLayout === true
            // 대화창 개편 회귀 [신규 기능]
            && dialogueProbe.dlgPortraitSvg === true
            && dialogueProbe.dlgSpeakerText.length > 0
            && dialogueProbe.dlgOrgText.length > 0
            && dialogueProbe.dlgRankText.length > 0
            && dialogueProbe.dlgBodyText.length > 20
            && dialogueProbe.dlgChoiceIdx >= 1
            && dialogueProbe.dlgPrevDisabled === true
            && dialogueProbe.accent.length > 0
            && dialogueProbe.placeIsGlyph === true
            && dialogueProbe.placeGlyph.length > 0
            // 키보드만으로 다음/이전 이동과 선택지 실행이 된다
            && dialogueProbe.kbdNext !== dialogueProbe.kbdBefore
            && dialogueProbe.kbdPrev === dialogueProbe.kbdBefore
            && dialogueProbe.kbdChoiceShown === true
            && dialogueProbe.kbdChoiceResult.length > 0
            // 상대 슬롯이 비어 있으면 숨겨진다
            && dialogueProbe.dlgRightHidden === true
            // 시장 클릭 -> 명령 패널이 열린다 (민심·상업 + 견문·인재탐색·매매)
            && dialogueProbe.mktOpen === true
            && dialogueProbe.mktTitle.indexOf('시장') >= 0
            && dialogueProbe.mktCh1 === 3
            // 첫 명령(견문)을 고르면 결과가 표시된다
            && dialogueProbe.mktResultShown === true
            && dialogueProbe.mktResult.length > 0
            // 교역소는 물자 5종을 사고팔 수 있다
            && dialogueProbe.trOpen === true
            && dialogueProbe.trRows >= 3
            && dialogueProbe.trGold0 - dialogueProbe.trGold1 === dialogueProbe.trPrice * 10
            && dialogueProbe.trNote.length > 0
            && buildingProbe.count >= 5
            && buildingProbe.selected === true
            && buildingProbe.invested
            && buildingProbe.stateCount >= 1
            && domesticProbe.pending >= 1
            && domesticProbe.result.includes('자동 내정')
            && resource404.length === notFound.length
            && onlyFavicon404
            && progress.length === 4
            && ending.display === 'flex'
            && ending.narratives >= 1
            // [461-480] 신규 UI 검증
            && graphProbe.open === 'block'
            && graphProbe.closed === true
            && (graphProbe.rows > 0 || graphProbe.hint === true)
            && a11yProbe.open === 'block'
            && a11yProbe.cbActive === true
            && keyboardProbe.helpOpen === true
            && keyboardProbe.helpClosed === true
            && keyboardProbe.paused === true
            && keyboardProbe.resumed === true
            && keyboardProbe.iconsRendered === true
            && keyboardProbe.labelsHidden === true
            && mobileProbe.touchAction === 'none'
            && mobileProbe.canvasWidth > 0
            && mobileProbe.viewport === 390
            && saveLoadProbe.saved === true
            && saveLoadProbe.uiInSave === true
            && saveLoadProbe.visitedAfterClick === true
            && saveLoadProbe.visitedInCompressedSave === true
            && saveLoadProbe.buildingStateInCompressedSave === true
            // [312] 리플레이 압축→재생 라운드트립
            && replayProbe.encoded === true
            && replayProbe.roundTrip === true
            && replayProbe.units === 2
            && replayProbe.finished === true
            && replayProbe.urlLen < 100 * 1024
            && replayUiProbe.loaded === true
            && replayUiProbe.defaults.visible === true
            && replayUiProbe.defaults.speed === 1
            && replayUiProbe.defaults.selected === '1'
            && replayUiProbe.options === '0.5,1,2,4'
            && replayUiProbe.afterClickSpeed === 4
            && replayUiProbe.afterClickSelected === '4'
            && replayUiProbe.afterKeySpeed === 0.5
            && replayUiProbe.afterKeySelected === '0.5'
            && replayUiProbe.touchSpeed === 2
            && replayUiProbe.touchSelected === '2'
            && replayUiProbe.recoverySpeed === 1
            && replayUiProbe.recoverySelected === '1'
            // [Auth] 통합 인증 프로브
            && authProbe.mounted.ok === true
            && authProbe.mounted.mode === 'offline'
            && authProbe.mounted.state === 'anonymous'
            && authProbe.mounted.panel === 'anonymous'
            && authProbe.guest.status === 'anonymous'
            && authProbe.guest.state === 'anonymous'
            && authProbe.guest.flowState === 'anonymous'
            && authProbe.guest.panel === 'anonymous'
            && authProbe.guest.banner === true
            && authProbe.guest.upgrade === true
            && typeof authProbe.guest.guestId === 'string'
            && authProbe.guest.guestId.length > 0
            && authProbe.guest.guestId === authProbe.guest.flowGuestId
            && authProbe.signedIn.ok === true
            && authProbe.signedIn.state === 'authenticated'
            && authProbe.signedIn.flowState === 'authenticated'
            && authProbe.signedIn.panel === 'authenticated'
            && authProbe.signedIn.userId === true
            && authProbe.signedIn.signOut === true
            && authProbe.signedIn.alert === false
            && authProbe.signedOut.status === 'anonymous'
            && authProbe.signedOut.state === 'anonymous'
            && authProbe.signedOut.flowState === 'anonymous'
            && authProbe.signedOut.guestId === null
            && authProbe.signedOut.flowGuestId === null
            && authProbe.signedOut.panel === 'anonymous'
            && authProbe.signedOut.banner === false;
        console.log('E2E_RESULT:', ok ? 'PASS' : 'FAIL');
        exitCode = ok ? 0 : 1;
        cdp.sock.destroy();
    } catch (err) {
        console.error('E2E_ERROR:', err.message ?? err);
        exitCode = 2;
    } finally {
        try { chrome.kill(); } catch { /* noop */ }
        server.close();
    }
    process.exit(exitCode);
}

main();
