# 도시 진입 화면 — T2I 프롬프트

게임의 도시 장면(canvas 480×240, 등각 격자 8종 건물)을 배경으로 쓰기 위한
프롬프트다. **코드의 실제 건물 순서와 크기에 맞춰** 작성했다 —
프롬프트가 이 표와 어긋나면 화면의 배지(building marker)와 어긋난다.

| # | 코드 타입 | 라벨 | 크기(W×H) | 지붕 |
|---|---|---|---|---|
| 1 | `GOVERNMENT` | 궁성 | 60×50 | 진홍 |
| 2 | `BARRACKS` | 둔영 | 50×40 | 석회빛 |
| 3 | `MARKET` | 시장 | 40×35 | 황토 |
| 4 | `FARM` | 농촌 | 50×30 | 흙 |
| 5 | `TEMPLE` | 사원 | 35×45 | 금 |
| 6 | `WORKSHOP` | 공방 | 40×35 | 청토 |
| 7 | `WALL` | 성문 | 80×15 | 회청 |
| 8 | `HOUSE` | 자택 | 30×25 | 회갈색 |

## 규칙 (반드시 지킬 것)

- **텍스트·라벨·아이콘·UI 없음.** 게임이 라벨과 배지를 위에 그린다.
- **인물 없음.** 특정 인물 likeness 를 요구하면 권리 문제가 생긴다.
- **특정 상용 게임 이름·화풍 지시 금지.** 프롬프트에 적지 않는다.
- **로그로/워터마크 없음.**
- 화면 중앙~중앙 하단은 건물 밀도가 낮아야 배지가 겹치지 않는다.

---

## 본 프롬프트 (영문)

```
Cinematic aerial three-quarter isometric view of an ancient East Asian walled
river-valley city at midday, hand-painted semi-realistic strategy game key art,
highly detailed architecture, warm late-morning light, soft atmospheric depth.

COMPOSITION — the city fills the whole frame edge to edge, seen from a high
three-quarter angle, roofscape reading as connected districts rather than a
grid. Eight landmark districts are visible and must stay in these relative
positions:

- UPPER CENTER, on the highest terrace, the largest structure: a monumental
  palace compound, three nested courtyards, double-eaved hip-and-gable roofs
  with deep sweeping eaves, vermilion timber columns, white stone balustrades,
  raised on a three-tier stone platform with a broad ceremonial stair.
- UPPER RIGHT, beside the palace: a fortified city gate — massive rammed-earth
  and grey-brick curtain wall running across the frame, a multi-bay gatehouse
  with tiled hip roof, barbican, wooden hoarding, arrow towers.
- MIDDLE LEFT: a military camp inside its own low wall — long drill yard,
  timber drill frames, weapon racks, rows of canvas tents, stable sheds.
- MIDDLE CENTER, a tight street market — tiled market hall with awnings, open
  stalls under coloured cloth canopies, storage jars, hanging signboards with
  no legible text, dense foot traffic absent.
- LOWER LEFT, outside the wall on open ground: a farm hamlet — thatched and
  timber cottages, fenced grain plots, water buffalo pen, a well, drying racks.
- LOWER CENTER: a craftsman workshop quarter — a foundry, a large chimney,
  open-sided timber sheds, anvil and forge glow, stacked timber and ore.
- LOWER RIGHT: a small inn row — two-storey timber-frame inns with tiled
  roofs, hanging cloth banners, a courtyard well, a few empty benches.
- OUTER RIGHT EDGE, quiet: modest residential houses, one to two storeys,
  grey clay tile roofs, plaster and timber walls, narrow lanes.

SURROUNDINGS: outer city wall ring, a river and a stone-arched bridge on the
far side, layered forested mountains and haze on the horizon, autumn-tinted
and green trees, dirt and stone streets with subtle cart ruts, small figures
far away rendered as tiny silhouettes only.

STYLE: semi-realistic painted concept art, Chinese and Korean Three Kingdoms
era timber architecture, grey ceramic roof tiles, dark timber structure,
whitewashed walls, muted earth palette with vermilion and gold accents,
crisp micro-detail on tiles and joinery, soft global illumination, mild
atmospheric perspective, no text.
```

## 네거티브

```
text, letters, captions, labels, signage, watermark, logo, UI, HUD, buttons,
close-up character portrait, identifiable person, real people, modern buildings,
cars, power lines, plastic, neon, oversaturated, HDR halo, heavy vignette,
fisheye distortion, blurry, low detail, jpeg artifacts, duplicate buildings,
mirrored layout
```

---

## 변형

### 계절 4종 (`SEASON_COLORS`)

| 계절 | 지붕 | 벽 | 지면 |
|---|---|---|---|
| 봄 | 세이지 `#8BAA6E` | 밝은 모래 `#D4C5A9` | 연두 `#7CB342` |
| 여름 | 짙은 초록 `#5B8C4E` | 황토 `#C4B599` | 진한 녹 `#558B2F` |
| 가을 | 갈색 `#B8864E` | 뿌연 모래 `#BFA580` | 갈색 흙 `#8D6E3F` |
| 겨울 | 흰 회 `#E8E8F0` | 회백 `#D4D0C8` | 회백 `#BDBDBD` |

프롬프트에 한 줄만 바꿔 넣는다:
`[SPRING] early spring, pale blossom trees, fresh green fields`
`[SUMMER] high summer, dense deep-green canopy, harsh bright sun`
`[AUTUMN] late autumn, amber and russet foliage, golden low sun`
`[WINTER] winter, bare snow-dusted trees, grey overcast light, thin snow on grey tile roofs`

### 주야 4상 (`dayNightPhase`)

`[DAWN] blue-hour dawn, low amber sun from the east, long raking shadows, lit paper lanterns`
`[DAY] clear midday, short soft shadows, bright neutral light`
`[DUSK] golden hour sunset, warm orange rim light, long violet shadows, lantern glow beginning`
`[NIGHT] deep night, dark blue-black, warm window and lantern light, moonlit tile roofs`

야간에는 `applyNightTint` 가 `rgba(8,12,48, night*0.42)` 의 청색 안개를 얹으므로,
**기본 이미지 대비 채도를 낮추고** 랜턴 광원만 강조한다.

### 개발도 레벨

`developmentLevel` 이 오를수록 건물 수와 크기가 늘어난다(`+15%/레벨`).
고개발도 배경: `[LEVEL 5] densely developed, all districts expanded, more
outbuildings, busier streets, richer detailing`.

---

## 규격

| 용도 | 비율 | 해상도 |
|---|---|---|
| 도시 장면 캔버스 | **2:1** | 1920×960 (코드가 480×240 을 4배로) |
| 진입 화면 전체 | 16:9 | 2560×1440 |

배경은 **2:1 로 먼저 만들고** 16:9 가 필요하면 상하를 자연 extension 하는 편이
건물이 잘리지 않는다.
