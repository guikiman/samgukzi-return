/**
 * 삼국지리턴 — 실시간 다국어 i18n 파이프라인
 * 파일: src/core/localization_manager.ts
 *
 * [306] 비동기 i18n 파이프라인 — 언어팩 로딩
 * [307] 가변 폰트 렌더러 바인딩 — 붓글씨 서체 전환
 * [308] 레이아웃 재연산 — 국가별 UI 뭉개짐 방지
 *
 * ── 아키텍처 ──
 *
 * 앱 초기화 시:
 *   LocalizationManager.init()
 *     ↓
 *   기본 언어팩 (ko-KR) 동기 로드
 *   기본 폰트 로드 (ko-KR 붓글씨)
 *     ↓
 *   사용 가능
 *
 * 언어 전환 시:
 *   manager.setLanguage('ja-JP')
 *     ↓
 *   1. 비동기 언어팩 JSON fetch()
 *   2. 번역 문자열 메모리 캐시에 저장
 *   3. 폰트 로드 (@font-face 동적 삽입)
 *   4. Font Loading API → fonts.ready
 *   5. 전체 UI 뷰포트 재연산 콜백
 *   6. onLanguageChanged 이벤트 발행
 */

// ============================================================
// [0] 타입 정의
// ============================================================

/** 지원 언어 코드 */
export type LanguageCode =
    | 'ko-KR'   // 한국어
    | 'zh-CN'   // 중국어 간체
    | 'zh-TW'   // 중국어 번체
    | 'ja-JP'   // 일본어
    | 'en-US';  // 영어

/** 언어 메타데이터 */
export interface LanguageMeta {
    readonly code: LanguageCode;
    readonly name: string;        // "한국어", "中文(简体)", "中文(繁體)", "日本語", "English"
    readonly nativeName: string;  // 자국어 표기
    readonly direction: 'ltr' | 'rtl';
    readonly fontFamily: string;  // 기본 폰트
    readonly fallbackFont: string;
    readonly fontUrl: string;     // @font-face 원격 URL
    readonly fontFormat: string;  // 'woff2', 'woff', 'truetype'
}

/** 번역 키-값 맵 */
export type TranslationMap = Record<string, string>;

/** 번역 네임스페이스 (UI 섹션별 분리) */
export type TranslationNamespace =
    | 'common'      | 'ui_main'    | 'ui_battle'   | 'ui_council'
    | 'ui_diplomacy'| 'ui_city'    | 'ui_officer'   | 'ui_event'
    | 'ui_tutorial' | 'ui_modding' | 'ui_options'   | 'ui_editor'
    | 'tips'        | 'tutorial'   | 'tooltip';

/** 언어팩 구조 */
export interface LanguagePack {
    readonly meta: {
        readonly language: LanguageCode;
        readonly version: string;
        readonly author: string;
        readonly updatedAt: string;
    };
    readonly translations: Record<TranslationNamespace, TranslationMap>;
}

/** 폰트 로드 상태 */
export type FontLoadState = 'LOADING' | 'LOADED' | 'ERROR' | 'NOT_LOADED';

/** 언어 전환 이벤트 */
export interface LanguageChangeEvent {
    readonly previousCode: LanguageCode | null;
    readonly currentCode: LanguageCode;
    readonly pack: LanguagePack | null;
    readonly fontLoaded: boolean;
}

/** 레이아웃 조정 파라미터 */
export interface LayoutAdjustment {
    readonly scale: number;           // 폰트 크기 배율 (1.0 = 기본)
    readonly lineHeight: number;      // 줄 간격 배율
    readonly letterSpacing: number;   // 자간 (px)
    readonly maxWidth?: number;       // 최대 텍스트 너비 제한 (px)
    readonly overflowStrategy: 'ellipsis' | 'scroll' | 'shrink' | 'wrap';
}

// ============================================================
// [1] LocalizationManager
// ============================================================

