"""Extract the FIFTH COPY logo from page 8 of docs/spec/art-direction.pdf as pure-vector SVGs.
Bars and tiles come from the page's vector drawings; letters are the embedded Stardos Stencil glyph
outlines placed with each glyph's origin, size and direction (no <text>, no font needed)."""
import io, sys, pymupdf
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

PDF, OUT = sys.argv[1], sys.argv[2]
doc = pymupdf.open(PDF); page = doc[7]
hexc = lambda c: "#%02X%02X%02X" % tuple(round(x * 255) for x in c)
fonts = {}
def font(name):
    if name not in fonts:
        xref = next(f[0] for f in page.get_fonts() if f[3].endswith(name))
        fonts[name] = TTFont(io.BytesIO(doc.extract_font(xref)[3]))
    return fonts[name]

drawings = page.get_drawings()
traces = [t for t in page.get_texttrace() if "Stardos" in t["font"]]
f2 = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")

def drawing_path(dr):
    out, cur = [], None
    for it in dr["items"]:
        op = it[0]
        if op == "re":
            r = it[1]; out.append(f"M{f2(r.x0)} {f2(r.y0)}H{f2(r.x1)}V{f2(r.y1)}H{f2(r.x0)}Z"); cur = None; continue
        if op == "qu":
            q = it[1]; out.append("M" + "L".join(f"{f2(p.x)} {f2(p.y)}" for p in (q.ul, q.ur, q.lr, q.ll)) + "Z"); cur = None; continue
        a = it[1]
        if cur is None or abs(cur.x - a.x) > 1e-3 or abs(cur.y - a.y) > 1e-3: out.append(f"M{f2(a.x)} {f2(a.y)}")
        if op == "l": b = it[2]; out.append(f"L{f2(b.x)} {f2(b.y)}"); cur = b
        elif op == "c": c1, c2, b = it[2], it[3], it[4]; out.append(f"C{f2(c1.x)} {f2(c1.y)} {f2(c2.x)} {f2(c2.y)} {f2(b.x)} {f2(b.y)}"); cur = b
    if dr.get("closePath"): out.append("Z")
    return "".join(out)

def glyph_path(t, ch):
    fnt = font(t["font"]); upm = fnt["head"].unitsPerEm
    name = fnt.getGlyphOrder()[ch[1]]
    pen = RecordingPen(); fnt.getGlyphSet()[name].draw(pen)
    (ox, oy), (dx, dy), k = ch[2], t["dir"], t["size"] / upm
    ux, uy = dy, -dx  # glyph "up" in y-down page space
    P = lambda gx, gy: f"{f2(ox + k * (gx * dx + gy * ux))} {f2(oy + k * (gx * dy + gy * uy))}"
    s = []
    for op, pts in pen.value:
        if op == "moveTo": s.append("M" + P(*pts[0]))
        elif op == "lineTo": s.append("L" + P(*pts[0]))
        elif op == "curveTo": s.append("C" + " ".join(P(*p) for p in pts))
        elif op == "qCurveTo":  # TrueType quadratic (possibly implied on-curve points)
            for i in range(len(pts) - 1):
                c = pts[i]; e = pts[i + 1] if i == len(pts) - 2 else ((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)
                s.append("Q" + P(*c) + " " + P(*e))
        elif op in ("closePath", "endPath"): s.append("Z")
    return "".join(s)

def in_box(pt, box): return box[0] <= pt[0] <= box[2] and box[1] <= pt[1] <= box[3]

VARIANTS = {  # name: (drawing indices, text box on the page, square viewBox?)
    "wordmark-red-on-paper": ([73], (100, 110, 330, 230), False),
    "wordmark-ink-on-red": ([74], (470, 110, 700, 230), False),
    "wordmark-red-on-ink": ([75], (100, 250, 330, 365), False),
    "wordmark-tagline-red-on-paper": ([76] + list(range(36, 54)), (480, 250, 700, 345), False),
    "monogram-paper": ([77, 78, 79], (25, 400, 105, 480), True),
    "monogram-red": ([80, 81], (110, 410, 170, 470), True),
    "monogram-ink": ([82, 83], (172, 410, 232, 470), True),
}
for name, (idx, box, square) in VARIANTS.items():
    els, rect = [], pymupdf.Rect()
    for i in idx:
        dr = drawings[i]; rect |= dr["rect"]
        els.append((hexc(dr["fill"]), drawing_path(dr)))
    by_colour = {}
    for t in traces:
        for ch in t["chars"]:
            if in_box(ch[2], box):
                rect |= pymupdf.Rect(ch[3])
                by_colour.setdefault(hexc(t["color"]), []).append(glyph_path(t, ch))
    els += [(c, "".join(ps)) for c, ps in by_colour.items()]
    x, y, w, h = rect.x0, rect.y0, rect.width, rect.height
    if square:
        side = max(w, h); x -= (side - w) / 2; y -= (side - h) / 2; w = h = side
    title = name.replace("-", " ").replace("wordmark", "Fifth Copy wordmark").replace("monogram", "Fifth Copy FC monogram")
    body = "".join(f'<path fill="{c}" d="{d}"/>' for c, d in els)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f2(x)} {f2(y)} {f2(w)} {f2(h)}">'
           f"<title>{title}</title>{body}</svg>\n")
    open(f"{OUT}/{name}.svg", "w").write(svg)
    print(f"{name}.svg {len(svg)} bytes viewBox {f2(w)}x{f2(h)} colours {sorted(set(c for c, _ in els))}")
