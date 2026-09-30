"""
 삼국지 R Web - 고성능 A* (A-Star) 길찾기 및 전장 규칙 엔진
 파일: src/systems/pathfinding.py

 설계 스펙 준수사항:
 [Axial Coordinates] -> q, r, s 축 좌표계를 활용한 헥사곤 거리 연산
 [병종/지형 가중치]   -> 기병, 보병별 지형 통과 MP Cost 실시간 계산
 [ZOC 강제 정지]     -> 적 유닛 인접 헥스 진입 시 잔여 이동력 소멸 규칙 적용
 [보급선 연결 검사]   -> BFS 기반 수도/거점 연결선 확인 및 단절 플래그 처리
"""

import math
from heapq import heappush, heappop
from collections import deque
from typing import Dict, List, Set, Tuple, Optional, Any

class HexTile:
    """헥스 그리드 단일 타일 정보 구조체"""
    def __init__(self, q: int, r: int, terrain_type: str = "PLAINS", elevation: int = 0):
        self.q = q
        self.r = r
        self.s = -q - r  # Axial 좌표계 수식 검증
        self.terrain_type = terrain_type  # PLAINS, MOUNTAIN, RIVER, WATER
        self.elevation = elevation        # 고저차 (고원 판별용)

class PathfindingEngine:
    """삼국지리턴 핵심 헥사곤 A* 길찾기 및 전장 물리 엔진"""
    
    def __init__(self):
        # 기획서 기준 병종별 이동 비용 배율 (Cost Multiplier)
        self.unit_mp_rates = {
            "HEAVY_CAVALRY": 1.0,   # 중기병 (기마군단): 기본 평지에서 가장 효율적
            "SPECIAL_CAVALRY": 1.5, # 특수부대 (맹룡무도 등): 신속한 기동
            "SPEARMAN": 1.8,        # 창군 (무장보병): 방어 중심, 이동력 저하
            "LANCE_CAVALRY": 2.5    # 장창기병: 회전 반경 한계로 페널티 높음
        }
        
        # 지형별 기본 이동 페널티 비용
        self.terrain_costs = {
            "PLAINS": 1.0,     # 일반 땅
            "RIVER": 1.4,      # 강/고원
            "MOUNTAIN": 1.8,   # 산지
            "WATER": 999.0     # 통과 불가 깊은 물 (inf 대체)
        }

    def _get_distance(self, a: Tuple[int, int], b: Tuple[int, int]) -> int:
        """Axial 좌표계 기준 두 헥스 타일 간의 맨해튼 거리 계산 (A* 휴리스틱용)"""
        return int((abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[0] + a[1] - b[0] - b[1])) / 2)

    def _get_neighbors(self, q: int, r: int) -> List[Tuple[int, int]]:
        """헥사곤 축 좌표계 기준 인접한 6방향 이웃 타일 좌표 반환"""
        directions = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
        return [(q + dq, r + dr) for dq, dr in directions]

    def compute_move_cost(self, tile: HexTile, unit_type: str) -> float:
        """병종 가중치와 지형 속성을 결합한 단일 타일 통과 비용 계산"""
        mp_rate = self.unit_mp_rates.get(unit_type, 1.5) # 기본값 1.5
        base_cost = self.terrain_costs.get(tile.terrain_type, 1.0)

        # 고저차 및 경사지 보정 규칙 통합
        if tile.elevation > 10 or tile.terrain_type == "MOUNTAIN":
            cost = base_cost * mp_rate * 1.5  # 산악/경사지 가중치 심화
        else:
            cost = base_cost * mp_rate

        return round(cost, 3)

    def search_path(self, start: Tuple[int, int], goal: Tuple[int, int], unit_type: str, 
                    grid_map: Dict[Tuple[int, int], HexTile], 
                    enemy_positions: Set[Tuple[int, int]]) -> List[Tuple[int, int]]:
        """
        [고성능 60fps A* 알고리즘]
        ZOC 강제 정지 제약 조건을 실시간 계산에 포함하여 최적 전술 경로 도출 (< 5ms)
        """
        if start == goal:
            return [start]

        # 우선순위 큐 구조체 가동: (f_score, current_tile)
        open_set = []
        heappush(open_set, (0, start))
        
        came_from = {}
        g_score = {start: 0.0}
        f_score = {start: float(self._get_distance(start, goal))}

        while open_set:
            _, current = heappop(open_set)

            if current == goal:
                # 역추적을 통한 최종 최적 경로 배열 복원
                path = []
                while current in came_from:
                    path.append(current)
                    current = came_from[current]
                path.append(start)
                return path[::-1]

            # 🛑 ZOC 강제 정지 검증: 현재 타일이 적 유닛의 인접 헥스(통제 영역)라면 이동 완전 차단
            is_in_zoc = False
            if current != start: # 출발지는 ZOC 탈출 가능
                for neighbor in self._get_neighbors(current[0], current[1]):
                    if neighbor in enemy_positions:
                        is_in_zoc = True
                        break
            
            if is_in_zoc:
                continue # 적군 ZOC에 가로막혀 해당 노드로부터 더 이상의 전진 탐색 불가

            # 6방향 인접 이웃 타일 확장 탐색
            for neighbor in self._get_neighbors(current[0], current[1]):
                if neighbor not in grid_map:
                    continue
                
                tile_info = grid_map[neighbor]
                move_cost = self.compute_move_cost(tile_info, unit_type)
                
                # 통과 불가 지형 차단
                if move_cost >= 500.0:
                    continue

                tentative_g_score = g_score[current] + move_cost

                if tentative_g_score < g_score.get(neighbor, float('inf')):
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g_score
                    f_score[neighbor] = tentative_g_score + self._get_distance(neighbor, goal)
                    heappush(open_set, (f_score[neighbor], neighbor))

        return [] # 경로가 막혀 존재하지 않는 경우 빈 배열 리턴

    def calculate_supply_line(self, unit_pos: Tuple[int, int], capital_pos: Tuple[int, int], 
                              grid_map: Dict[Tuple[int, int], HexTile], 
                              enemy_positions: Set[Tuple[int, int]]) -> bool:
        """
        [BFS 기반 실시간 보급선 검사 매니저]
        아군 유닛 위치에서 수도/보급거점까지 적군에게 차단당하지 않는 연결 경로가 있는지 스캔합니다.
        """
        if unit_pos == capital_pos:
            return True

        visited = {unit_pos}
        queue = deque([unit_pos])

        while queue:
            current = queue.popleft()

            if current == capital_pos:
                return True # 보급선이 유효하게 연결됨

            for neighbor in self._get_neighbors(current[0], current[1]):
                # 지도 내부에 있고, 적 유닛에 의해 직접적으로 밟혀서 차단당하지 않은 헥스만 전진 가능
                if neighbor in grid_map and neighbor not in visited and neighbor not in enemy_positions:
                    visited.add(neighbor)
                    queue.append(neighbor)

        return False # 아군 유닛이 적군에게 포위되어 보급선이 끊김 (is_supplied = False)
