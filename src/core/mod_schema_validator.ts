/**
 * [E47] 모드 JSON 스키마 유효성 검사기 — Mod Schema Validator
 *
 * ModSchemaValidator:
 *   1. 무장 데이터 JSON 검증 (OfficerSchema)
 *   2. 이벤트 시나리오 JSON 검증 (EventSchema)
 *   3. 도시/아이템 JSON 검증
 *   4. 누락 필드, 타입 불일치, 참조 무결성 검사
 *   5. 상세 오류 메시지 반환
 */

export interface ValidationError {
    readonly path: string;
    readonly field: string;
    readonly message: string;
}

export interface ValidationResult {
    readonly valid: boolean;
    readonly errors: ValidationError[];
}

export class ModSchemaValidator {
    validateOfficer(data: any): ValidationResult {
        const errors: ValidationError[] = [];
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: [{ path: '', field: 'root', message: '데이터가 객체여야 합니다' }] };
        }
        if (!data.id || typeof data.id !== 'string') {
            errors.push({ path: 'id', field: 'id', message: '무장 ID는 문자열이어야 합니다' });
        }
        if (!data.name || typeof data.name !== 'string') {
            errors.push({ path: 'name', field: 'name', message: '무장 이름은 문자열이어야 합니다' });
        }
        if (data.stats && typeof data.stats === 'object') {
            if (typeof data.stats.might !== 'number' || data.stats.might < 1 || data.stats.might > 100) {
                errors.push({ path: 'stats.might', field: 'might', message: '무력은 1~100 사이 숫자여야 합니다' });
            }
            if (typeof data.stats.intelligence !== 'number' || data.stats.intelligence < 1 || data.stats.intelligence > 100) {
                errors.push({ path: 'stats.intelligence', field: 'intelligence', message: '지력은 1~100 사이 숫자여야 합니다' });
            }
            if (typeof data.stats.politics !== 'number' || data.stats.politics < 1 || data.stats.politics > 100) {
                errors.push({ path: 'stats.politics', field: 'politics', message: '정치는 1~100 사이 숫자여야 합니다' });
            }
            if (typeof data.stats.charisma !== 'number' || data.stats.charisma < 1 || data.stats.charisma > 100) {
                errors.push({ path: 'stats.charisma', field: 'charisma', message: '매력은 1~100 사이 숫자여야 합니다' });
            }
        } else {
            errors.push({ path: 'stats', field: 'stats', message: '스탯 정보가 필요합니다' });
        }
        if (data.lifespan && typeof data.lifespan === 'object') {
            if (typeof data.lifespan.birth !== 'number') {
                errors.push({ path: 'lifespan.birth', field: 'birth', message: '출생년도는 숫자여야 합니다' });
            }
            if (data.lifespan.death !== undefined && typeof data.lifespan.death !== 'number') {
                errors.push({ path: 'lifespan.death', field: 'death', message: '사망년도는 숫자여야 합니다' });
            }
        }
        return { valid: errors.length === 0, errors };
    }

    validateEvent(data: any): ValidationResult {
        const errors: ValidationError[] = [];
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: [{ path: '', field: 'root', message: '데이터가 객체여야 합니다' }] };
        }
        if (!data.id || typeof data.id !== 'string') {
            errors.push({ path: 'id', field: 'id', message: '이벤트 ID는 문자열이어야 합니다' });
        }
        if (!data.trigger || typeof data.trigger !== 'object') {
            errors.push({ path: 'trigger', field: 'trigger', message: '트리거 조건이 필요합니다' });
        }
        if (!Array.isArray(data.conditions)) {
            errors.push({ path: 'conditions', field: 'conditions', message: '조건은 배열이어야 합니다' });
        }
        if (data.year !== undefined && (typeof data.year !== 'number' || data.year < 150 || data.year > 300)) {
            errors.push({ path: 'year', field: 'year', message: '연도는 150~300 사이여야 합니다' });
        }
        return { valid: errors.length === 0, errors };
    }

    validateCity(data: any): ValidationResult {
        const errors: ValidationError[] = [];
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: [{ path: '', field: 'root', message: '데이터가 객체여야 합니다' }] };
        }
        if (!data.id || typeof data.id !== 'string') {
            errors.push({ path: 'id', field: 'id', message: '도시 ID는 문자열이어야 합니다' });
        }
        if (!data.name || typeof data.name !== 'string') {
            errors.push({ path: 'name', field: 'name', message: '도시 이름은 문자열이어야 합니다' });
        }
        // [결함 수정] development 은 병력 수다 (types.ts 참고). 예전엔
        // "개발도 0~100" 이라 검증해 도시 병력이 수천~수만인 지금은
        // 정당한 시나리오 데이터까지 위조로 판정했다. 상한을 병력 규모로 옮긴다.
        if (data.development !== undefined && (typeof data.development !== 'number' || data.development < 0 || data.development > 200000)) {
            errors.push({ path: 'development', field: 'development', message: '병력은 0~200,000 사이여야 합니다' });
        }
        if (data.commerce !== undefined && (typeof data.commerce !== 'number' || data.commerce < 0 || data.commerce > 100)) {
            errors.push({ path: 'commerce', field: 'commerce', message: '상업은 0~100 사이여야 합니다' });
        }
        if (data.defense !== undefined && (typeof data.defense !== 'number' || data.defense < 0 || data.defense > 100)) {
            errors.push({ path: 'defense', field: 'defense', message: '방어는 0~100 사이여야 합니다' });
        }
        return { valid: errors.length === 0, errors };
    }

    validateItem(data: any): ValidationResult {
        const errors: ValidationError[] = [];
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: [{ path: '', field: 'root', message: '데이터가 객체여야 합니다' }] };
        }
        if (!data.id || typeof data.id !== 'string') {
            errors.push({ path: 'id', field: 'id', message: '아이템 ID는 문자열이어야 합니다' });
        }
        if (!data.name || typeof data.name !== 'string') {
            errors.push({ path: 'name', field: 'name', message: '아이템 이름은 문자열이어야 합니다' });
        }
        if (data.type && !['WEAPON', 'BOOK', 'TREASURE', 'HORSE', 'TOOL'].includes(data.type)) {
            errors.push({ path: 'type', field: 'type', message: '타입은 WEAPON/BOOK/TREASURE/HORSE/TOOL 중 하나여야 합니다' });
        }
        return { valid: errors.length === 0, errors };
    }

    validateModPackage(data: any): ValidationResult {
        const errors: ValidationError[] = [];
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: [{ path: '', field: 'root', message: '모드 패키지는 객체여야 합니다' }] };
        }
        if (!data.name || typeof data.name !== 'string') {
            errors.push({ path: 'name', field: 'name', message: '모드 이름이 필요합니다' });
        }
        if (!data.version || typeof data.version !== 'string') {
            errors.push({ path: 'version', field: 'version', message: '모드 버전이 필요합니다' });
        }
        if (Array.isArray(data.officers)) {
            for (let i = 0; i < data.officers.length; i++) {
                const result = this.validateOfficer(data.officers[i]);
                for (const err of result.errors) {
                    errors.push({ path: `officers[${i}].${err.path}`, field: err.field, message: err.message });
                }
            }
        }
        if (Array.isArray(data.events)) {
            for (let i = 0; i < data.events.length; i++) {
                const result = this.validateEvent(data.events[i]);
                for (const err of result.errors) {
                    errors.push({ path: `events[${i}].${err.path}`, field: err.field, message: err.message });
                }
            }
        }
        if (Array.isArray(data.cities)) {
            for (let i = 0; i < data.cities.length; i++) {
                const result = this.validateCity(data.cities[i]);
                for (const err of result.errors) {
                    errors.push({ path: `cities[${i}].${err.path}`, field: err.field, message: err.message });
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }
}
