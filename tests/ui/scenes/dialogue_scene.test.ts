/**
 * 대화 씬 모듈 테스트 (jsdom) [대화 UI]
 *
 * 씬 모듈은 스토어를 모른다. 게임 훅은 주입받으므로 브라우저 없이도
 * "창이 열리는가 / 선택지를 고르면 무엇이 되돌아오는가 / 닫을 때 정리되는가" 를 본다.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDialogueScene, type DialogueScene, type DialogueSceneHooks } from '../../../src/ui/scenes/dialogue_scene.js';
import type { DialogueSceneState } from '../../../src/core/dialogue_transcript.js';

/** 실제 index.html 의 대화창 구조를 본떠 만든 고정본. */
function mountFixture(): void {
    document.body.innerHTML = `
    <div id="dialogue-modal" style="display:none;">
      <div class="dlg-stage">
        <div class="dlg-cast">
          <figure class="dlg-slot dlg-slot-left">
            <div class="dlg-place-portrait" id="dlg-place-portrait"></div>
            <div class="dlg-figure" id="dlg-left-figure"></div>
            <figcaption class="dlg-nameplate"><span id="dlg-left-name"></span></figcaption>
            <div class="dlg-identity"><div id="dlg-left-org"></div><div id="dlg-left-rank"></div></div>
          </figure>
          <figure class="dlg-slot dlg-slot-right">
            <div class="dlg-figure" id="dlg-right-figure"></div>
            <figcaption class="dlg-nameplate"><span id="dlg-right-name"></span></figcaption>
            <div class="dlg-identity"><div id="dlg-right-org"></div><div id="dlg-right-rank"></div></div>
          </figure>
        </div>
        <div class="dlg-bar">
          <span id="dlg-band-speaker"></span>
          <div class="dlg-bar-head">
            <h3 id="dialogue-title"></h3>
            <span id="dialogue-progress-label"></span>
            <button id="dialogue-close"></button>
          </div>
          <div id="dialogue-history" style="display:none;"></div>
          <span class="dlg-speaker-face" id="dlg-speaker-face" style="display:none;"></span>
          <div id="dialogue-text"></div>
          <div id="dialogue-notes" style="display:none;"></div>
          <div id="dialogue-detail"></div>
          <div id="dialogue-trade" style="display:none;"></div>
          <div id="dialogue-choices"></div>
          <button id="dlg-continue"></button>
          <div id="dialogue-result" role="status" style="display:none;"></div>
        </div>
        <footer class="dlg-foot">
          <button id="dialogue-prev"></button>
          <span id="dialogue-page"></span>
          <button id="dialogue-next"></button>
        </footer>
      </div>
    </div>`;
}

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const makeScene = (hooks: DialogueSceneHooks = {}): DialogueScene => createDialogueScene(document.body, hooks);
// 표식 화자(placeMark)를 둔다 — 화자가 없으면 슬롯이 '빈 자리' 로 그려져 이름표도 비기 때문이다.
const simpleState = (text = '“오랜만이옵니다.”'): DialogueSceneState => ({
    pages: [{ title: '알현', speaker: '장수', placeMark: '將', text }],
    index: 0,
});
// ---------------------------------------------------------------- 열기/닫기

