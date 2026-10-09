import json
import zlib
import base64
from typing import Dict, List, Optional, Any

class ReplayManager:
    """
    삼국지리턴 웹 프로젝트 - 초고속 100-kB 리플레이 압축 및 복원 매니저
    방대한 전투 로그를 zlib 및 Base64로 압축하여 URL 공유 파라미터 크기를 극한으로 줄입니다.
    """
    def __init__(self):
        self.current_battle_logs: List[Dict[str, Any]] = []

    def clear_logs(self):
        """새로운 전투 시작 시 기존 로그 초기화"""
        self.current_battle_logs.clear()

    def record_action(self, turn: int, officer_id: str, action_type: str, target_id: Optional[str], value: int, x: int, y: int):
        """
        [O(1) 실시간 로그 기록]
        전투 중 발생하는 모든 행동(이동, 공격, 계략, 피해량)을 딕셔너리 구조로 빠르게 누적합니다.
        데이터 다이어트를 위해 key 이름을 1글자로 축소화(Minification)하여 저장합니다.
        """
        log_entry = {
            "t": turn,         # 턴 수
            "o": officer_id,   # 행동 무장 ID
            "a": action_type,  # 행동 종류 (MOVE, ATTACK, STRATAGEM)
            "g": target_id,    # 대상 무장 ID (없으면 None)
            "v": value,        # 피해량 또는 회복량
            "x": x,            # 웹 그리드 X 좌표
            "y": y             # 웹 그리드 Y 좌표
        }
        self.current_battle_logs.append(log_entry)

    def export_to_compressed_string(self) -> str:
        """
        [핵심 기능: 100-kB 가압축 파이프라인]
        1. 전체 전투 로그를 가벼운 JSON 문자열로 변환합니다.
        2. zlib 엔진을 사용하여 바이트 배열로 초고압축을 수행합니다.
        3. 브라우저 URL 주소창 파라미터(?replay=...)에 들어갈 수 있도록 안전한 Base64 문자열로 변환합니다.
        """
        try:
            if not self.current_battle_logs:
                return ""
            
            # 1. JSON 직렬화
            json_str = json.dumps(self.current_battle_logs, ensure_ascii=False)
            
            # 2. zlib 최대 압축 레벨(9) 적용
            compressed_bytes = zlib.compress(json_str.encode('utf-8'), level=9)
            
            # 3. URL-Safe Base64 인코딩 후 디코딩하여 문자열 반환
            compressed_url_str = base64.urlsafe_b64encode(compressed_bytes).decode('utf-8')
            
            print(f"[ReplayEngine] 압축 완료! 원본 크기: {len(json_str)} bytes -> 압축 크기: {len(compressed_url_str)} bytes")
            return compressed_url_str
            
        except Exception as e:
            print(f"[ReplayEngine] 압축 중 오류 발생: {str(e)}")
            return ""

    def import_from_compressed_string(self, compressed_str: str) -> List[Dict[str, Any]]:
        try:
            if not compressed_str:
                return []
            compressed_bytes = base64.urlsafe_b64decode(compressed_str.encode('utf-8'))
            decompressed_bytes = zlib.decompress(compressed_bytes)
            battle_logs = json.loads(decompressed_bytes.decode('utf-8'))
            return battle_logs
        except Exception as e:
            return []

    def compress_save_data(self, save_dict: Dict[str, Any]) -> str:
        # [302] 세이브 데이터 초고효율 압축
        json_str = json.dumps(save_dict, ensure_ascii=False)
        compressed_bytes = zlib.compress(json_str.encode('utf-8'), level=9)
        return base64.urlsafe_b64encode(compressed_bytes).decode('utf-8')
