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
          <div id="dialogue-text"></div>
          <div id="dialogue-notes" style="display:none;"></div>
          <div id="dialogue-detail"></div>
          <div id="dialogue-trade" style="display:none;"></div>
          <div id="dialogue-choices"></div>
          <button id="dlg-continue"></button>
          <div id="dialogue-result" role="status" style="display:none;"></div>
        </div>
        <footer>
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
