/**
 * [461-480] 마이크로 UX · 튜토리얼/도움말 시스템
 * 파일: src/core/tutorial_system.ts
 *
 * 설계:
 * - 단계형 온보딩 튜토리얼 (이전/다음/건너뛰기)
 * - 완료 여부를 localStorage에 저장 — 2회차부터 자동 표시 안 함 [17]
 * - 렌더 로직(renderStep)은 순수 문자열 반환 — DOM 없이 단위 테스트 가능
 * - main.ts 브라우저 레이어가 HTML을 주입하고 버튼을 바인딩
 */
export const TUTORIAL_STEPS = [
    {
        id: 'welcome',
        title: ' Welcome — 삼국지 8 리메이크',
        body: '군주가 되어 중원을 통일하는 것이 목표입니다. 매월 턴이 진행되며, 내정·외교·전쟁을 조합해 세력을 키웁니다.',
        targetHint: '게임 시작',
    },
    {
        id: 'turn',
        title: ' 턴 진행 — 다음 月',
        body: '「▸ 다음 月」 버튼으로 한 달씩 진행합니다. 평정 페이즈에서 명령을 내린 뒤 진행하면 무장들의 행동 결과가 월간 보고로 전달됩니다.',
        targetHint: 'btn-next-month',
        spotlightSelector: '#btn-next-month',
        spotlightFallback: '화면 상단 도구바의 「▸ 다음 月」 버튼',
    },
    {
        id: 'report',
        title: ' 월간 보고 — 月報',
        body: '「📊 보고」에서 재정·도시 현황·타세력 동향·기후와 은퇴 등 월간 요약을 확인합니다. 악천후(❄️ 등)가 걸린 도시는 수확이 감소하니 주의하세요.',
        targetHint: 'btn-report',
        spotlightSelector: '#btn-report',
        spotlightFallback: '화면 상단 도구바의 「📊 보고」 버튼',
    },
    {
        id: 'city',
        title: ' 도시 내정 — 內政',
        body: '지도의 도시를 클릭하면 상세 패널이 열립니다. 개발·치수·훈련·징병 등 내정 명령으로 도시를 성장시키고, 무장 목록에서 담당을 지정합니다.',
        targetHint: '지도 도시 클릭',
    },
    {
        id: 'city-buildings',
        title: ' 도시 건설 — 都市',
        body: '도시 진입 화면의 등각투영 배치를 확인하세요. 건물을 선택하면 운영 정보와 누적 투자가 보이며, 「투자」로 단계와 도시 지표를 높일 수 있습니다. 운영/휴업 상태는 세이브에 보존됩니다.',
        targetHint: '도시 화면의 건물 배치도',
        spotlightSelector: '#city-scene-canvas',
        spotlightFallback: '도시 클릭 후 opened city panel의 都市 배치도',
    },
    {
        id: 'accessibility',
        title: ' 접근성과 편의 — 便利',
        body: '상단 「⚙️ 설정」에서 글자 크기·명도·색약 모드·화면 흔들림을 조절할 수 있습니다. 「❓ 도움말」에서 이 안내를 다시 볼 수 있습니다.',
        targetHint: 'btn-settings',
        spotlightSelector: '#btn-settings',
        spotlightFallback: '화면 상단 도구바의 「⚙️ 설정」 버튼',
    },
    {
        id: 'diplomacy',
        title: ' 외교 — 外交',
        body: '「🕊️ 외교」에서 타세력과 관계를 확인하고 증정·동맹을 제안할 수 있습니다. 주변 세력과의 관계가 전쟁 리스크를 좌우합니다.',
        targetHint: 'btn-diplomacy',
        spotlightSelector: '#btn-diplomacy',
        spotlightFallback: '화면 상단 도구바의 「🕊️ 외교」 버튼',
    },
    {
        id: 'battle',
        title: ' 전투 — 出陣',
        body: '「⚔️ 전투」에서 출진을 준비합니다. 헥사곤 전장에서 병종 상성과 지형을 고려해 지휘하세요. 승리하면 도시를 점령합니다.',
        targetHint: 'btn-battle',
        spotlightSelector: '#btn-battle',
        spotlightFallback: '화면 상단 도구바의 「⚔️ 전투」 버튼',
    },
    {
        id: 'vagrant',
        title: ' 몰락해도 끝이 아니다 — 復起',
        body: '세력이 도시를 모두 잃으면 방랑군이 됩니다. 재야 무장을 등용하고 약한 도시를 습격해 다시 일어설 수 있습니다.',
        targetHint: '방랑군 전용',
    },
    {
        id: 'ending',
        title: ' 통일 — 天下',
        body: '모든 도시를 점령하면 통일 엔딩이 열립니다. 업적이 해금되고 세이브에 기록됩니다. 행운을 비세요!',
        targetHint: '엔딩',
    },
];
export class TutorialSystem {
    constructor(storageKey = 'rtk8_tutorial_done') {
        this.index = 0;
        this.storageKey = storageKey;
    }
    /** 첫 플레이 여부 — false면 자동 표시를 건너뜀 [17] */
    shouldShowOnStart() {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(this.storageKey) === null;
        }
        catch {
            // 스토리지 접근 불가 환경(사파리 프라이빗 등)에서는 표시
            return true;
        }
    }
    start() {
        this.index = 0;
    }
    next() {
        if (this.index < TUTORIAL_STEPS.length - 1)
            this.index++;
    }
    prev() {
        if (this.index > 0)
            this.index--;
    }
    /** 현재 단계의 스포트라이트 대상 셀렉터 (없으면 null) */
    currentSpotlightSelector() {
        return TUTORIAL_STEPS[this.index].spotlightSelector ?? null;
    }
    /** 스포트라이트 대상을 못 찾았을 때 표시할 위치 설명 */
    currentSpotlightFallback() {
        return TUTORIAL_STEPS[this.index].spotlightFallback ?? null;
    }
    /** 현재 단계의 렌더 결과 — DOM 조작 없이 순수 계산 */
    renderStep() {
        const s = TUTORIAL_STEPS[this.index];
        const dots = TUTORIAL_STEPS.map((step, i) => `<span class="tut-dot${i === this.index ? ' active' : ''}${i < this.index ? ' done' : ''}"></span>`).join('');
        const html = `<div class="tut-title">${s.title}</div>` +
            `<div class="tut-body">${s.body}</div>` +
            (s.targetHint ? `<div class="tut-hint">▸ 관련 UI: ${s.targetHint}</div>` : '') +
            `<div class="tut-dots">${dots}</div>`;
        return {
            html,
            step: this.index + 1,
            totalSteps: TUTORIAL_STEPS.length,
            isFirst: this.index === 0,
            isLast: this.index === TUTORIAL_STEPS.length - 1,
        };
    }
    /** 완료/건너뛰기 — localStorage에 기록 [17] */
    complete() {
        try {
            localStorage.setItem(this.storageKey, 'done');
        }
        catch {
            // 스토리지 불가 환경은 무시 (세션 내에서만 반복 표시)
        }
    }
    /** 테스트용 — 완료 기록 삭제 */
    reset() {
        try {
            localStorage.removeItem(this.storageKey);
        }
        catch {
            // 무시
        }
    }
}
//# sourceMappingURL=tutorial_system.js.map