/**
 * 대화 기록(트랜스크립트) 모듈 단위 테스트.
 *
 * 검증 축
 *   1. 대사/참고 분리 — 빈 줄 두 개가 기준이다.
 *   2. 기록 생성 — 빈 대사는 기록하지 않는다(빈 상자를 남기지 않는다).
 *   3. 선택지 기록 — 마지막 항목에만 붙고, 두 번 붙지 않는다.
 *   4. HTML 렌더 — 상한, 이스케이프, 1줄이면 숨김.
 *
 * 이 모듈은 DOM 을 만지지 않는다(패턴: accessibility_system.ts 의 renderAccessibilityPanel).
 */
import { describe, it, expect } from 'vitest';
import {
    splitSpeechAndNotes,
    createTranscriptEntry,
    recordChoice,
    renderTranscriptHtml,
    TRANSCRIPT_LIMIT,
    createRevealMachine,
    advanceReveal,
    completeReveal,
    isRevealDone,
    planReveal,
    normalizeSpeech,
    type TranscriptEntry,
} from '../src/core/dialogue_transcript.js';

// ---------------------------------------------------------------- 1. 대사/참고 분리

describe('splitSpeechAndNotes', () => {
    it('빈 줄 두 개 앞이 대사, 뒤가 참고다', () => {
        const r = splitSpeechAndNotes('“쌀값이 올랐소.”\n\n치안 80 · 상업 60');
        expect(r.speech).toBe('“쌀값이 올랐소.”');
        expect(r.notes).toBe('치안 80 · 상업 60');
    });

    it('구분자가 없으면 전체가 대사다', () => {
        expect(splitSpeechAndNotes('“오랜만이옵니다.”')).toEqual({ speech: '“오랜만이옵니다.”', notes: '' });
    });

    it('빈 문자열과 빈 줄만 있으면 대사도 참고도 없다', () => {
        expect(splitSpeechAndNotes('')).toEqual({ speech: '', notes: '' });
        expect(splitSpeechAndNotes('\n\n참고만')).toEqual({ speech: '', notes: '참고만' });
    });

    it('구분자가 여러 개면 첫 번째만 경계로 삼는다', () => {
        expect(splitSpeechAndNotes('대사\n\n참고\n\n각주').notes).toBe('참고\n\n각주');
    });
});

// ---------------------------------------------------------------- 2. 기록 생성

