"""Рисуем карточки DORX в фирменном стиле.

Язык карточки: двухстрочный заголовок заглавными, прочерченные выносные линии
с размерами, три скруглённых плашки, знак «.DORX» с квадратной точкой.

Фон выбирается ПО ЦВЕТУ ТОВАРА, а не по вкусу: тёмный товар ставим
на светлый фон, светлый на тёмный.
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
IMGDIR = os.path.join(HERE, "photos")
OUTDIR = os.path.join(HERE, "cards")
os.makedirs(OUTDIR, exist_ok=True)

SIZE = 1200
BLUE = (30, 94, 224)        # фирменный синий DORX
NAVY = (20, 28, 46)         # тёмный фон
PAPER = (238, 240, 244)     # светлый фон
AMBER = (232, 168, 56)      # выносные линии на тёмном

F_MARK = os.path.join(HERE, "fonts", "Michroma.ttf")
F_HEAD = os.path.join(HERE, "fonts", "Rubik-Bold.ttf")
F_CHIP = os.path.join(HERE, "fonts", "PlexMono.ttf")
F_DIM = os.path.join(HERE, "fonts", "Rubik-Medium.ttf")


def font(path, size):
    return ImageFont.truetype(path, size)


def cutout(path):
    """Убираем белый фон студийного снимка и обрезаем по товару."""
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > 236 and g > 236 and b > 236:
                px[x, y] = (r, g, b, 0)
    box = im.getbbox()
    return im.crop(box) if box else im


def mean_luma(im):
    small = im.convert("RGBA").resize((60, 60))
    px = small.load()
    tot, n = 0, 0
    for y in range(60):
        for x in range(60):
            r, g, b, a = px[x, y]
            if a > 40:
                tot += 0.299 * r + 0.587 * g + 0.114 * b
                n += 1
    return tot / n if n else 255


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def wrap(text, fnt, max_w, draw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def dim_line(draw, p1, p2, label, colour, fnt, vertical):
    """Выносная линия с засечками и подписью размера."""
    draw.line([p1, p2], fill=colour, width=3)
    tick = 14
    if vertical:
        for p in (p1, p2):
            draw.line([(p[0] - tick, p[1]), (p[0] + tick, p[1])], fill=colour, width=3)
        mid = ((p1[0], (p1[1] + p2[1]) // 2))
        tw = draw.textlength(label, font=fnt)
        th = fnt.size
        pad = 10
        draw.rectangle([mid[0] - tw / 2 - pad, mid[1] - th / 2 - pad,
                        mid[0] + tw / 2 + pad, mid[1] + th / 2 + pad], fill=None)
        draw.text((mid[0], mid[1]), label, font=fnt, fill=colour, anchor="mm")
    else:
        for p in (p1, p2):
            draw.line([(p[0], p[1] - tick), (p[0], p[1] + tick)], fill=colour, width=3)
        mid = (((p1[0] + p2[0]) // 2), p1[1])
        draw.text((mid[0], mid[1] - 26), label, font=fnt, fill=colour, anchor="mm")


def build(product, photo_path, headline, chips, dims):
    prod = cutout(photo_path)
    dark_product = mean_luma(prod) < 130

    ground = PAPER if dark_product else NAVY
    ink = NAVY if dark_product else (255, 255, 255)
    rule = NAVY if dark_product else AMBER
    chip_bg = (255, 255, 255) if dark_product else (255, 255, 255, 30)

    card = Image.new("RGB", (SIZE, SIZE), ground)
    draw = ImageDraw.Draw(card, "RGBA")

    # --- знак ---
    fm = font(F_MARK, 34)
    mark_x, mark_y = 64, 58
    draw.rectangle([mark_x, mark_y + 12, mark_x + 14, mark_y + 26], fill=BLUE)
    draw.text((mark_x + 26, mark_y), "DORX", font=fm, fill=ink)

    # --- заголовок в две строки ---
    fh = font(F_HEAD, 62)
    lines = wrap(headline.upper(), fh, SIZE - 128, draw)[:2]
    y = 150
    for ln in lines:
        draw.text((64, y), ln, font=fh, fill=ink)
        y += 70
    draw.line([(64, y + 14), (64 + 120, y + 14)], fill=BLUE, width=5)

    # --- товар ---
    top = y + 60
    bottom = SIZE - 190
    avail_h = bottom - top
    avail_w = SIZE - 300
    scale = min(avail_w / prod.width, avail_h / prod.height)
    pw, ph = int(prod.width * scale), int(prod.height * scale)
    prod_r = prod.resize((pw, ph), Image.LANCZOS)
    px0 = (SIZE - pw) // 2 - 30
    py0 = top + (avail_h - ph) // 2
    card.paste(prod_r, (px0, py0), prod_r)

    # --- выносные размеры ---
    fd = font(F_DIM, 26)
    if dims.get("height"):
        x = px0 + pw + 46
        dim_line(draw, (x, py0), (x, py0 + ph), dims["height"], rule, fd, True)
    if dims.get("width"):
        yy = py0 + ph + 40
        dim_line(draw, (px0, yy), (px0 + pw, yy), dims["width"], rule, fd, False)

    # --- три плашки ---
    fc = font(F_CHIP, 24)
    cx = 64
    cy = SIZE - 118
    for text in chips[:3]:
        tw = draw.textlength(text, font=fc)
        w = int(tw) + 52
        rounded(draw, [cx, cy, cx + w, cy + 58], 29, chip_bg)
        draw.text((cx + 26, cy + 29), text, font=fc,
                  fill=NAVY if dark_product else (255, 255, 255), anchor="lm")
        cx += w + 16

    out = os.path.join(OUTDIR, product + ".jpg")
    card.convert("RGB").save(out, "JPEG", quality=92)
    return out, dark_product


if __name__ == "__main__":
    with open(os.path.join(HERE, "card_plan.json"), encoding="utf-8") as f:
        plan = json.load(f)
    for item in plan:
        path, dark = build(item["id"], os.path.join(IMGDIR, item["photo"]),
                           item["headline"], item["chips"], item.get("dims", {}))
        print("%-28s фон: %s  ->  %s" % (item["id"], "светлый" if dark else "тёмный", path))
