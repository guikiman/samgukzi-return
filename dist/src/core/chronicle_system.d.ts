/**
 * 연대기 시스템 [Y-메타][441-460] — 세계의 기록
 *
 * 복수/방문/결의/구출/멸망 등 서사적 이벤트를 게임 로그와 별도로
 * 연도순 연대기에 기록한다. 인메모리 링 버퍼(최대 200건)로 유지하며,
 * 저장 시점에는 JSON 직렬화해 세이브에 포함할 수 있다(선택).
 *
 * UI는 Chronicle 탭에서 이 기록을 시간 역순으로 표시한다.
 */
import type { GameStore } from './game_store.js';
/** 연대기 항목 종류 */
export type ChronicleKind = 'VENGEANCE' | 'VISIT' | 'FREE_VISIT' | 'PACT' | 'RESCUE' | 'DEFECTION' | 'CAPTURE' | 'DESTROYED' | 'HISTORICAL' | 'ENDING';
/** 연대기 항목 */
export interface ChronicleEntry {
    kind: ChronicleKind;
    /** 연도/월 (스토어 시각 기준) */
    year: number;
    month: number;
    /** 턴 번호 */
    turn: number;
    /** 표시용 아이콘 */
    icon: string;
    /** 연대기 문구 */
    text: string;
    /** 사건 관련 세력 (세력 필터용) */
    factionId?: string | null;
    /** 사건 관련 도시 (도시 상세 표시용) */
    cityId?: string | null;
}
/** 링 버퍼 최대 항목 수 */
export declare const CHRONICLE_MAX = 200;
/**
 * 연대기 관리자 — 엔진 1개당 1개 인스턴스.
 * add()는 시각을 스토어에서 자동 수집하고 링 버퍼를 유지한다.
 */
export declare class ChronicleManager {
    private entries;
    private store;
    attachStore(store: GameStore): void;
    /** 연대기 항목 추가 — 시각 미지정 시 스토어 시각 자동 수집 */
    add(kind: ChronicleKind, text: string, at?: {
        year: number;
        month: number;
        turn: number;
    }, details?: {
        factionId?: string | null;
        cityId?: string | null;
    }): void;
    /** 최신순 조회 (UI 표시용) */
    list(): ChronicleEntry[];
    /** 특정 종류만 최신순 조회 */
    listByKind(kind: ChronicleKind): ChronicleEntry[];
    /** 항목 수 */
    get size(): number;
    /** 세이브용 직렬화 */
    serialize(): ChronicleEntry[];
    /** 로드 복원 */
    load(entries: ChronicleEntry[]): void;
    clear(): void;
}
//# sourceMappingURL=chronicle_system.d.ts.map