/**
 * LocalizationManager — 실시간 다국어 번역 + 폰트 로딩 + 레이아웃 조정
 *
 * 사용 예:
 * ```typescript
 * const i18n = new LocalizationManager({
 *     defaultLanguage: 'ko-KR',
 *     localePath: '/locales/',
 * });
 *
 * await i18n.init();
 *
 * // 번역
 * console.log(i18n.t('ui_main.start_game'));    // "게임 시작"
 *
 * // 언어 전환
 * await i18n.setLanguage('ja-JP');
 * console.log(i18n.t('ui_main.start_game'));    // "ゲーム開始"
 *
 * // 폰트 로드 대기
 * await i18n.waitForFont();
 * ```
 */
export class LocalizationManager {
    private readonly defaultLanguage: LanguageCode;
    private readonly localePath: string;
    private currentLanguage: LanguageCode;
    private packs: Map<LanguageCode, LanguagePack> = new Map();
    private currentPack: LanguagePack | null = null;
    private fontState: Map<string, FontLoadState> = new Map();
    private fontLoadPromises: Map<string, Promise<void>> = new Map();
    private readonly onLanguageChanged: ((event: LanguageChangeEvent) => void)[] = [];
    private readonly languageMetas: Record<LanguageCode, LanguageMeta>;
    private _initialized = false;
    private _layoutAdjustment: LayoutAdjustment = {
        scale: 1,
        lineHeight: 1.5,
        letterSpacing: 0,
        overflowStrategy: 'ellipsis',
    };

    /** 프리로드할 언어 목록 (init() 전에 설정) */
    preloadLanguages: LanguageCode[] = [];

    constructor(options: {
        defaultLanguage?: LanguageCode;
        localePath?: string;
    } = {}) {
        this.defaultLanguage = options.defaultLanguage ?? 'ko-KR';
        this.localePath = options.localePath ?? '/locales/';
        this.currentLanguage = this.defaultLanguage;

        this.languageMetas = this.buildLanguageMetas();
    }

    // ============================================================
    // 초기화
    // ============================================================

    /**
     * LocalizationManager 초기화
     *
     * 1. 기본 언어팩 동기 로드
     * 2. 프리로드 언어팩 비동기 로드
     * 3. 기본 폰트 로드 시작
     */
    async init(): Promise<void> {
        // 1. 기본 언어팩 로드
        try {
            this.currentPack = await this.loadPack(this.defaultLanguage);
            this.packs.set(this.defaultLanguage, this.currentPack);
        } catch (err) {
            console.warn(`[i18n] Failed to load default language pack "${this.defaultLanguage}":`, err);
            // 빈 팩으로 fallback
            this.currentPack = this.createEmptyPack(this.defaultLanguage);
        }

        // 2. 프리로드 언어팩
        if (this.preloadLanguages.length > 0) {
            await Promise.all(
                this.preloadLanguages
                    .filter(l => l !== this.defaultLanguage)
                    .map(async (lang) => {
                        if (!this.packs.has(lang)) {
                            try {
                                const pack = await this.loadPack(lang);
                                this.packs.set(lang, pack);
                            } catch { /* silent */ }
                        }
                    }),
            );
        }

        // 3. 기본 폰트 로드
        this.loadFont(this.currentLanguage);

        this._initialized = true;
    }

    // ============================================================
    // 번역
    // ============================================================

