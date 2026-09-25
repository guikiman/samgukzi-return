import { describe, expect, it } from 'vitest';
import { ReplayShareManager, type ReplayCommandEvent } from '../src/core/replay_share_manager.js';

const commandEvent: ReplayCommandEvent = {
    id: 'undo_battle_1',
    commandType: 'BATTLE',
    action: 'UNDO',
    turn: 3,
    timestamp: 1234,
    success: true,
    message: '전투 복구',
    logMessages: ['포로 처분 복구'],
    captiveOutcomes: [{
        officerId: 'officer_1',
        officerName: '관우',
        decision: 'RELEASE',
        success: false,
        message: '관우 포로를 석방했다',
    }],
};

describe('리플레이 커맨드 이벤트 [312][131-145][341-360]', () => {
    it('전투·포로·외교 명령 이벤트를 URL 로그와 함께 왕복한다', async () => {
        const manager = new ReplayShareManager();
        manager.recordAction(3, 'officer_1', 'ATTACK', 'enemy_1', 200, 1, 2);
        manager.recordCommandEvent(commandEvent);

        const encoded = await manager.exportToCompressedString();
        const restored = new ReplayShareManager();
        const logs = await restored.importFromCompressedString(encoded);

        expect(logs).toHaveLength(1);
        expect(restored.getCommandEvents()).toEqual([commandEvent]);
    });

    it('구버전 전투 로그 payload는 명령 이벤트 없이도 그대로 복원된다', async () => {
        const manager = new ReplayShareManager();
        manager.recordAction(1, 'officer_1', 'MOVE', null, 0, 0, 0);

        const restored = new ReplayShareManager();
        const logs = await restored.importFromCompressedString(await manager.exportToCompressedString());

        expect(logs[0]?.actionType).toBe('MOVE');
        expect(restored.getCommandEvents()).toEqual([]);
    });
});