describe('창 열기와 닫기', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('열면 창이 보인다', () => {
        scene.open(simpleState());
        expect(el('dialogue-modal').style.display).toBe('flex');
        expect(scene.isOpen()).toBe(true);
    });

    it('닫으면 숨고 상태도 비운다', () => {
        scene.open(simpleState());
        scene.close();
        expect(el('dialogue-modal').style.display).toBe('none');
        expect(scene.isOpen()).toBe(false);
    });

    it('빈 장면 배열은 열지 않는다 (죽은 창을 띄우지 않는다)', () => {
        scene.open({ pages: [], index: 0 });
        expect(scene.isOpen()).toBe(false);
    });

    it('열 때 창을 표시한다 (jsdom 은 focus 를 지원하지 않으므로 표시만 본다)', () => {
        scene.open(simpleState());
        // 실제 브라우저에서 포커스가 이동한다. 여기서는 창이 떴는까지만 확인한다.
        expect(el('dialogue-modal').style.display).toBe('flex');
    });

    it('닫힐 때 onClose 가 한 번만 돈다', () => {
        const onClose = vi.fn();
        scene.open({ pages: [{ title: 't', speaker: 's', text: 'x' }], index: 0, onClose });
        scene.close();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('큐에 넣은 콜백이 닫힌 뒤 정확히 한 번 돈다', () => {
        const after = vi.fn();
        scene.open(simpleState());
        scene.queueAfterClose(after);
        scene.close();
        expect(after).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------- 그리기

describe('장면 그리기', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('제목과 화자를 이름표·띠에 함께 그린다', () => {
        scene.open(simpleState());
        expect(el('dialogue-title').textContent).toBe('알현');
        expect(el('dlg-left-name').textContent).toBe('장수');
        expect(el('dlg-band-speaker').textContent).toBe('장수');
    });

    it('빈 줄 뒤는 참고로 따로 그린다', () => {
        scene.open(simpleState('“쌀값이 올랐소.”\n\n치안 80 · 상업 60'));
        expect(el('dialogue-text').textContent).toBe('“쌀값이 올랐소.”');
        expect(el('dialogue-notes').textContent).toBe('치안 80 · 상업 60');
        expect(el('dialogue-notes').style.display).toBe('block');
    });

    it('참고가 없으면 참고 칸을 숨긴다 (빈 상자를 띄우지 않는다)', () => {
        scene.open(simpleState());
        expect(el('dialogue-notes').style.display).toBe('none');
    });

    it('선택지 번호를 1부터 매긴다', () => {
        scene.open({
            pages: [{
                title: 't', speaker: 's', text: 'x',
                choices: [
                    { id: 'a', label: '고의', description: '하나' },
                    { id: 'b', label: '저의', description: '둘' },
                ],
            }],
            index: 0,
        });
        expect(Array.from(document.querySelectorAll('.dlg-choice-idx')).map(e => e.textContent)).toEqual(['1', '2']);
    });

    it('disabled 선택지는 눌리지 않는다', () => {
        scene.open({
            pages: [{
                title: 't', speaker: 's', text: 'x',
                choices: [{ id: 'a', label: '고의', description: 'd', disabled: true, onSelect: () => 'ok' }],
            }],
            index: 0,
        });
        expect((document.querySelector('.dlg-choice') as HTMLButtonElement).disabled).toBe(true);
    });
});

// ---------------------------------------------------------------- 무대 / 선택지

describe('무대 슬롯', () => {
    beforeEach(() => { mountFixture(); });

    it('무장 id 가 있으면 훅으로 이름·세력·품계를 그린다', () => {
        const scene = makeScene({
            lookupOfficer: () => ({
                id: 'o1', name: '유비', gender: 'M', rank: 5,
                status: 'ACTIVE', factionName: '손씨', factionColor: '#ff0000',
            }),
            renderPortrait: () => '<svg id="p"></svg>',
        });
        scene.open({ pages: [{ title: 't', speaker: '유비', speakerId: 'o1', text: 'x' }], index: 0 });
        expect(el('dlg-left-name').textContent).toBe('유비');
        expect(el('dlg-left-org').textContent).toBe('손씨');
        expect(el('dlg-left-rank').textContent).toBe('5품');
        expect(document.querySelector('#dlg-left-figure svg')).not.toBeNull();
    });

    it('무장을 못 찾으면 표식 글자로 물러선다', () => {
        const scene = makeScene({ lookupOfficer: () => null });
        scene.open({ pages: [{ title: 't', speaker: '시장', placeMark: '市', text: 'x' }], index: 0 });
        expect(el('dlg-left-figure').textContent).toBe('市');
    });

    it('상대가 없으면 우측 슬롯을 비운다', () => {
        const scene = makeScene();
        scene.open({ pages: [{ title: 't', speaker: '주공', text: 'x' }], index: 0 });
        expect((document.querySelector('.dlg-slot-right') as HTMLElement).dataset.empty).toBe('1');
    });
});

describe('선택지', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('고르면 onSelect 의 메시지가 결과칸에 뜬다', () => {
        scene.open({
            pages: [{
                title: 't', speaker: 's', text: 'x',
                choices: [{ id: 'a', label: '고의', description: 'd', onSelect: () => '결과입니다' }],
            }],
            index: 0,
        });
        (document.querySelector('.dlg-choice') as HTMLButtonElement).click();
        expect(el('dialogue-result').textContent).toBe('결과입니다');
        expect(el('dialogue-result').style.display).toBe('block');
    });

    it('고른 선택지는 다시 눌리지 않는다 (더블클릭 방어)', () => {
        const onSelect = vi.fn(() => '결과');
        scene.open({
            pages: [{
                title: 't', speaker: 's', text: 'x',
                choices: [{ id: 'a', label: '고의', description: 'd', onSelect }],
            }],
            index: 0,
        });
        const btn = document.querySelector('.dlg-choice') as HTMLButtonElement;
        btn.click(); btn.click();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------- 키보드

describe('키보드 조작', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    const twoPages = (): DialogueSceneState => ({
        pages: [
            { title: '첫째', speaker: 'a', text: '하나' },
            { title: '둘째', speaker: 'b', text: '둘' },
        ],
        index: 0,
    });

    it('→ 로 다음 장면, ← 로 이전 장면', () => {
        scene.open(twoPages());
        const modal = el('dialogue-modal');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(el('dialogue-page').textContent).toBe('2 / 2');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(el('dialogue-page').textContent).toBe('1 / 2');
    });

    it('처음에서 ← , 끝에서 → 는 넘지 않는다', () => {
        scene.open(twoPages());
        const modal = el('dialogue-modal');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(el('dialogue-page').textContent).toBe('1 / 2');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(el('dialogue-page').textContent).toBe('2 / 2');
    });

    it('숫자키로 해당 번호 선택지를 누른다', () => {
        const first = vi.fn(() => '첫 결과');
        scene.open({
            pages: [{
                title: 't', speaker: 's', text: 'x',
                choices: [
                    { id: 'a', label: '첫째', description: 'd', onSelect: first },
                    { id: 'b', label: '둘째', description: 'd', onSelect: () => '둘 결과' },
                ],
            }],
            index: 0,
        });
        el('dialogue-modal').dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
        expect(first).not.toHaveBeenCalled();
        expect(el('dialogue-result').textContent).toBe('둘 결과');
    });
});

// ---------------------------------------------------------------- 기록

describe('대화 기록', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('한 장면뿐이면 기록 상자를 띄우지 않는다', () => {
        scene.open(simpleState());
        expect(el('dialogue-history').style.display).toBe('none');
    });

    it('두 장면 이상이면 지나온 화질이 보인다', () => {
        // keepTranscript: 연쇄 대화는 장면마다 창을 다시 열면서 기록을 이어받는다.
        scene.open({
            pages: [
                { title: '첫째', speaker: '상인', text: '“쌀값입니다.”' },
                { title: '둘째', speaker: '주공', text: '“값이 비싸소.”' },
            ],
            index: 0,
        }, { keepTranscript: true });
        scene.open({
            pages: [
                { title: '첫째', speaker: '상인', text: '“쌀값입니다.”' },
                { title: '둘째', speaker: '주공', text: '“값이 비싸소.”' },
            ],
            index: 1,
        }, { keepTranscript: true });
        expect(el('dialogue-history').style.display).toBe('block');
        expect(el('dialogue-history').textContent).toContain('쌀값입니다');
    });

    it('keepTranscript 없이 다시 열면 기록은 새로 시작한다', () => {
        const st: DialogueSceneState = {
            pages: [
                { title: '첫째', speaker: '상인', text: '“쌀값입니다.”' },
                { title: '둘째', speaker: '주공', text: '“값이 비싸소.”' },
            ],
            index: 1,
        };
        scene.open(st);
        expect(el('dialogue-history').style.display).toBe('block');
        scene.open(st); // keepTranscript 없음 → 기록 초기화 후 다시 쌓는다
        // 첫 장면부터 다시 쌓이므로 여전히 2줄이다. 과거가 덧씌워지지 않는다.
        const entries = el('dialogue-history').querySelectorAll('.dlg-th-entry').length;
        expect(entries).toBe(2);
    });

    it('keepTranscript 로 열면 앞 장면 기록이 이어진다', () => {
        const st: DialogueSceneState = {
            pages: [
                { title: '첫째', speaker: '상인', text: '“쌀값입니다.”' },
                { title: '둘째', speaker: '주공', text: '“값이 비싸소.”' },
            ],
            index: 0,
        };
        scene.open(st, { keepTranscript: true });
        scene.open({ ...st, index: 1 }, { keepTranscript: true });
        const entries = el('dialogue-history').querySelectorAll('.dlg-th-entry').length;
        expect(entries).toBe(2);
    });

    it('닫으면 기록이 비워진다 (다음 대화에 새면 안 된다)', () => {
        scene.open({
            pages: [
                { title: '첫째', speaker: '상인', text: '“쌀값입니다.”' },
                { title: '둘째', speaker: '주공', text: '“값이 비싸소.”' },
            ],
            index: 1,
        });
        scene.close();
        expect(el('dialogue-history').style.display).toBe('none');
        expect(el('dialogue-history').textContent).toBe('');
    });
});

// ---------------------------------------------------------------- 타이포그래피 / TTS / 선물

describe('타이포그래피와 음성', () => {
    beforeEach(() => { mountFixture(); });

    it('typewriter 가 false 면 대사를 한 번에 다 보여준다', () => {
        const scene = makeScene({ typewriter: () => false });
        scene.open(simpleState('“오랜만이옵니다.”'));
        expect(el('dialogue-text').textContent).toBe('“오랜만이옵니다.”');
        expect(scene.isRevealDone()).toBe(true);
    });

    it('setForceInstant(true) 로 즉시 표시로 고정한다 (E2E 용)', () => {
        const scene = makeScene({ typewriter: () => true });
        scene.setForceInstant(true);
        scene.open(simpleState('“오랜만이옵니다.”'));
        expect(el('dialogue-text').textContent).toBe('“오랜만이옵니다.”');
    });

    it('speak 훅은 화면 조각이 아니라 전체 대사를 받는다', () => {
        const speak = vi.fn();
        const scene = makeScene({ speak });
        scene.open(simpleState('“오랜만이옵니다.”'));
        expect(speak).toHaveBeenCalledTimes(1);
        expect(speak.mock.calls[0][0].text).toBe('오랜만이옵니다.');
    });
});

describe('선물 구성기', () => {
    beforeEach(() => { mountFixture(); });

    const giftState: DialogueSceneState = {
        pages: [{
            title: '선물', speaker: '주공', text: '무엇을 드릴까',
            giftComposer: { actorId: 'me', targetId: 'you', currentAffinity: 10 },
        }],
        index: 0,
    };

    it('아이템 목록과 예상 우호도를 채운다', () => {
        const scene = makeScene();
        scene.setGiftItems([{ id: 'JADE', name: '옥비', gradeLabel: '희귀', affinity: 9 }]);
        scene.open(giftState);
        const sel = document.querySelector('[data-gift-item]') as HTMLSelectElement;
        expect(sel.options[0].textContent).toContain('옥비');
        expect(document.querySelector('[data-gift-preview]')?.textContent).toContain('예상 우호도');
    });

    it('보내면 sendGift 훅이 호출되고 로그를 남긴다', () => {
        const sendGift = vi.fn(() => ({ ok: true, message: '보냈습니다' }));
        const log = vi.fn();
        const scene = makeScene({ sendGift, log });
        scene.setGiftItems([{ id: 'JADE', name: '옥비', gradeLabel: '희귀', affinity: 9 }]);
        scene.open(giftState);
        (document.querySelector('[data-gift-send]') as HTMLButtonElement).click();
        expect(sendGift.mock.calls[0][0]).toMatchObject({ actorId: 'me', targetId: 'you' });
        expect(log).toHaveBeenCalledWith('보냈습니다');
    });

    it('실패하면 로그를 남기지 않는다', () => {
        const log = vi.fn();
        const scene = makeScene({ sendGift: () => ({ ok: false, message: '금화가 부족합니다' }), log });
        scene.open(giftState);
        (document.querySelector('[data-gift-send]') as HTMLButtonElement).click();
        expect(log).not.toHaveBeenCalled();
        expect(el('dialogue-result').textContent).toBe('금화가 부족합니다');
    });
});

// ---------------------------------------------------------------- 방어

describe('결함 방어', () => {
    beforeEach(() => { mountFixture(); });

    it('필요한 요소가 없으면 즉시 알린다 (조용히 죽지 않는다)', () => {
        document.body.innerHTML = '<div id="dialogue-modal"></div>';
        expect(() => createDialogueScene(document.body)).toThrow(/대화창 요소가 없습니다/);
    });

    it('게임 훅 없이도 동작한다 (스토어를 몰라도 된다)', () => {
        const scene = makeScene();
        expect(() => scene.open(simpleState())).not.toThrow();
        expect(scene.isOpen()).toBe(true);
    });

    it('#dialogue-modal 자체를 root 로 넘겨도 된다', () => {
        const scene = createDialogueScene(document.getElementById('dialogue-modal') as HTMLElement);
        scene.open(simpleState());
        expect(scene.isOpen()).toBe(true);
    });

    it('surface() 로 창과 닫기 버튼을 얻는다 — Esc 처리가 이걸 본다', () => {
        const scene = makeScene();
        const s = scene.surface();
        expect(s.panel.id).toBe('dialogue-modal');
        expect(s.closeButton.id).toBe('dialogue-close');
    });

    it('surface 의 닫기 버튼을 누르면 창이 닫힌다', () => {
        const scene = makeScene();
        scene.open(simpleState());
        scene.surface().closeButton.click();
        expect(scene.isOpen()).toBe(false);
    });
// ---------------------------------------------------------------- 게임이 밀어넣는 것들

describe('내비게이션 표시 (게임이 결정한다)', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('canAdvance 로 계속 화살표를 살리고 흔든다', () => {
        scene.open(simpleState());
        scene.setNavState({ canAdvance: true, canGoBack: false, pageLabel: '방문 2' });
        const cont = document.getElementById('dlg-continue') as HTMLButtonElement;
        expect(cont.disabled).toBe(false);
        expect(cont.classList.contains('dlg-bouncing')).toBe(true);
    });

    it('canAdvance 가 false 면 화살표를 잠근다', () => {
        scene.open(simpleState());
        scene.setNavState({ canAdvance: false, canGoBack: true, pageLabel: '' });
        const cont = document.getElementById('dlg-continue') as HTMLButtonElement;
        expect(cont.disabled).toBe(true);
        expect(cont.classList.contains('dlg-bouncing')).toBe(false);
    });

    it('canGoBack 으로 ◀ 버튼을 살린다', () => {
        scene.open(simpleState());
        const prev = document.getElementById('dialogue-prev') as HTMLButtonElement;
        scene.setNavState({ canAdvance: false, canGoBack: false, pageLabel: '' });
        expect(prev.disabled).toBe(true);
        scene.setNavState({ canAdvance: false, canGoBack: true, pageLabel: '' });
        expect(prev.disabled).toBe(false);
    });

    it('게임이 준 페이지 표시를 쓴다', () => {
        scene.open(simpleState());
        scene.setNavState({ canAdvance: false, canGoBack: false, pageLabel: '방문 7' });
        expect(el('dialogue-page').textContent).toBe('방문 7');
    });

    it('게임이 준 표시는 다음 장면을 그릴 때도 유지된다', () => {
        scene.open(simpleState());
        scene.setNavState({ canAdvance: true, canGoBack: true, pageLabel: '방문 3' });
        // 연쇄 대화는 매 장면마다 창을 다시 연다
        scene.open(simpleState('둘째 대사'), { keepTranscript: true });
        expect(el('dialogue-page').textContent).toBe('방문 3');
    });

    it('닫으면 표시가 지워진다 — 다음 대화에 새면 안 된다', () => {
        scene.open(simpleState());
        scene.setNavState({ canAdvance: true, canGoBack: true, pageLabel: '방문 9' });
        scene.close();
        scene.open(simpleState('새 대화'));
        expect(el('dialogue-page').textContent).toContain('/');
        expect(el('dialogue-page').textContent).not.toContain('방문 9');
    });
});

describe('교역 패널 (게임이 수치를 만든다)', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('renderTrade 로 내용을 갈아끼우고 띄운다', () => {
        scene.open(simpleState());
        scene.renderTrade('<div class="dlg-trade-head">보유 500金</div>');
        const trade = el('dialogue-trade');
        expect(trade.style.display).toBe('flex');
        expect(trade.textContent).toContain('보유 500金');
    });

    it('hideTrade 로 감추고 비운다', () => {
        scene.open(simpleState());
        scene.renderTrade('<div>내용</div>');
        scene.hideTrade();
        const trade = el('dialogue-trade');
        expect(trade.style.display).toBe('none');
        expect(trade.innerHTML).toBe('');
    });

    it('빈 문자열을 밀어넣으면 숨겨진다', () => {
        scene.open(simpleState());
        scene.renderTrade('');
        expect(el('dialogue-trade').style.display).toBe('none');
    });

    it('매입 버튼 클릭이 runTrade 훅으로 전달된다', () => {
        const runTrade = vi.fn();
        const sceneWithHook = createDialogueScene(document.body, { runTrade });
        sceneWithHook.open(simpleState());
        sceneWithHook.renderTrade('<button data-trade-buy="GRAIN">매입</button>');
        (document.querySelector('[data-trade-buy]') as HTMLButtonElement).click();
        expect(runTrade).toHaveBeenCalledWith('GRAIN', 'buy');
    });

    it('매도 버튼도 같은 경로로 전달된다', () => {
        const runTrade = vi.fn();
        const sceneWithHook = createDialogueScene(document.body, { runTrade });
        sceneWithHook.open(simpleState());
        sceneWithHook.renderTrade('<button data-trade-sell="SILK">매도</button>');
        (document.querySelector('[data-trade-sell]') as HTMLButtonElement).click();
        expect(runTrade).toHaveBeenCalledWith('SILK', 'sell');
    });
});

describe('결과줄', () => {
    it('showResult 로 한 줄 띄운다', () => {
        const scene = makeScene();
        scene.open(simpleState());
        scene.showResult('쌀 10자 매입 (200金)');
        expect(el('dialogue-result').textContent).toBe('쌀 10자 매입 (200金)');
        expect(el('dialogue-result').style.display).toBe('block');
    });
});

    it('닫고 다시 열어도 리스너가 늘지 않는다', () => {
        const scene = makeScene();
        const onSelect = vi.fn(() => '결과');
        const st: DialogueSceneState = {
            pages: [{ title: 't', speaker: 's', text: 'x', choices: [{ id: 'a', label: '고의', description: 'd', onSelect }] }],
            index: 0,
        };
        scene.open(st);
        scene.close();
        scene.open(st);
        (document.querySelector('.dlg-choice') as HTMLButtonElement).click();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------- 참고 줄

describe('참고 줄', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    it('detail 이 있으면 그리고, 없으면 숨긴다', () => {
        scene.open(simpleState('대사만'));
        expect(el('dialogue-detail').style.display).toBe('none');
        scene.open({
            pages: [{ title: 't', speaker: 's', text: 'x', detail: ['우호도 +4'] }],
            index: 0,
        });
        expect(el('dialogue-detail').style.display).toBe('grid');
        expect(el('dialogue-detail').textContent).toContain('우호도 +4');
    });

    it('여러 장면이면 단계·페이지 표시가 나온다', () => {
        scene.open({
            pages: [
                { title: '첫째', speaker: 'a', text: '하나' },
                { title: '둘째', speaker: 'b', text: '둘' },
            ],
            index: 0,
        });
        expect(el('dialogue-page').textContent).toBe('1 / 2');
        expect(el('dialogue-progress-label').textContent).toContain('1 / 2');
    });
});

// ---------------------------------------------------------------- 단계 대화 (steps)

describe('단계 대화 (steps)', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    const stepsState = (): DialogueSceneState => ({
        pages: [{
            title: '입성', speaker: '성문지기', placeMark: '邑',
            text: '첫째 대사 둘째 대사 셋째 대사',
            steps: ['첫째 대사', '둘째 대사', '셋째 대사'],
        }],
        index: 0,
    });

    it('열면 첫 단계가 바로 보인다', () => {
        scene.open(stepsState());
        expect(el('dialogue-text').textContent).toBe('첫째 대사');
        expect(el('dialogue-progress-label').textContent).toBe('대화 1 / 3');
    });

    it('클릭하면 다음 단계로 교체된다 (누적되지 않는다)', () => {
        scene.open(stepsState());
        el('dialogue-text').click();
        expect(el('dialogue-text').textContent).toBe('둘째 대사');
        el('dialogue-text').click();
        expect(el('dialogue-text').textContent).toBe('셋째 대사');
    });

    it('마지막 단계에서 클릭해도 그대로다', () => {
        scene.open(stepsState());
        el('dialogue-text').click();
        el('dialogue-text').click();
        el('dialogue-text').click();
        expect(el('dialogue-text').textContent).toBe('셋째 대사');
    });

    it('첫 단계에서 ◀ 이전은 비활성, 둘째 단계에서 활성', () => {
        scene.open(stepsState());
        const prev = document.getElementById('dialogue-prev') as HTMLButtonElement;
        expect(prev.disabled).toBe(true);
        el('dialogue-text').click();
        expect(prev.disabled).toBe(false);
    });

    it('마지막 단계에서 ▶ 다음은 비활성', () => {
        scene.open(stepsState());
        const next = document.getElementById('dialogue-next') as HTMLButtonElement;
        expect(next.disabled).toBe(false);
        el('dialogue-text').click();
        el('dialogue-text').click();
        expect(next.disabled).toBe(true);
    });

    it('◀▶ 버튼으로 단계를 오간다', () => {
        scene.open(stepsState());
        const prev = document.getElementById('dialogue-prev') as HTMLButtonElement;
        const next = document.getElementById('dialogue-next') as HTMLButtonElement;
        next.click();
        expect(el('dialogue-text').textContent).toBe('둘째 대사');
        next.click();
        expect(el('dialogue-text').textContent).toBe('셋째 대사');
        prev.click();
        expect(el('dialogue-text').textContent).toBe('둘째 대사');
        prev.click();
        expect(el('dialogue-text').textContent).toBe('첫째 대사');
        expect(prev.disabled).toBe(true);
    });

    it('→ 키로 다음 단계, ← 키로 이전 단계', () => {
        scene.open(stepsState());
        const modal = el('dialogue-modal');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(el('dialogue-text').textContent).toBe('둘째 대사');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(el('dialogue-text').textContent).toBe('첫째 대사');
    });

    it('스페이스로 다음 단계로 진행한다', () => {
        scene.open(stepsState());
        const modal = el('dialogue-modal');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(el('dialogue-text').textContent).toBe('둘째 대사');
    });

    it('단계 모드에서 speak 훅은 전체가 아니라 현재 단계만 받는다', () => {
        const speak = vi.fn();
        const sceneWithHook = makeScene({ speak });
        sceneWithHook.open(stepsState());
        expect(speak.mock.calls[0][0].text).toBe('첫째 대사');
        el('dialogue-text').click();
        expect(speak.mock.calls[1][0].text).toBe('둘째 대사');
    });

    it('푸터 표시도 대화 단계를 따른다 (1/3 → 2/3 → 3/3)', () => {
        scene.open(stepsState());
        expect(el('dialogue-page').textContent).toBe('1 / 3');
        el('dialogue-text').click();
        expect(el('dialogue-page').textContent).toBe('2 / 3');
        el('dialogue-text').click();
        expect(el('dialogue-page').textContent).toBe('3 / 3');
    });

    it('hideFooter 장면에서는 하단 바가 숨고, 아니면 보인다', () => {
        scene.open({
            pages: [{ title: '성문', speaker: 's', text: 'x', hideFooter: true }],
            index: 0,
        });
        expect(document.querySelector('.dlg-foot')?.style.display).toBe('none');
        scene.open(simpleState());
        expect(document.querySelector('.dlg-foot')?.style.display).toBe('');
    });

    it('steps 가 없으면 기존처럼 본문을 통으로 보여준다', () => {
        scene.open(simpleState('“오랜만이옵니다.”'));
        expect(el('dialogue-text').textContent).toBe('“오랜만이옵니다.”');
        expect(el('dialogue-progress-label').textContent).toBe('');
    });
});

// ---------------------------------------------------------------- 선택 확정 모드 (selectChoice)

describe('선택 확정 모드 (selectChoice)', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    const selectState = (repairFn: () => string = () => '보수했다'): DialogueSceneState => ({
        pages: [
            {
                title: '입성', speaker: '성문지기', placeMark: '邑',
                text: '첫째 대사 둘째 대사',
                steps: ['첫째 대사', '둘째 대사'],
                selectChoice: true,
                choicePrompt: '업무 또는 방문 계획이 있으신가',
                choices: [
                    { id: 'repair', label: '성벽 보수', description: '수리', onSelect: repairFn },
                    { id: 'visit', label: '도시 방문', description: '이동', advanceOnConfirm: true },
                ],
            },
            {
                title: '이동', speaker: '성문지기', placeMark: '門',
                text: '어디로 갈까',
                choices: [
                    { id: 'travel', label: '다른 도시로 이동한다', description: '지도', onSelect: () => '떠난다' },
                ],
            },
        ],
        index: 0,
    });

    const contBtn = (): HTMLButtonElement => document.getElementById('dlg-continue') as HTMLButtonElement;
    const choiceBtns = (): HTMLButtonElement[] =>
        [...document.querySelectorAll('.dlg-choice')] as HTMLButtonElement[];

    it('고르기 전에는 ▶가 잠겨 있다', () => {
        scene.open(selectState());
        expect(contBtn().disabled).toBe(true);
    });

    it('선택지를 누르면 고르기만 하고 실행하지 않는다', () => {
        const repairFn = vi.fn(() => '보수했다');
        scene.open(selectState(repairFn));
        const [first] = choiceBtns();
        first.click();
        expect(repairFn).not.toHaveBeenCalled();
        expect(first.classList.contains('dlg-choice-selected')).toBe(true);
        // 단계를 다 보기 전이라 ▶는 아직 잠김
        expect(contBtn().disabled).toBe(true);
    });

    it('단계를 다 보고 고르면 ▶가 살아난다', () => {
        scene.open(selectState());
        el('dialogue-text').click();
        choiceBtns()[0].click();
        expect(contBtn().disabled).toBe(false);
        expect(contBtn().classList.contains('dlg-bouncing')).toBe(true);
    });

    it('▼ 확정하면 onSelect가 실행되고 결과·잠금이 남는다', () => {
        const repairFn = vi.fn(() => '보수했다');
        scene.open(selectState(repairFn));
        el('dialogue-text').click();
        const [first] = choiceBtns();
        first.click();
        contBtn().click();
        expect(repairFn).toHaveBeenCalledTimes(1);
        expect(el('dialogue-result').textContent).toBe('보수했다');
        expect(el('dialogue-result').style.display).toBe('block');
        expect(first.disabled).toBe(true);
        expect(contBtn().disabled).toBe(true);
    });

    it('advanceOnConfirm 선택지를 확정하면 다음 장면으로 넘어간다', () => {
        scene.open(selectState());
        el('dialogue-text').click();
        choiceBtns()[1].click();
        contBtn().click();
        expect(el('dialogue-title').textContent).toBe('이동');
        expect(el('dialogue-page').textContent).toBe('2 / 2');
    });

    it('choicePrompt가 선택지 위에 그려진다', () => {
        scene.open(selectState());
        expect(document.querySelector('.dlg-choice-prompt')?.textContent)
            .toBe('업무 또는 방문 계획이 있으신가');
    });

    it('스페이스로 단계를 다 보고 선택이 있으면 ▶ 확정과 같다', () => {
        const repairFn = vi.fn(() => '보수했다');
        scene.open(selectState(repairFn));
        const modal = el('dialogue-modal');
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        choiceBtns()[0].click();
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(repairFn).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------- 무조작 자동 닫기

describe('무조작 자동 닫기', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('30초 동안 조작이 없으면 닫힌다', () => {
        scene.open(simpleState());
        expect(scene.isOpen()).toBe(true);
        vi.advanceTimersByTime(30_000);
        expect(scene.isOpen()).toBe(false);
        expect(el('dialogue-modal').style.display).toBe('none');
    });

    it('조작하면 타이머가 리셋된다', () => {
        scene.open(simpleState());
        vi.advanceTimersByTime(20_000);
        el('dialogue-modal').dispatchEvent(new Event('pointerdown', { bubbles: true }));
        vi.advanceTimersByTime(20_000);
        expect(scene.isOpen()).toBe(true);
        vi.advanceTimersByTime(10_000);
        expect(scene.isOpen()).toBe(false);
    });

    it('닫으면 타이머가 멈춘다', () => {
        scene.open(simpleState());
        scene.close();
        vi.advanceTimersByTime(60_000);
        expect(scene.isOpen()).toBe(false);
    });

    it('autoCloseMs 가 있으면 그 시간으로 닫힌다', () => {
        scene.open({ pages: [{ title: '입성', speaker: 's', text: '어서 오시오', autoCloseMs: 3000 }], index: 0 });
        vi.advanceTimersByTime(2_999);
        expect(scene.isOpen()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(scene.isOpen()).toBe(false);
    });
});

// ---------------------------------------------------------------- 닫기 전용 인사말

describe('닫기 전용 인사말 (dismissOnClick)', () => {
    let scene: DialogueScene;
    beforeEach(() => { mountFixture(); scene = makeScene(); });

    const greeting = (): DialogueSceneState => ({
        pages: [{ title: '입성', speaker: 's', text: '어서 오시오', hideFooter: true, dismissOnClick: true }],
        index: 0,
    });

    it('본문을 클릭하면 닫힌다', () => {
        scene.open(greeting());
        el('dialogue-text').click();
        expect(scene.isOpen()).toBe(false);
    });

    it('플래그가 없으면 본문 클릭에 닫히지 않는다', () => {
        scene.open(simpleState());
        el('dialogue-text').click();
        expect(scene.isOpen()).toBe(true);
    });
});

// ---------------------------------------------------------------- 화자 화상

describe('화자 화상 (dlg-speaker-face)', () => {
    const officerHooks = (): DialogueSceneHooks => ({
        lookupOfficer: (id: string) => id === 'off_1'
            ? { id: 'off_1', name: '장수', gender: 'M', rank: 5, status: '장수', factionName: '위', factionColor: '#123456' }
            : null,
        renderPortrait: (args: { id: string }) => `<svg data-face="${args.id}"></svg>`,
    });

    it('speakerId 실존 무장이면 화상이 보인다', () => {
        mountFixture();
        const faceScene = makeScene(officerHooks());
        faceScene.open({ pages: [{ title: '시장', speaker: '장수', speakerId: 'off_1', text: '어서 오시오' }], index: 0 });
        const face = document.getElementById('dlg-speaker-face') as HTMLElement;
        expect(face.style.display).toBe('');
        expect(face.innerHTML).toContain('data-face="off_1"');
    });

    it('speakerId 가 없으면 화상이 숨는다', () => {
        mountFixture();
        const faceScene = makeScene(officerHooks());
        faceScene.open(simpleState());
        const face = document.getElementById('dlg-speaker-face') as HTMLElement;
        expect(face.style.display).toBe('none');
        expect(face.innerHTML).toBe('');
    });

    it('훅이 없어도 죽지 않는다', () => {
        mountFixture();
        const bare = makeScene();
        bare.open({ pages: [{ title: '시장', speaker: '장수', speakerId: 'off_1', text: '어서 오시오' }], index: 0 });
        expect((document.getElementById('dlg-speaker-face') as HTMLElement).style.display).toBe('none');
    });
});