    /**
     * 키 기반 번역 문자열 조회
     *
     * @param key         "namespace.key" 형식의 번역 키
     * @param params      치환 파라미터 (선택)
     * @returns           번역된 문자열 (없으면 키 자체 반환)
     *
     * 사용 예:
     * ```typescript
     * i18n.t('ui_main.start_game');                        // "게임 시작"
     * i18n.t('common.turn_count', { count: 5 });            // "5턴째"
     * i18n.t('ui_battle.damage_dealt', { dmg: 150 });
     * ```
     */
    t(key: string, params?: Record<string, string | number>): string {
        if (!this.currentPack) return key;

        const parts = key.split('.');
        const namespace = parts[0] as TranslationNamespace;
        const actualKey = parts.slice(1).join('.');

        // named namespace lookup
        const nsMap = this.currentPack.translations[namespace];
        if (!nsMap) return key;

        let value = nsMap[actualKey];
        if (value === undefined) return key;

        // 파라미터 치환: {{paramName}}
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
            }
        }

        return value;
    }

    /**
     * 특정 네임스페이스의 모든 번역 조회
     */
    getNamespace(namespace: TranslationNamespace): TranslationMap | null {
        if (!this.currentPack) return null;
        return this.currentPack.translations[namespace] ?? null;
    }

    // ============================================================
    // 언어 전환
    // ============================================================

    /**
     * 실시간 언어 전환
     *
     * 파이프라인:
     *   1. 언어팩 로드 (캐시 or fetch)
     *   2. 폰트 로드
     *   3. 레이아웃 조정 계산
     *   4. onLanguageChanged 콜백
     *
     * @param code  대상 언어 코드
     */
    async setLanguage(code: LanguageCode): Promise<void> {
        if (code === this.currentLanguage && this.currentPack) return;

        const previousCode = this.currentLanguage;
        const previousPack = this.currentPack;

        // 1. 언어팩 로드
        let pack: LanguagePack;
        if (this.packs.has(code)) {
            pack = this.packs.get(code)!;
        } else {
            try {
                pack = await this.loadPack(code);
                this.packs.set(code, pack);
            } catch (err) {
                console.error(`[i18n] Failed to load language pack "${code}":`, err);
                return;
            }
        }

        this.currentPack = pack;
        this.currentLanguage = code;

        // 2. 폰트 로드
        const fontLoaded = await this.loadFont(code);

        // 3. 레이아웃 조정
        this.computeLayoutAdjustment(code);

        // 4. 이벤트 발행
        const event: LanguageChangeEvent = {
            previousCode,
            currentCode: code,
            pack,
            fontLoaded,
        };
        for (const cb of this.onLanguageChanged) {
            try { cb(event); } catch { /* */ }
        }
    }

    /** 현재 언어 코드 */
    get language(): LanguageCode { return this.currentLanguage; }

    /** 언어 전환 콜백 등록 */
    onLanguageChange(callback: (event: LanguageChangeEvent) => void): void {
        this.onLanguageChanged.push(callback);
    }

    // ============================================================
    // 폰트 관리
    // ============================================================

    /**
     * 언어별 폰트 로드
     *
     * @font-face 동적 스타일시트 삽입 → Font Loading API로 완료 감지
     *
     * @param code  언어 코드
     * @returns     폰트 로드 성공 여부
     */
    async loadFont(code: LanguageCode): Promise<boolean> {
        const meta = this.languageMetas[code];
        const fontFamily = meta.fontFamily;

        if (this.fontState.get(fontFamily) === 'LOADED') return true;
        if (this.fontState.get(fontFamily) === 'LOADING') {
            await this.fontLoadPromises.get(fontFamily);
            return this.fontState.get(fontFamily) === 'LOADED';
        }

        this.fontState.set(fontFamily, 'LOADING');

        const promise = (async () => {
            try {
                // @font-face 동적 스타일시트 삽입
                const style = document.createElement('style');
                style.textContent = `
                    @font-face {
                        font-family: '${fontFamily}';
                        src: url('${meta.fontUrl}') format('${meta.fontFormat}');
                        font-weight: normal;
                        font-style: normal;
                        font-display: swap;
                    }
                `;
                document.head.appendChild(style);

                // Font Loading API로 로드 완료 감지
                if (document.fonts) {
                    await document.fonts.load(`1em "${fontFamily}"`);
                    await document.fonts.ready;
                }

                this.fontState.set(fontFamily, 'LOADED');
            } catch (err) {
                console.warn(`[i18n] Font load failed for "${fontFamily}":`, err);
                this.fontState.set(fontFamily, 'ERROR');
            }
        })();

        this.fontLoadPromises.set(fontFamily, promise);
        await promise;

        return this.fontState.get(fontFamily) === 'LOADED';
    }

    /** 폰트 로드 완료까지 대기 */
    async waitForFont(code?: LanguageCode): Promise<boolean> {
        const target = code ?? this.currentLanguage;
        const meta = this.languageMetas[target];
        const state = this.fontState.get(meta.fontFamily);
        if (state === 'LOADED') return true;
        if (state === 'LOADING') {
            await this.fontLoadPromises.get(meta.fontFamily);
            return this.fontState.get(meta.fontFamily) === 'LOADED';
        }
        return this.loadFont(target);
    }

    /** 특정 폰트의 로드 상태 */
    getFontState(code: LanguageCode): FontLoadState {
        return this.fontState.get(this.languageMetas[code].fontFamily) ?? 'NOT_LOADED';
    }

    // ============================================================
    // 레이아웃 조정
    // ============================================================

    /**
     * 언어 전환 시 레이아웃 조정 파라미터 계산
     *
     * 각 언어별 텍스트 길이/폰트 특성에 따라 scale/lineHeight/letterSpacing 조정
     * - 한국어: 기본 (한글 음절 1:1 비율)
     * - 중국어 (간/번체): 기본 (한자 1:1 비율)
     * - 일본어: lineHeight 약간 증가 (히라가나/가타카나 혼합)
     * - 영어: scale 증가 (영어 단어가 한글보다 길어짐)
     */
    private computeLayoutAdjustment(code: LanguageCode): void {
        switch (code) {
            case 'ko-KR':
                this._layoutAdjustment = { scale: 1.0, lineHeight: 1.5, letterSpacing: 0, overflowStrategy: 'ellipsis' };
                break;
            case 'zh-CN':
            case 'zh-TW':
                this._layoutAdjustment = { scale: 0.95, lineHeight: 1.6, letterSpacing: 0.5, overflowStrategy: 'ellipsis' };
                break;
            case 'ja-JP':
                this._layoutAdjustment = { scale: 0.95, lineHeight: 1.7, letterSpacing: 0.3, overflowStrategy: 'wrap' };
                break;
            case 'en-US':
                this._layoutAdjustment = { scale: 0.85, lineHeight: 1.4, letterSpacing: 0, overflowStrategy: 'shrink' };
                break;
        }
    }

    /** 현재 레이아웃 조정 파라미터 */
    get layoutAdjustment(): LayoutAdjustment { return this._layoutAdjustment; }

    /** CSS 변수로 레이아웃 파라미터 적용 */
    applyLayoutToCSS(root: HTMLElement = document.documentElement): void {
        root.style.setProperty('--i18n-scale', String(this._layoutAdjustment.scale));
        root.style.setProperty('--i18n-line-height', String(this._layoutAdjustment.lineHeight));
        root.style.setProperty('--i18n-letter-spacing', `${this._layoutAdjustment.letterSpacing}px`);
        root.style.setProperty('--i18n-overflow', this._layoutAdjustment.overflowStrategy);
        root.style.setProperty('--i18n-font-family', this.languageMetas[this.currentLanguage].fontFamily);
    }

    // ============================================================
    // 언어 메타데이터
    // ============================================================

    private buildLanguageMetas(): Record<LanguageCode, LanguageMeta> {
        return {
            'ko-KR': {
                code: 'ko-KR',
                name: '한국어',
                nativeName: '한국어',
                direction: 'ltr',
                fontFamily: 'Noto Serif KR',
                fallbackFont: 'serif',
                fontUrl: '/fonts/noto-serif-kr.woff2',
                fontFormat: 'woff2',
            },
            'zh-CN': {
                code: 'zh-CN',
                name: '中文(简体)',
                nativeName: '简体中文',
                direction: 'ltr',
                fontFamily: 'Noto Serif SC',
                fallbackFont: 'serif',
                fontUrl: '/fonts/noto-serif-sc.woff2',
                fontFormat: 'woff2',
            },
            'zh-TW': {
                code: 'zh-TW',
                name: '中文(繁體)',
                nativeName: '繁體中文',
                direction: 'ltr',
                fontFamily: 'Noto Serif TC',
                fallbackFont: 'serif',
                fontUrl: '/fonts/noto-serif-tc.woff2',
                fontFormat: 'woff2',
            },
            'ja-JP': {
                code: 'ja-JP',
                name: '日本語',
                nativeName: '日本語',
                direction: 'ltr',
                fontFamily: 'Noto Serif JP',
                fallbackFont: 'serif',
                fontUrl: '/fonts/noto-serif-jp.woff2',
                fontFormat: 'woff2',
            },
            'en-US': {
                code: 'en-US',
                name: 'English',
                nativeName: 'English',
                direction: 'ltr',
                fontFamily: 'Cinzel',
                fallbackFont: 'serif',
                fontUrl: '/fonts/cinzel.woff2',
                fontFormat: 'woff2',
            },
        };
    }

    /** 모든 언어 메타데이터 */
    get allLanguages(): LanguageMeta[] {
        return Object.values(this.languageMetas);
    }

    /** 특정 언어 메타데이터 */
    getLanguageMeta(code: LanguageCode): LanguageMeta {
        return this.languageMetas[code];
    }

    // ============================================================
    // 언어팩 로드
    // ============================================================

    /**
     * 언어팩 JSON 파일 로드
     *
     * @param code  언어 코드
     * @returns     파싱된 LanguagePack
     */
    private async loadPack(code: LanguageCode): Promise<LanguagePack> {
        const url = `${this.localePath}${code}.json`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to load ${url}`);
        }

        const pack = await response.json() as LanguagePack;

        // 기본 검증
        if (!pack.translations || typeof pack.translations !== 'object') {
            throw new Error(`Invalid language pack: missing translations object`);
        }

        return pack;
    }

    /** 빈 언어팩 생성 (폴백) */
    private createEmptyPack(code: LanguageCode): LanguagePack {
        return {
            meta: {
                language: code,
                version: '1.0.0',
                author: 'system',
                updatedAt: new Date().toISOString(),
            },
            translations: {} as Record<TranslationNamespace, TranslationMap>,
        };
    }

    // ============================================================
    // 진단
    // ============================================================

    get initialized(): boolean { return this._initialized; }

    /** 현재 언어팩의 번역 키 개수 */
    get translationCount(): number {
        if (!this.currentPack) return 0;
        let count = 0;
        for (const ns of Object.values(this.currentPack.translations)) {
            count += Object.keys(ns).length;
        }
        return count;
    }

    /** 캐시된 언어팩 목록 */
    get cachedLanguages(): LanguageCode[] {
        return Array.from(this.packs.keys());
    }

    /** 모든 초기화된 언어팩의 메모리 사용량 추정 (bytes) */
    get estimatedMemoryUsage(): number {
        let total = 0;
        for (const [, pack] of this.packs) {
            total += new Blob([JSON.stringify(pack)]).size;
        }
        return total;
    }

    /** 리소스 정리 */
    dispose(): void {
        this.packs.clear();
        this.currentPack = null;
        this.fontLoadPromises.clear();
        this.fontState.clear();
        this._initialized = false;
    }
}

// ============================================================
// [2] 유틸리티 함수
// ============================================================

/**
 * 숫자/날짜 포맷 — 로케일 인식 포맷팅
 *
 * @param value  포맷할 값
 * @param locale 언어 코드
 * @returns      로케일 기반 문자열
 */
export function formatLocaleNumber(value: number, locale: LanguageCode): string {
    const localeMap: Record<LanguageCode, string> = {
        'ko-KR': 'ko-KR',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'ja-JP': 'ja-JP',
        'en-US': 'en-US',
    };
    try {
        return new Intl.NumberFormat(localeMap[locale]).format(value);
    } catch {
        return String(value);
    }
}

/**
 * 복수형 메시지 포맷 (영어: 1 item / N items)
 */
export function formatPlural(
    count: number,
    singular: string,
    plural: string,
    locale: LanguageCode,
): string {
    if (locale === 'ko-KR' || locale === 'zh-CN' || locale === 'zh-TW' || locale === 'ja-JP') {
        // 동아시아 언어는 복수형 구분 없음
        return `${count}${singular}`;
    }
    // 영어 복수형
    return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}

/**
 * HTML 엔티티 이스케이프 (XSS 방지)
 */
export function escapeHTML(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
