self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'START_AI_TURN') {
    try {
      const { factions, officers, cities } = payload;
      
      // 1,000명 무장을 세력/도시별 시뮬레이션 큐로 분할
      for (const factionId of Object.keys(factions)) {
        const factionOfficers = officers.filter(o => o.factionId === factionId && !o.isPlayer);
        const factionDecisions = [];

        // 해당 세력 소속 NPC 무장들의 AI 의사결정 연산
        for (const officer of factionOfficers) {
          const decision = calculateOfficerDecision(officer, cities, factions);
          factionDecisions.push(decision);
        }

        // 💡 중요: 세력 단위 연산이 끝날 때마다 메인 스레드로 즉시 스트리밍 전송
        self.postMessage({
          type: 'STREAM_FACTION_DECISION',
          data: {
            factionId,
            decisions: factionDecisions
          }
        });

        // 메인 스레드 인터리빙 및 마이크로 태스크 양보를 위한 미세 딜레이 (UI 부하 분산)
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // 1,000명 무장의 모든 연산이 완수됨을 보고
      self.postMessage({ type: 'AI_TURN_COMPLETE' });

    } catch (error) {
      self.postMessage({ type: 'ERROR', data: error.message });
    }
  }
};

// 가중치 기반 무장 개별 AI 행동 추론 알고리즘
function calculateOfficerDecision(officer, cities, factions) {
  // 삼국지리턴 기획서 기준: 야망, 의리, 군주 성향 및 도시 자원 분석 데이터 반영
  // 예: 군주가 조조 성향(패도)이고 병력이 부족하다면 '징병' 또는 '순찰' 가중치 상향
  let action = 'IDLE';
  let targetId = null;

  if (officer.ambition > 70) {
    action = 'MILITARY_DRAFT'; // 징병
  } else if (officer.loyalty < 40) {
    action = 'DEFECT'; // 하야 및 이주
  } else {
    action = 'INTERNAL_DEVELOP'; // 상업/개간 내정
  }

  return {
    officerId: officer.id,
    action,
    targetId,
    timestamp: Date.now()
  };
}