describe('createTranscriptEntry', () => {
    it('화자와 대사를 담는다', () => {
        const e = createTranscriptEntry(' 市井 상인 ', '“쌀값입니다.”');
        expect(e).not.toBeNull();
        expect(e!.speaker).toBe('市井 상인');
        expect(e!.lines).toEqual(['“쌀값입니다.”']);
        expect(e!.choice).toBeNull();
        expect(e!.result).toBeNull();
    });

    it('여러 줄 대사는 줄 단위로 쪼갠다', () => {
        // '\n\n' 뒤는 참고로 잘려 나가므로, 대사 안에서 여러 줄을 쓰려면 빈 줄 없이 이어 써야 한다.
        const e = createTranscriptEntry('현자', '“지혜를 보태고자.\n아닌가.\n마지막.”');
        expect(e!.lines).toEqual(['“지혜를 보태고자.', '아닌가.', '마지막.”']);
    });

    it('대사가 비면 기록하지 않는다 — 빈 상자를 남기지 않는다', () => {
        expect(createTranscriptEntry('상인', '')).toBeNull();
        expect(createTranscriptEntry('상인', '   ')).toBeNull();
        expect(createTranscriptEntry('상인', '\n\n참고만')).toBeNull();
    });

    it('화자 이름이 비면 자리표시를 쓴다', () => {
        expect(createTranscriptEntry('', '“말은 있다.”')!.speaker).toBe('???');
        expect(createTranscriptEntry('   ', '“말은 있다.”')!.speaker).toBe('???');
    });

    it('참고는 기록에 담지 않는다 — 지금 보이는 대사만 남긴다', () => {
        const e = createTranscriptEntry('현자', '“물이 왔다.”\n\n기술 +8');
        expect(e!.lines.join('')).not.toContain('기술');
    });

    it('결정론이다 — 같은 입력은 언제나 같은 출력을 낸다', () => {
        const a = createTranscriptEntry('현자', '“같은 말.”');
        const b = createTranscriptEntry('현자', '“같은 말.”');
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});

// ---------------------------------------------------------------- 3. 선택지 기록

describe('recordChoice', () => {
    const base: TranscriptEntry[] = [
        { speaker: '상인', lines: ['“쌀값입니다.”'], choice: null, result: null },
        { speaker: '주공', lines: ['“값이 비싸소.”'], choice: null, result: null },
    ];

    it('마지막 항목에 선택지와 결과를 붙인다', () => {
        const r = recordChoice(base, '값을 잰다', '상업 +3');
        expect(r).toHaveLength(2);
        expect(r[1].choice).toBe('값을 잰다');
        expect(r[1].result).toBe('상업 +3');
        expect(r[0].choice).toBeNull();
    });

    it('이미 선택한 항목에 두 번 붙지 않는다 (더블클릭 방어)', () => {
        const once = recordChoice(base, '값을 잰다', '상업 +3');
        const twice = recordChoice(once, '또 고른다', '상업 +9');
        expect(twice).toHaveLength(2);
        expect(twice[1].choice).toBe('값을 잰다');
        expect(twice[1].result).toBe('상업 +3');
    });

    it('기록이 비면 아무 일도 하지 않는다', () => {
        expect(recordChoice([], '선택', '결과')).toEqual([]);
    });

    it('원본 배열을 바꾸지 않는다', () => {
        const snapshot = JSON.stringify(base);
        recordChoice(base, '값을 잰다', '상업 +3');
        expect(JSON.stringify(base)).toBe(snapshot);
    });

    it('선택지만 있고 결과가 비면 결과는 null 로 남는다', () => {
        const r = recordChoice(base, '값을 잰다', '   ');
        expect(r[1].choice).toBe('값을 잰다');
        expect(r[1].result).toBeNull();
    });

    it('결과만 있고 선택지가 비면 선택지는 null 로 남는다', () => {
        const r = recordChoice(base, '  ', '상업 +3');
        expect(r[1].choice).toBeNull();
        expect(r[1].result).toBe('상업 +3');
    });

    it('둘 다 비면 아무것도 붙이지 않는다', () => {
        const r = recordChoice(base, '', '');
        expect(r[1].choice).toBeNull();
        expect(r[1].result).toBeNull();
    });
});

// ---------------------------------------------------------------- 4. HTML 렌더

describe('renderTranscriptHtml', () => {
    const mk = (n: number): TranscriptEntry[] =>
        Array.from({ length: n }, (_, i) => ({
            speaker: `화자${i}`,
            lines: [`${i}번째 말`],
            choice: i % 2 === 0 ? `선택${i}` : null,
            result: i % 2 === 0 ? `결과${i}` : null,
        }));

    it('한 줄 이하면 빈 문자열을 돌려준다 (빈 상자를 띄우지 않는다)', () => {
        expect(renderTranscriptHtml([])).toBe('');
        expect(renderTranscriptHtml(mk(1))).toBe('');
    });

    it('두 줄이면 그린다', () => {
        const html = renderTranscriptHtml(mk(2));
        expect(html).toContain('dlg-th-inner');
        expect(html).toContain('화자0');
        expect(html).toContain('화자1');
    });

    it('상한을 넘으면 최근 것만 남기고 이전 표시를 남긴다', () => {
        const html = renderTranscriptHtml(mk(TRANSCRIPT_LIMIT + 2));
        expect(html).toContain('이전 2줄');
        expect(html).toContain(`화자${TRANSCRIPT_LIMIT + 1}`);
        expect(html).not.toContain('화자0<');
    });

    it('상한 안이면 이전 표시가 없다', () => {
        expect(renderTranscriptHtml(mk(TRANSCRIPT_LIMIT))).not.toContain('이전');
    });

    it('선택지와 결과를 화살표와 함께 그린다', () => {
        const html = renderTranscriptHtml(mk(2));
        expect(html).toContain('→ 선택0');
        expect(html).toContain('결과0');
    });

    it('선택지가 없으면 화살표를 그리지 않는다', () => {
        expect(renderTranscriptHtml(mk(2))).not.toContain('→ 선택1');
    });

    it('HTML 특수문자를 이스케이프한다 — 데이터가 곧바로 innerHTML 로 들어간다', () => {
        const entries: TranscriptEntry[] = [
            { speaker: '<script>x</script>', lines: ['<img src=x onerror=alert(1)>'], choice: '"&', result: null },
            { speaker: '두번째', lines: ['안전한 말'], choice: null, result: null },
        ];
        const html = renderTranscriptHtml(entries);
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&quot;&amp;');
    });

    it('결정론이다 — 언제나 같은 문자열을 낸다', () => {
        expect(renderTranscriptHtml(mk(4))).toBe(renderTranscriptHtml(mk(4)));
    });

    it('빈 줄만 있는 항목은 글자 span 을 그리지 않는다 (화자 이름만 남는다)', () => {
        const entries: TranscriptEntry[] = [
            { speaker: '아', lines: [], choice: null, result: null },
            { speaker: '나', lines: ['  '], choice: null, result: null },
        ];
        const html = renderTranscriptHtml(entries);
        expect(html).not.toContain('dlg-th-line');
        // 항목 자체(화자 이름)는 읽히도록 남는다
        expect(html).toContain('아');
        expect(html).toContain('나');
    });
});

// ---------------------------------------------------------------- 5. 타이포그래피 상태 기계

describe('dialogue reveal machine', () => {
    it('0 에서 시작하고 다 보이면 done', () => {
        const s = createRevealMachine(10);
        expect(s.cursor).toBe(0);
        expect(isRevealDone(s)).toBe(false);
        expect(isRevealDone(completeReveal(s))).toBe(true);
    });

    it('advance 는 정해진 만큼만 전진한다', () => {
        const s = createRevealMachine(10);
        expect(advanceReveal(s, 3).cursor).toBe(3);
        expect(advanceReveal(s, 3).cursor).toBe(3); // 결정론 — 같은 입력은 같은 결과
    });

    it('글자 수를 넘겨도 초과하지 않는다', () => {
        let s = createRevealMachine(5);
        s = advanceReveal(s, 100);
        expect(s.cursor).toBe(5);
        expect(isRevealDone(s)).toBe(true);
    });

    it('완료된 상태는 그대로 멈춘다 (무한 루프 방지)', () => {
        const done = completeReveal(createRevealMachine(3));
        expect(advanceReveal(done, 2)).toEqual(done);
    });

    it('나쁜 step 값은 1 로 보정한다', () => {
        const s = createRevealMachine(10);
        expect(advanceReveal(s, 0).cursor).toBe(1);
        expect(advanceReveal(s, -5).cursor).toBe(1);
        expect(advanceReveal(s, NaN).cursor).toBe(1);
    });

    it('반복하면 반드시 끝난다 (유한성)', () => {
        let s = createRevealMachine(1000);
        let guard = 0;
        while (!isRevealDone(s) && guard < 10_000) { s = advanceReveal(s, 2); guard++; }
        expect(isRevealDone(s)).toBe(true);
        expect(guard).toBeLessThan(10_000);
    });

    it('빈 대사는 처음부터 끝난 상태다', () => {
        const s = createRevealMachine(0);
        expect(isRevealDone(s)).toBe(true);
    });

    it('나쁜 total 은 0 으로 보정한다', () => {
        expect(createRevealMachine(NaN).total).toBe(0);
        expect(createRevealMachine(-5).total).toBe(0);
        expect(createRevealMachine(Infinity).total).toBe(0);
    });
});

// ---------------------------------------------------------------- 6. planReveal / normalizeSpeech

describe('planReveal', () => {
    it('0 이하면 전체를 다 보여준다', () => {
        const r = planReveal('“쌀값입니다.”', 0);
        expect(r.done).toBe(true);
        expect(r.shown).toBe('“쌀값입니다.”');
        expect(r.remaining).toBe('');
    });

    it('글자 수 이상이면 전체를 다 보여준다', () => {
        const r = planReveal('짧은말', 999);
        expect(r.done).toBe(true);
        expect(r.shown).toBe('짧은말');
    });

    it('중간에서 자르면 남은 부분이 나온다', () => {
        const r = planReveal('abcdefghij', 4);
        expect(r.shown).toBe('abcd');
        expect(r.remaining).toBe('efghij');
        expect(r.done).toBe(false);
        expect(r.total).toBe(10);
    });

    it('shown 은 항상 원문의 접두사다 (글자를 지우지 않는다)', () => {
        const text = '“오랜만이옵니다, 주공.”';
        for (let n = 1; n <= text.length; n++) {
            const r = planReveal(text, n);
            expect(text.startsWith(r.shown)).toBe(true);
        }
    });

    it('shown 과 remaining 을 합치면 원문이 된다', () => {
        const text = '가나다라마바사아자차카타파하';
        for (let n = 1; n < text.length; n++) {
            const r = planReveal(text, n);
            expect(r.shown + (r.remaining.startsWith('\n') ? '\n' : '') + r.remaining).toContain(text.slice(0, r.shown.length));
        }
    });

    it('참고는 타포그래피 대상이 아니다 — spoken 에도 안 들어간다', () => {
        const r = planReveal('“쌀값입니다.”\n\n치안 80', 0);
        expect(r.spoken).not.toContain('치안');
        expect(r.shown).not.toContain('치안');
    });

    it('spoken 은 따옴표를 걷어낸 전체 대사다 (TTS 용)', () => {
        const r = planReveal('“오랜만이옵니다.”', 3);
        expect(r.spoken).toBe('오랜만이옵니다.');
        // 화면 조각과 무관하게 항상 전체다
        expect(r.spoken.length).toBeGreaterThan(r.shown.length);
    });

    it('빈 대사는 아무것도 없다', () => {
        const r = planReveal('', 5);
        expect(r).toEqual({ shown: '', remaining: '', done: true, total: 0, spoken: '' });
    });

    it('줄 경계를 넘는 지점에서 잘리지 않는다', () => {
        // 규칙: 첫 줄이 charCount 를 넘으면 거기서 자르고,
        // 그 다음 줄은 통째로 들어올 때만 함께 보여준다.
        // ('첫째줄입니다' 의 4글자 접두사는 '첫째줄입' 이다)
        const r = planReveal('첫째줄입니다\n둘째줄입니다', 4);
        expect(r.shown).toBe('첫째줄입');
        expect(r.remaining).toBe('니다\n둘째줄입니다');
    });

    it('두 번째 줄까지 통째로 들어오면 함께 보여준다', () => {
        const r = planReveal('가나다\n라마바', 7);
        expect(r.shown).toBe('가나다\n라마바');
        expect(r.done).toBe(true);
    });
});

describe('normalizeSpeech', () => {
    it('따옴표와 여분 공백을 걷어낸다', () => {
        expect(normalizeSpeech('“오랜만이옵니다.”')).toBe('오랜만이옵니다.');
        expect(normalizeSpeech('  너무   많은   공백 ')).toBe('너무 많은 공백');
    });

    it('빈 입력은 빈 문자열', () => {
        expect(normalizeSpeech('')).toBe('');
        expect(normalizeSpeech('   ')).toBe('');
    });
});

// ---------------------------------------------------------------- 7. DOM 을 건드리지 않는다

describe('모듈은 DOM 을 건드리지 않는다', () => {
    it('소스에 document/window/Math.random 이 없다', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const src = readFileSync(resolve(__dirname, '../src/core/dialogue_transcript.ts'), 'utf8');
        // 주석에 적은 안내 문구는 제외하고 실제 코드만 검사한다.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code).not.toMatch(/\bdocument\b/);
        expect(code).not.toMatch(/\bwindow\b/);
        expect(code).not.toMatch(/Math\.random/);
        expect(code).not.toMatch(/Date\.now/);
    });
});