"""Generate a square 4096x4096 Three Kingdoms China map from Natural Earth data.

Public domain source (Natural Earth). Places every city/pass from real
lat/lon so markers cannot drift from the coastline, which was the whole
point of regenerating instead of hand-placing.
"""
import json, math, os, tempfile, urllib.request
from PIL import Image, ImageDraw, ImageFont

SIZE = 4096
FONT_PATH = r'C:\Windows\Fonts\malgunbd.ttf'
FONT_REG = r'C:\Windows\Fonts\malgun.ttf'
TMP = os.path.join(tempfile.gettempdir(), 'rtk8-mapgen')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
os.makedirs(TMP, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'

def fetch(name):
    p = os.path.join(TMP, name)
    if not os.path.exists(p):
        urllib.request.urlretrieve(NE + name, p)
    return json.load(open(p, encoding='utf-8'))

CITIES = [
    ('C001', '장안', 'S', 34.341, 108.940, '중앙/서부'),
    ('C002', '낙양', 'S', 34.619, 112.454, '중원'),
    ('C003', '허창', 'S', 34.035, 113.850, '중원'),
    ('C004', '업', 'S', 38.240, 114.622, '하북'),
    ('C005', '진양', 'S', 37.870, 112.548, '하북'),
    ('C006', '한중', 'S', 33.068, 107.023, '한중'),
    ('C007', '성도', 'S', 30.657, 104.066, '익주'),
    ('C008', '건업', 'S', 32.060, 118.797, '강동'),
    ('C009', '강릉', 'S', 30.333, 112.194, '형주'),
    ('C010', '남양', 'S', 33.004, 112.529, '하북'),
    ('C011', '여남', 'S', 32.980, 114.360, '중원'),
    ('C012', '서주', 'A', 34.205, 117.286, '서주'),
    ('C013', '양양', 'A', 32.010, 112.122, '형주'),
    ('C014', '신야', 'A', 32.523, 112.350, '형주'),
    ('C015', '장사', 'A', 28.228, 112.939, '형주'),
    ('C016', '계양', 'A', 23.550, 116.372, '형남'),
    ('C017', '남중', 'S', 25.038, 102.718, '남중'),
    ('C018', '광한', 'S', 30.998, 104.282, '익주'),
    ('C019', '단양', 'A', 32.000, 119.430, '강동'),
    ('C020', '오', 'A', 31.299, 120.585, '강동'),
    ('C021', '상용', 'A', 31.500, 110.700, '한중/형주'),
    ('C022', '무창', 'S', 30.593, 114.305, '강동'),
    ('C023', '강하', 'A', 30.350, 114.200, '형주'),
    ('C024', '파동', 'B', 31.050, 110.400, '익주'),
    ('C025', '영릉', 'A', 26.400, 111.600, '형남'),
    ('C026', '교지', 'B', 21.028, 105.854, '교주'),
    ('C027', '평양', 'S', 39.039, 125.762, '고구려'),
    ('C028', '선안', 'S', 41.150, 123.200, '요동'),
    ('C029', '지안', 'A', 41.124, 126.194, '고구려'),
    ('C030', '낙랑', 'A', 38.500, 125.700, '한반도/북방'),
    ('C031', '북평', 'A', 39.904, 116.407, '요동권'),
    ('C032', '사비', 'S', 36.350, 127.385, '백제'),
    ('C033', '한산', 'A', 36.800, 126.500, '백제'),
    ('C034', '웅진', 'A', 36.600, 127.100, '백제'),
    ('C035', '경주', 'S', 35.856, 129.225, '신라'),
    ('C036', '대야성', 'A', 38.100, 125.700, '요동'),
    ('C037', '가락', 'A', 35.500, 128.500, '신라'),
    ('C038', '안동', 'A', 36.568, 128.729, '신라'),
    ('C039', '야마토', 'A', 34.685, 135.533, '일본'),
    ('C040', '구주', 'A', 33.590, 130.402, '일본'),
    ('C041', '오키나와', 'A', 26.212, 127.679, '일본'),
    ('C042', '대만', 'B', 25.033, 121.565, '대만'),
]

PASSES = [
    ('P001', '함곡관', 34.522, 110.895),
    ('P002', '潼關', 34.545, 110.150),
    ('P003', '산관', 33.900, 108.100),
    ('P004', '검각', 32.300, 105.500),
    ('P005', '검문관', 32.200, 105.700),
    ('P006', '호로관', 36.100, 110.100),
    ('P007', '양관', 39.927, 98.340),
    ('P008', '정관', 38.100, 114.200),
    ('P009', '형관', 39.350, 112.650),
    ('P010', '계량', 30.700, 111.290),
    ('P011', '적벽', 29.720, 113.880),
    ('P012', '의릉', 30.530, 111.290),
    ('P013', '대방곡', 34.300, 106.900),
    ('P014', '창오', 23.500, 111.300),
    ('P015', '한중협', 33.100, 106.900),
    ('P016', '강하수운', 30.400, 114.200),
]

lons = [c[4] for c in CITIES] + [p[3] for p in PASSES]
lats = [c[3] for c in CITIES] + [p[2] for p in PASSES]
LON0, LON1 = min(lons), max(lons)
LAT0, LAT1 = min(lats), max(lats)
LAT_REF = math.radians((LAT0 + LAT1) / 2)
KX = math.cos(LAT_REF)

span_x = (LON1 - LON0) * KX
span_y = (LAT1 - LAT0)
ext = max(span_x, span_y)
ext *= 1.10
cx = (LON0 + LON1) / 2
cy = (LAT0 + LAT1) / 2
SCALE = SIZE / ext

def px(lon, lat):
    return ((lon - cx) * KX * SCALE + SIZE / 2,
            SIZE / 2 - (lat - cy) * SCALE)

print('lon {:.2f}..{:.2f}  lat {:.2f}..{:.2f}  scale {:.2f} px/deg'.format(LON0, LON1, LAT0, LAT1, SCALE))

SEAFILL = (198, 214, 214)
LANDFILL = (222, 214, 185)
COAST = (72, 64, 52)
RIVER = (96, 148, 186)

def ring_bbox(ring, pad=1.5):
    xs = [r[0] for r in ring]
    ys = [r[1] for r in ring]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad

def visible(ring, pad=1.5):
    x0, y0, x1, y1 = ring_bbox(ring, pad)
    return not (x1 < 0 or y1 < 0 or x0 > SIZE or y0 > SIZE)

def draw_geo(img, draw, geo, fill, outline, width):
    for feat in geo['features']:
        geom = feat.get('geometry')
        if not geom:
            continue
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        for poly in polys:
            if not poly:
                continue
            outer = [px(c[0], c[1]) for c in poly[0]]
            if not visible(outer):
                continue
            holes = [[px(c[0], c[1]) for c in h] for h in poly[1:] if len(h) > 2]
            draw.polygon(outer, fill=fill)
            for h in holes:
                draw.polygon(h, fill=SEAFILL)
            draw.line(outer + [outer[0]], fill=outline, width=width, joint='curve')

def draw_rivers(img, draw, geo, width):
    for feat in geo['features']:
        geom = feat.get('geometry')
        if not geom:
            continue
        lines = geom['coordinates'] if geom['type'] == 'LineString' else geom['coordinates']
        for ln in lines:
            pts = [px(c[0], c[1]) for c in ln]
            if len(pts) < 2 or not visible(pts, 8):
                continue
            draw.line(pts, fill=RIVER, width=width, joint='curve')

base = Image.new('RGB', (SIZE, SIZE), SEAFILL)
d = ImageDraw.Draw(base)
draw_geo(base, d, fetch('ne_50m_land.geojson'), LANDFILL, COAST, 3)
draw_rivers(base, d, fetch('ne_50m_rivers_lake_centerlines.geojson'), 5)

marks = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
md = ImageDraw.Draw(marks)
GRADE = {'S': (198, 48, 44), 'A': (222, 128, 44), 'B': (72, 128, 196)}
RADIUS = {'S': 26, 'A': 20, 'B': 15}
f_city = ImageFont.truetype(FONT_PATH, 46)
f_pass = ImageFont.truetype(FONT_REG, 38)
halo = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(halo)

for cid, name, grade, lat, lon, region in CITIES:
    x, y = px(lon, lat)
    r = RADIUS[grade]
    md.ellipse([x - r, y - r, x + r, y + r], fill=GRADE[grade] + (255,), outline=(252, 250, 244, 255), width=5)
    hd.text((x + r + 12, y - 24), name, font=f_city, fill=(252, 250, 244, 235))
    md.text((x + r + 12, y - 24), name, font=f_city, fill=(28, 22, 18, 255))
for pid, name, lat, lon in PASSES:
    x, y = px(lon, lat)
    s = 20
    md.polygon([(x, y - s), (x + s, y), (x, y + s), (x - s, y)], fill=(122, 92, 168, 255), outline=(252, 250, 244, 255), width=4)
    hd.text((x + s + 12, y - 20), name, font=f_pass, fill=(252, 250, 244, 235))
    md.text((x + s + 12, y - 20), name, font=f_pass, fill=(52, 36, 76, 255))

marks = Image.alpha_composite(halo, marks)

geo_only = base.copy()
base = Image.alpha_composite(base.convert('RGBA'), marks).convert('RGB')
geo_only.save(os.path.join(OUT, 'map-china-4096.webp'), 'WEBP', quality=86, method=6)
geo_only.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'map-preview-1024.png'))
base.save(os.path.join(OUT, 'map-china-guide-4096.png'))

out = {
    'map': {'width': SIZE, 'height': SIZE, 'aspect': '1:1',
            'projection': 'equirectangular (cos lat_ref {:.4f})'.format(KX),
            'lon_range': [LON0, LON1], 'lat_range': [LAT0, LAT1],
            'scale_px_per_deg': round(SCALE, 4)},
    'source': 'Natural Earth 50m (public domain) coastline + rivers; markers placed from real lat/lon',
    'license_note': 'Geometry from Natural Earth (public domain). Marker placement is factual coordinates.',
    'cities': [{'id': c[0], 'name': c[1], 'grade': c[2], 'lat': c[3], 'lon': c[4], 'region': c[5],
                'x': round(px(c[4], c[3])[0]), 'y': round(px(c[4], c[3])[1])} for c in CITIES],
    'passes': [{'id': p[0], 'name': p[1], 'lat': p[2], 'lon': p[3],
                'x': round(px(p[3], p[2])[0]), 'y': round(px(p[3], p[2])[1])} for p in PASSES],
}
json.dump(out, open(os.path.join(OUT, 'map-coordinates-4096.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('cities', len(CITIES), 'passes', len(PASSES))
print('wrote', OUT)
