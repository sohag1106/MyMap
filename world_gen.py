# Convert countries.geo.json -> site/world_data.js (Mercator px paths + centroids + Bangla names)
import json, io, math

SRC = r"C:\MyMap\countries.geo.json"
OUT = r"C:\MyMap\site\world_data.js"

W = 1000.0
LAT_CLIP = 85.0
K = W / (2 * math.pi)          # lon -> px
def merc_y(lat):
    lat = max(-LAT_CLIP, min(LAT_CLIP, lat))
    return K * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
Y_MAX = merc_y(LAT_CLIP)        # top edge
H = 2 * Y_MAX

def proj(lon, lat):
    return (lon * math.pi / 180 * K, Y_MAX - merc_y(lat))

def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    # iterative Douglas-Peucker
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        nrm = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if nrm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / nrm
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]

def fmt(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s

def ring_area(r):
    s = 0.0
    for i in range(len(r)):
        x1, y1 = r[i]; x2, y2 = r[(i + 1) % len(r)]
        s += x1 * y2 - x2 * y1
    return s / 2

def point_in_rings(pt, rings):
    x, y = pt
    inside = False
    for r in rings:
        c = False
        j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
                c = not c
            j = i
        if c:
            inside = not inside   # even-odd across all rings
    return inside

def centroid(rings):
    # area-weighted centroid of largest ring, with containment fallbacks
    big = max(rings, key=lambda r: abs(ring_area(r)))
    a = cx = cy = 0.0
    for i in range(len(big)):
        x1, y1 = big[i]; x2, y2 = big[(i + 1) % len(big)]
        cr = x1 * y2 - x2 * y1
        a += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr
    a *= 0.5
    if abs(a) > 1e-9:
        c = (cx / (6 * a), cy / (6 * a))
        if point_in_rings(c, rings):
            return c
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    for gy in range(16):
        for gx in range(16):
            p = (x0 + (x1 - x0) * (gx + .5) / 16, y0 + (y1 - y0) * (gy + .5) / 16)
            if point_in_rings(p, rings):
                return p
    return big[0]

BN = {
 "Afghanistan":"আফগানিস্তান","Albania":"আলবেনিয়া","Algeria":"আলজেরিয়া","Angola":"অ্যাঙ্গোলা",
 "Argentina":"আর্জেন্টিনা","Armenia":"আর্মেনিয়া","Australia":"অস্ট্রেলিয়া","Austria":"অস্ট্রিয়া",
 "Azerbaijan":"আজারবাইজান","Bangladesh":"বাংলাদেশ","Belarus":"বেলারুস","Belgium":"বেলজিয়াম",
 "Belize":"বেলিজ","Benin":"বেনিন","Bermuda":"বারমুডা","Bhutan":"ভুটান","Bolivia":"বলিভিয়া",
 "Bosnia and Herzegovina":"বসনিয়া-হার্জেগোভিনা","Botswana":"বতসোয়া","Brazil":"ব্রাজিল",
 "Brunei":"ব্রুনাই","Bulgaria":"বুলগেরিয়া","Burkina Faso":"বুর্কিনা ফাসো","Burundi":"বুরুন্ডি",
 "Cambodia":"কম্বোডিয়া","Cameroon":"ক্যামেরুন","Canada":"কানাডা",
 "Central African Republic":"মধ্য আফ্রিকান প্রজাতন্ত্র","Chad":"চাদ","Chile":"চিলি","China":"চীন",
 "Colombia":"কলম্বিয়া","Costa Rica":"কোস্টা রিকা","Croatia":"ক্রোয়েশিয়া","Cuba":"কিউবা",
 "Cyprus":"সাইপ্রাস","Czech Republic":"চেক প্রজাতন্ত্র",
 "Democratic Republic of the Congo":"গণতান্ত্রিক কঙ্গো","Denmark":"ডেনমার্ক","Djibouti":"জিবুতি",
 "Dominican Republic":"ডোমিনিকান প্রজাতন্ত্র","East Timor":"পূর্ব তিমুর","Ecuador":"ইকুয়েডর",
 "Egypt":"মিশর","El Salvador":"এল সালভাডর","Equatorial Guinea":"ভূ-মধ্যরেখীয় গিনি",
 "Eritrea":"ইরিত্রিয়া","Estonia":"এস্তোনিয়া","Ethiopia":"ইথিওপিয়া",
 "Falkland Islands":"ফকল্যান্ড দ্বীপপুঞ্জ","Fiji":"ফিজি","Finland":"ফিনল্যান্ড","France":"ফ্রান্স",
 "French Guiana":"ফরাসি গিয়ানা","French Southern and Antarctic Lands":"ফরাসি দক্ষিণ ভূমি",
 "Gabon":"গ্যাবন","Gambia":"গাম্বিয়া","Georgia":"জর্জিয়া","Germany":"জার্মানি","Ghana":"ঘানা",
 "Greece":"গ্রিস","Greenland":"গ্রিনল্যান্ড","Guatemala":"গোয়াতেমালা","Guinea":"গিনি",
 "Guinea Bissau":"গিনি-বিসাউ","Guyana":"গায়ানা","Haiti":"হাইতি","Honduras":"হন্ডুরাস",
 "Hungary":"হাঙ্গেরি","Iceland":"আইসল্যান্ড","India":"ভারত","Indonesia":"ইন্দোনেশিয়া",
 "Iran":"ইরান","Iraq":"ইরাক","Ireland":"আয়ারল্যান্ড","Israel":"ইসরায়েল","Italy":"ইতালি",
 "Ivory Coast":"আইভরি কোস্ট","Jamaica":"জামাইকা","Japan":"জাপান","Jordan":"জর্ডান",
 "Kazakhstan":"কাজাখস্তান","Kenya":"কেনিয়া","Kosovo":"কসোভো","Kuwait":"কুয়েত",
 "Kyrgyzstan":"কির্গিজস্তান","Laos":"লাওস","Latvia":"লাতভিয়া","Lebanon":"লেবানন",
 "Lesotho":"লেসোথো","Liberia":"লাইবেরিয়া","Libya":"লিবিয়া","Lithuania":"লিথুয়েনিয়া",
 "Luxembourg":"লুক্সেমবুর্গ","Macedonia":"ম্যাসেডোনিয়া","Madagascar":"মাদাগাস্কার",
 "Malawi":"মালাউই","Malaysia":"মালয়েশিয়া","Mali":"মালি","Malta":"মাল্টা",
 "Mauritania":"মৌরিতানিয়া","Mexico":"মেক্সিকো","Moldova":"মলদোভা","Mongolia":"মঙ্গোলিয়া",
 "Montenegro":"মন্টিনিগ্রো","Morocco":"মরক্কো","Mozambique":"মোজাম্বিক","Myanmar":"মিয়ানমার",
 "Namibia":"নামিবিয়া","Nepal":"নেপাল","Netherlands":"নেদারল্যান্ডস",
 "New Caledonia":"নিউ ক্যালিডোনিয়া","New Zealand":"নিউজিল্যান্ড","Nicaragua":"নিকারাগুয়া",
 "Niger":"নাইজার","Nigeria":"নাইজেরিয়া","North Korea":"উত্তর কোরিয়া",
 "Northern Cyprus":"উত্তর সাইপ্রাস","Norway":"নরওয়ে","Oman":"ওমান","Pakistan":"পাকিস্তান",
 "Panama":"পানামা","Papua New Guinea":"পাপুয়া নিউ গিনি","Paraguay":"প্যারাগুয়ে","Peru":"পেরু",
 "Philippines":"ফিলিপিনস","Poland":"পোল্যান্ড","Portugal":"পর্তুগাল","Puerto Rico":"পুয়ের্তো রিকো",
 "Qatar":"কাতার","Republic of Serbia":"সার্বিয়া","Republic of the Congo":"কঙ্গো প্রজাতন্ত্র",
 "Romania":"রোমানিয়া","Russia":"রাশিয়া","Rwanda":"রুয়ান্ডা","Saudi Arabia":"সৌদি আরব",
 "Senegal":"সেনেগাল","Sierra Leone":"সিয়েরা লিওন","Slovakia":"স্লোভাকিয়া",
 "Slovenia":"স্লোভেনিয়া","Solomon Islands":"সলোমন দ্বীপপুঞ্জ","Somalia":"সোমালিয়া",
 "Somaliland":"সোমালিল্যান্ড","South Africa":"দক্ষিণ আফ্রিকা","South Korea":"দক্ষিণ কোরিয়া",
 "South Sudan":"দক্ষিণ সুদান","Spain":"স্পেন","Sri Lanka":"শ্রীলঙ্কা","Sudan":"সুদান",
 "Suriname":"সুরিনাম","Swaziland":"সোয়াজিল্যান্ড","Sweden":"সুইডেন",
 "Switzerland":"সুইজারল্যান্ড","Syria":"সিরিয়া","Taiwan":"তাইওয়ান",
 "Tajikistan":"তাজিকিস্তান","Thailand":"থাইল্যান্ড","The Bahamas":"বাহামা দ্বীপপুঞ্জ",
 "Togo":"টোগো","Trinidad and Tobago":"ত্রিনিদাদ ও টোবাগো","Tunisia":"তিউনিসিয়া",
 "Turkey":"তুরস্ক","Turkmenistan":"তুর্কমেনিস্তান","Uganda":"উগান্ডা","Ukraine":"ইউক্রেন",
 "United Arab Emirates":"সংযুক্ত আরব আমিরাত","United Kingdom":"যুক্তরাজ্য",
 "United Republic of Tanzania":"তানজানিয়া","United States of America":"মার্কিন যুক্তরাষ্ট্র",
 "Uruguay":"উরুগুয়ে","Uzbekistan":"উজবেকিস্তান","Vanuatu":"ভানুয়াতু","Venezuela":"ভেনেজুয়েলা",
 "Vietnam":"ভিয়েতনাম","West Bank":"পশ্চিম তীর","Western Sahara":"পশ্চিম সাহারা",
 "Yemen":"ইয়েমেন","Zambia":"জাম্বিয়া","Zimbabwe":"জিম্বাবুয়ে",
}

CONT = {
 "এশিয়া": ["Afghanistan","Armenia","Azerbaijan","Bangladesh","Bhutan","Brunei","Cambodia","China",
   "Cyprus","East Timor","Georgia","India","Indonesia","Iran","Iraq","Israel","Japan","Jordan",
   "Kazakhstan","Kuwait","Kyrgyzstan","Laos","Lebanon","Malaysia","Mongolia","Myanmar","Nepal",
   "North Korea","Northern Cyprus","Oman","Pakistan","Philippines","Qatar","Saudi Arabia",
   "South Korea","Sri Lanka","Syria","Taiwan","Tajikistan","Thailand","Turkey","Turkmenistan",
   "United Arab Emirates","Uzbekistan","Vietnam","West Bank","Yemen"],
 "ইউরোপ": ["Albania","Austria","Belarus","Belgium","Bosnia and Herzegovina","Bulgaria","Croatia",
   "Czech Republic","Denmark","Estonia","Finland","France","Germany","Greece","Hungary","Iceland",
   "Ireland","Italy","Kosovo","Latvia","Lithuania","Luxembourg","Macedonia","Malta","Moldova",
   "Montenegro","Netherlands","Norway","Poland","Portugal","Romania","Republic of Serbia","Russia",
   "Slovakia","Slovenia","Spain","Sweden","Switzerland","Ukraine","United Kingdom"],
 "আফ্রিকা": ["Algeria","Angola","Benin","Botswana","Burkina Faso","Burundi","Cameroon",
   "Central African Republic","Chad","Democratic Republic of the Congo","Djibouti","Egypt",
   "Equatorial Guinea","Eritrea","Ethiopia","Gabon","Gambia","Ghana","Guinea","Guinea Bissau",
   "Ivory Coast","Kenya","Lesotho","Liberia","Libya","Madagascar","Malawi","Mali","Mauritania",
   "Morocco","Mozambique","Namibia","Niger","Nigeria","Republic of the Congo","Rwanda","Senegal",
   "Sierra Leone","Somalia","Somaliland","South Africa","South Sudan","Sudan","Swaziland","Togo",
   "Tunisia","Uganda","United Republic of Tanzania","Western Sahara","Zambia","Zimbabwe"],
 "উত্তর আমেরিকা": ["Belize","Bermuda","Canada","Costa Rica","Cuba","Dominican Republic",
   "El Salvador","Greenland","Guatemala","Haiti","Honduras","Jamaica","Mexico","Nicaragua",
   "Panama","Puerto Rico","The Bahamas","Trinidad and Tobago","United States of America"],
 "দক্ষিণ আমেরিকা": ["Argentina","Bolivia","Brazil","Chile","Colombia","Ecuador","Falkland Islands",
   "French Guiana","Guyana","Paraguay","Peru","Suriname","Uruguay","Venezuela"],
 "ওশেনিয়া": ["Australia","Fiji","French Southern and Antarctic Lands","New Caledonia",
   "New Zealand","Papua New Guinea","Solomon Islands","Vanuatu"],
}

g = json.load(io.open(SRC, encoding="utf-8"))
feats = [f for f in g["features"] if f["properties"]["name"] != "Antarctica"]

missing_bn = sorted(f["properties"]["name"] for f in feats if f["properties"]["name"] not in BN)
if missing_bn:
    raise SystemExit("missing Bangla names: " + json.dumps(missing_bn, ensure_ascii=False))

names = [f["properties"]["name"] for f in feats]
cont_of = {}
for cont, members in CONT.items():
    for n in members:
        if n in cont_of:
            raise SystemExit(f"duplicate continent entry: {n}")
        cont_of[n] = cont
bad = sorted(set(names) - set(cont_of)) or sorted(set(cont_of) - set(names))
if bad:
    raise SystemExit("continent list does not match dataset: " + json.dumps(bad, ensure_ascii=False))
print("continents:", [len(m) for m in CONT.values()], "total", len(cont_of))

out = []
for f in feats:
    name = f["properties"]["name"]
    geom = f["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings_px = []
    for poly in polys:
        for ring in poly:
            pts = [proj(lon, lat) for lon, lat in ring]
            pts = rdp(pts, 0.35)
            if len(pts) < 3:
                continue
            rings_px.append(pts)
    if not rings_px:
        continue
    d = ""
    for r in rings_px:
        d += "M" + "L".join(fmt(x) + "," + fmt(y) for x, y in r) + "Z"
    cx, cy = centroid(rings_px)
    out.append({"i": f.get("id", ""), "n": name, "d": d, "c": [round(cx, 1), round(cy, 1)],
                "ct": cont_of[name]})

out.sort(key=lambda o: o["n"])
payload = {"w": W, "h": round(H, 1), "f": out}
js = "const WORLD=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
js += "const WORLD_BN=" + json.dumps(BN, ensure_ascii=False, separators=(",", ":")) + ";\n"
io.open(OUT, "w", encoding="utf-8", newline="\n").write(js)
print(f"countries: {len(out)}  size: {len(js)} bytes  canvas: {W}x{round(H,1)}")
