#!/usr/bin/env python3
"""Pixel art for the aquarium mod: the one source of every image in the mod's art/ folder.

Needs Python 3 and Pillow (pip3 install pillow).

  python3 make_art.py
      Rewrites the mod's own art/ (the folder next to source/) with variant B. SVGs only.
  python3 make_art.py --out DIR
      Leaves the mod alone and writes everything into DIR:
        DIR/art/*.svg    the images the mod draws (one rect per pixel run, 2 logical px a cell)
        DIR/png/*.png    1 px a cell, used for the previews
        DIR/spec.json    sizes, colors and where the backdrop goes
        DIR/preview.png  the whole strip composed from spec.json (2x)
        DIR/sheet.png    every image on one sheet (4 px a cell, nearest neighbour)
  --variant A|B|S
      B ("midnight", natural turtle colors) is the set the mod uses and the default. A and S are
      earlier sketches kept for reference; the mod's code isn't laid out for them, so they need --out.

Before writing, the *.svg and *.png files in the target art/ (and, with --out, in png/) are deleted, so a
sprite that was renamed leaves nothing behind. Nothing else in those folders is touched.

Every image comes from the pixel grids below (strings plus a palette, or grids made from a fixed seed);
the SVGs, PNGs and previews all share them. The actors' grids (turtles, little ones, sharks, pearl,
bubbles) are the same in every variant; a variant only changes the backdrop, its colors and its layout.
"""
import argparse
import colorsys
import json
import math
import os
import random
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
MOD_ART = os.path.join(os.path.dirname(HERE), "art")  # the mod's own art/, next to source/

CELL = 2  # 每格的邏輯 px


def rgb(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, k):
    return "#" + "".join(f"{round(x + (y - x) * k):02x}" for x, y in zip(rgb(a), rgb(b)))


def mirror(rows):
    return [r[::-1] for r in rows]


def paint(c):
    """調色盤的值是 "#rrggbb"，或帶透明度的 ("#rrggbb", alpha)。"""
    return (c, 1.0) if isinstance(c, str) else c


# ───────────────────────── 主角：像素格子（面向右；左向用鏡射） ─────────────────────────
# 海龜 28×17 格 → 56×34 邏輯 px。腳在最底列、鼻尖貼右緣。
TURTLE = [
    ".......ooooooo..............",
    ".....ooHhhHSSSoo............",
    "...ooHhHHSdSSSSSoo..........",
    "..oHHHSSSSdSSSSdSSo..ooooo..",
    ".oHHSSSSSSdSSSSdSSSookkkkko.",
    ".oHSddddddddddddddSokkkkekko",
    ".oSSSSSdSSSSSdSSSSSokkkkekko",
    ".osssssssssssssssssokkkmkkko",
    "kkoooooooooooooooooggkkkmmmo",
    "..ogggbbbbbbbokkkkgggkkkkko.",
    ".ogkggBBBBBBokkkkgoGGoooooo.",
    "ogkkgoooooookkkggoGGGo......",
    "ogggo.....okkkggo.oGGo......",
    "oooo.....okkkggo...oo.......",
    "........okkgggo.............",
    "........oggggo..............",
    ".........oooo...............",
]

# 睡著：同尺寸、底部對齊。殼往下趴、鰭平放、頭靠在沙上、閉眼。
TURTLE_SLEEP = [
    "............................",
    "............................",
    "............................",
    "............................",
    "............................",
    ".......ooooooo..............",
    ".....ooHhhHSSSoo............",
    "...ooHhHHSdSSSSSoo..........",
    "..oHHHSSSSdSSSSdSSo.........",
    ".oHHSSSSSSdSSSSdSSSo.ooooo..",
    ".oHSddddddddddddddSookkkkko.",
    ".oSSSSSdSSSSSdSSSSSokkkkkkko",
    ".osssssssssssssssssokkkeekko",
    "kkoooooooooooooooooggkkkkkko",
    "ogggggo....okkkkkkgggkkkkko.",
    "ogkkkgo...okkkkkggooooooooo.",
    ".ooooo.....ooooooo..........",
]

# 小海龜 15×10 格 → 30×20 邏輯 px。另外畫的，不是大海龜縮小。
KID = [
    "...ooooo.......",
    ".ooHHSSSoo.....",
    "oHHSSdSSSSoooo.",
    "oHSSSdSSSSokeko",
    "osssssssssgkkko",
    "kooooooooogkko.",
    ".ogobbbokkooo..",
    "ogo.oookgo.....",
    "oo...okgo......",
    "......oo.......",
]

# 鯊魚 44×20 格 → 88×40 邏輯 px。灰藍、白肚、圓眼、微笑，沒有牙齒。
SHARK = [
    ".....................oo.....................",
    "ooo.................oDDo....................",
    "oDDo................oDDDDo..................",
    ".oDDo...............oDDDDDo.................",
    ".oDDDo.............oDDDDDDDDo...............",
    "..oDDDo...........ooDDDDDDDDDooooo..........",
    "..oDDDo....oooooooLLLLLLLLLLLLLLLLoooo......",
    "...oDDDo...oDoLLLLMMMMMMMMMMMMMMMMLLLLooo...",
    "...oDDDDoooLLLMMMMMMMMMMMMMMMiMiMiMMehLLLoo.",
    "....oDDDLLLMMMMMMMMMMMMMMMMMMiMiMiMMeeMMMLLo",
    "....oDDDMMMMMMMMMMMMMMMMMMMMMiMiMiMMMMMMMMMo",
    "....oDDDMMMMMMMMMMMMMMWWWWWWWWWWWWWWmWWWWWWo",
    "...oDDDDoooMMMWWWWWWWWWWWWWWWWWWWWWWWmmmmWo.",
    "...oDDDo...ooooWWWWWWWWWWWWWWWWWWWWWWWWooo..",
    "..oDDDo........oDDoowwwwwwwwwwwwwwwoooo.....",
    "..oDDo.........oDDo.oooooooDDDDoooo.........",
    ".oDDo..........ooo......oDDDDDDo............",
    ".ooo...................oDDDDDo..............",
    "......................oDDDDo................",
    "......................oooo..................",
]

PEARL = [
    ".oooo.",
    "oWWwwo",
    "oWhwwo",
    "owwwpo",
    "owwppo",
    ".oooo.",
]

BUBBLE = [
    ".ooo.",
    "oh..o",
    "o...o",
    "o...o",
    ".ooo.",
]

BUBBLE_SMALL = [
    ".o.",
    "o.o",
    ".o.",
]

# ───────────────────────── 主角調色盤 ─────────────────────────
# 殼色沿用舊 make_art.py 的六個 hex（側欄 space 顏色）。舊版另外混 18% 灰，這裡不混，像素圖要飽和一點才清楚。
SHELLS = {
    "ansi2": "#3fae6a",
    "ansi3": "#e3814f",
    "ansi4": "#5b8def",
    "ansi5": "#8b7cf6",
    "ansi6": "#22a99a",
    "plain": "#8d9399",
}
INK = "#10203a"
SHELL_EARTH = "#6f5c40"   # 自然海龜殼的褐色
SHELL_MUTE = 0.42         # 往褐色混多少：0 = 原本的 space 色，1 = 全部褐色


def turtle_pal(shell):
    # 接近真實海龜：皮膚是橄欖褐、鱗片邊緣偏米色，腹甲是暗奶油色；
    # 殼保留 space 的色相（才分得出是哪個 space），但往大地褐色調、降飽和，高光用暖米色而不是白。
    base = mix(SHELLS[shell], SHELL_EARTH, SHELL_MUTE)
    return {
        "o": "#1a2228",
        "h": mix(base, "#e9dcc0", 0.42), "H": mix(base, "#e9dcc0", 0.22), "S": base, "s": mix(base, "#1b1712", 0.30), "d": mix(base, "#1b1712", 0.48),
        "k": "#bdb07a", "g": "#8d7f4f", "G": "#615736",
        "b": "#d8c595", "B": "#ae9b6c",
        "e": "#14181b", "m": "#3c3a2b",
    }


SHARK_PAL = {
    "o": "#1b3348", "L": "#93b3cd", "M": "#6c90b1", "D": "#4f7397",
    "W": "#eaf0f2", "w": "#c2d1dc", "e": "#14202b", "h": "#ffffff", "m": "#3a5874", "i": "#456788",
}
PEARL_PAL = {"o": "#9a90b4", "W": "#ffffff", "h": "#ffffff", "w": "#f1ebf5", "p": "#cfc4de"}
BUBBLE_PAL = {"o": "#a6deec", "h": "#eafcff"}


# ───────────────────────── 互動用的新圖：飼料、路過的魚、遠處的鯊魚 ─────────────────────────
# 飼料 4×3 格 → 8×6 邏輯 px。暖色小碎片（不是紅色），沙和水上都看得見。
FOOD = [
    ".hb.",
    "hbbs",
    ".bs.",
]
FOOD_PAL = {"h": "#d9c48f", "b": "#b99b62", "s": "#8d7447"}

# 路過的小魚 6×4 格 → 12×8 邏輯 px，面向右。灰藍、暗銀、淡青，低飽和，比海龜暗。
FISH_PASS_1 = [  # 灰藍，圓身、尾巴分叉
    "t.bbb.",
    "ttbbbe",
    "ttbbbb",
    "t.lll.",
]
FISH_PASS_1_PAL = {"t": "#41596a", "d": "#3c5262", "b": "#4f687b", "l": "#6a8394", "e": "#13202a"}
FISH_PASS_2 = [  # 暗銀帶淡青，背鰭
    "t.dd..",
    "ttbbbb",
    "ttbbbe",
    "t.ll..",
]
FISH_PASS_2_PAL = {"t": "#4e6e70", "d": "#41605f", "b": "#5f7f7d", "l": "#7d9a96", "e": "#14252a"}

# 遠處的鯊魚：用提醒鯊魚（SHARK）的格子，每格只佔 1 邏輯 px（所以是 44×20 px，約一半大小），
# 整隻塗成同一個暗灰藍，沒有白肚、沒有眼睛；透明度由 main.js 的 element opacity 決定。
FAR_SHARK = [re.sub("[^.]", "x", r) for r in SHARK]
FAR_SHARK_PAL = {"x": "#3f566b"}

# 這些圖每格不是 2 px。
CELL_OF = {"far-shark-r": 1, "far-shark-l": 1}


def cell_of(name):
    return CELL_OF.get(name, CELL)


def extra_sprites():
    """互動用的圖：名稱 → (格子, 調色盤)。名稱不可用 turtle- / kid- 開頭，也別撞到既有的 fish-school-*。"""
    return {
        "food": (FOOD, FOOD_PAL),
        "fish-pass-1-r": (FISH_PASS_1, FISH_PASS_1_PAL), "fish-pass-1-l": (mirror(FISH_PASS_1), FISH_PASS_1_PAL),
        "fish-pass-2-r": (FISH_PASS_2, FISH_PASS_2_PAL), "fish-pass-2-l": (mirror(FISH_PASS_2), FISH_PASS_2_PAL),
        "far-shark-r": (FAR_SHARK, FAR_SHARK_PAL), "far-shark-l": (mirror(FAR_SHARK), FAR_SHARK_PAL),
    }


# ───────────────────────── 佈景：手畫的小圖 ─────────────────────────
CORAL_1 = [  # 分枝珊瑚
    ".......LL........",
    "..LL..LMMs...LL..",
    ".LMMs.LMMs..LMMs.",
    ".LMMs.LMMs..LMMs.",
    ".LMMs.LMMsLLMMs..",
    "..MMsLLMMsMMMs...",
    "L.LMMsMMMsMMs..LL",
    "MsLMMMMMMMMs..LMs",
    "MMsLMMMMMMsLLMMs.",
    ".MMsLMMMMsMMMMs..",
    "..MMMMMMMMMMs....",
    "....LMMMMs.......",
    "...sMMMMMss......",
]
CORAL_2 = [  # 指狀珊瑚
    "..LL....LL.",
    ".LMMs..LMMs",
    ".LMMsLLLMMs",
    ".LMMLMMsMMs",
    "LLMMLMMsMMs",
    "LMsMLMMsMs.",
    "LMsMMMMsMs.",
    ".ssMMMMss..",
]
CORAL_3 = [  # 小圓珊瑚
    "..LLLL..",
    ".LMLMMs.",
    "LMMLMMMs",
    "LMLMMLMs",
    ".sMMMss.",
]
STONE_1 = [
    "......oooooo......",
    "....ooLLLLMMoo....",
    "..ooLLLLMMMMMMo...",
    ".oLLLLMMMMMMMDDo..",
    ".oLLMMMMMMMDDDDDo.",
    "oLLMMMMMMDDDDDDDDo",
    "oLMMMMMDDDDDDDDDDo",
    "oMMMDDDDDDDDDDDDDo",
    ".oooooooooooooooo.",
]
STONE_2 = [
    "...ooooo...",
    ".ooLLLMMoo.",
    "oLLLMMMMDDo",
    "oLMMMMDDDDo",
    "oMMDDDDDDDo",
    ".ooooooooo.",
]
STONE_3 = [
    ".oooo.",
    "oLLMDo",
    "oMDDDo",
    ".oooo.",
]
FISH = [  # 遠處的小魚剪影，面向右
    "x.xx.",
    ".xxxx",
    "x.xx.",
]
FISH_SMALL = [
    "x.x.",
    ".xxx",
    "x.x.",
]
JELLY = [  # 小水母（靜止）
    "..xxx..",
    ".xXXXx.",
    "xXXxXXx",
    "xxxxxxx",
    "x.x.x.x",
    "x.x.x.x",
    ".x..x.x",
    ".x.x..x",
    "...x...",
]


def stamp(w, h, items):
    """把幾個小格子蓋在一張空白格子上。items: (x, y, rows)。"""
    g = [["."] * w for _ in range(h)]
    for x0, y0, rows in items:
        for y, r in enumerate(rows):
            for x, ch in enumerate(r):
                if ch != ".":
                    g[y0 + y][x0 + x] = ch
    return ["".join(r) for r in g]


FISH_SCHOOL_1 = stamp(40, 15, [(2, 1, mirror(FISH)), (13, 0, mirror(FISH_SMALL)), (22, 2, mirror(FISH)), (33, 1, mirror(FISH_SMALL)),
                               (7, 7, mirror(FISH)), (18, 8, mirror(FISH_SMALL)), (28, 7, mirror(FISH)), (13, 12, mirror(FISH_SMALL))])
FISH_SCHOOL_2 = stamp(24, 9, [(0, 1, FISH_SMALL), (9, 0, FISH), (18, 2, FISH_SMALL), (5, 6, FISH)])
PLANKTON = stamp(30, 14, [(1, 3, ["x"]), (7, 0, ["x"]), (12, 8, ["x"]), (18, 4, ["X"]), (24, 11, ["x"]), (28, 2, ["x"]), (5, 12, ["X"])])


# ───────────────────────── 佈景：固定種子產生的格子 ─────────────────────────
def seaweed(blades, seed):
    """blades: (底部 x, 高度, 每列往右偏多少, 擺幅, 相位)。底在最下列，往上長。"""
    rng = random.Random(seed)
    h = max(b[1] for b in blades)
    cells = {}
    for bx, height, lean, amp, phase in blades:
        for i in range(height):
            t = i / height
            x = round(bx + lean * i + amp * math.sin(phase + i * 0.5) * (0.25 + 0.75 * t))
            wide = 3 if t < 0.55 else 2 if t < 0.9 else 1
            for k in range(wide):
                cells[(x + k, h - 1 - i)] = "l" if k == 0 else "d" if k == 2 else "m"
            if 0.2 < t < 0.8 and rng.random() < 0.22:  # 葉緣的小缺口
                cells[(x + wide, h - 1 - i)] = "m"
    x0 = min(x for x, _ in cells)
    w = max(x for x, _ in cells) - x0 + 1
    g = [["."] * w for _ in range(h)]
    for (x, y), ch in cells.items():
        g[y][x - x0] = ch
    return ["".join(r) for r in g]


SEAWEED_1 = seaweed([(0, 21, 0.10, 1.6, 0.0), (5, 28, -0.04, 1.8, 1.4), (9, 17, 0.14, 1.3, 2.6)], 11)   # 高的海帶
SEAWEED_2 = seaweed([(0, 8, -0.30, 0.6, 0.0), (3, 12, -0.12, 0.9, 1.0), (6, 15, 0.02, 1.0, 2.2), (9, 11, 0.16, 0.8, 0.6), (12, 7, 0.34, 0.5, 1.8)], 12)  # 中的一叢
SEAWEED_3 = seaweed([(0, 5, -0.25, 0.3, 0.0), (2, 7, 0.0, 0.5, 1.2), (5, 5, 0.25, 0.3, 2.0)], 13)      # 矮的一撮

TILE = 240  # tile 寬（格），= 480 邏輯 px


def plateaus(rng, values):
    """把一條曲線切成 2–5 格寬的階梯，像素圖的岩石輪廓。"""
    out = []
    while len(out) < len(values):
        seg = values[len(out):len(out) + rng.choice((2, 3, 3, 4, 5))]
        out += [round(sum(seg) / len(seg))] * len(seg)
    return out


def ridge(rng, base, bumps):
    h = [float(base)] * TILE
    for cx, half, peak in bumps:
        for dx in range(-half, half + 1):
            x = (cx + dx) % TILE  # 繞回去，左右才接得起來
            h[x] = max(h[x], base + peak * (1 - (dx / half) ** 2))
    return plateaus(rng, h)


def rocks_far(height, back, mid, front, seed):
    """遠景岩石剪影 tile：三道山脊，越前面越矮越暗，各有一格亮邊。可水平無縫拼接。"""
    rng = random.Random(seed)
    ridges = [(ridge(rng, 1, front), "f", "g"), (ridge(rng, 2, mid), "m", "n"), (ridge(rng, 3, back), "b", "c")]
    rows = []
    for y in range(height):
        k = height - y  # 離底幾格
        row = ""
        for x in range(TILE):
            for h, fill, edge in ridges:
                if k <= h[x]:
                    row += edge if k == h[x] else fill
                    break
            else:
                row += "."
        rows.append(row)
    return rows


def sand_tile(height, seed, width=TILE):
    """沙底 tile：上緣起伏（一格暗邊、一格過渡色）、橫向的亮暗紋、底部變暗。可水平無縫拼接。"""
    rng = random.Random(seed)
    wave = [2.2 + 1.3 * math.sin(2 * math.pi * x / width * 2 + 0.6) + 0.9 * math.sin(2 * math.pi * x / width * 5 + 2.1) for x in range(width)]
    top = [max(0, min(4, v)) for v in plateaus(rng, wave)]
    g = [["."] * width for _ in range(height)]
    for x in range(width):
        for y in range(top[x], height):
            d = y - top[x]
            g[y][x] = "e" if d == 0 else "E" if d == 1 else "n"
    for _ in range(150 * width // TILE):  # 橫紋
        y, x0, n, ch = rng.randrange(3, height), rng.randrange(width), rng.randint(2, 8), rng.choice("llld")
        for i in range(n):
            if g[y][(x0 + i) % width] == "n":
                g[y][(x0 + i) % width] = ch
    for _ in range(8 * width // TILE):  # 小石子
        y, x0 = rng.randrange(6, height - 2), rng.randrange(width)
        for i in range(rng.randint(1, 2)):
            if g[y][(x0 + i) % width] != ".":
                g[y][(x0 + i) % width] = "p"
    for y in range(height - 2, height):  # 底部兩列變暗
        for x in range(width):
            if g[y][x] in "nld":
                g[y][x] = "K" if y == height - 1 or g[y][x] == "d" else "k"
    return ["".join(r) for r in g]


def beam(width, rows, a=2, b=3):
    """斜射光束：左緣每 a 列往左 1 格、右緣每 b 列往左 1 格，所以往下變寬。由上到下分三段，越下面越淡。"""
    shift = rows // a
    out = []
    for y in range(rows):
        left, right = shift - y // a, shift + width - 1 - y // b
        ch = "1" if y * 3 < rows else "2" if y * 3 < rows * 2 else "3"
        out.append("".join(ch if left <= x <= right else "." for x in range(shift + width)))
    return out


# ───────────────────────── 直立側欄版（S）用的格子：峭壁、海床、水面 ─────────────────────────
TABLE_CORAL = [  # 平台狀的桌珊瑚：一片圓盤加短柄
    "..LLLLLLLLLLLLLLLL..",
    ".LLMMLMMMMLMMMLMMML.",
    "LMMMMMMMMMMMMMMMMMMs",
    ".ssMMsMMMsMMsMMMsss.",
    "......ssMMMMss......",
    "........sMMs........",
    "........sMMs........",
]


class Board:
    """合成用的格子：每格直接放顏色，把手畫的小圖和產生的岩石蓋在同一張上。out() 交回跟手畫圖一樣的 (格子, 調色盤)。"""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.g = [[None] * w for _ in range(h)]

    def get(self, x, y):
        return self.g[y][x] if 0 <= x < self.w and 0 <= y < self.h else None

    def set(self, x, y, color):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = color

    def stamp(self, rows, pal, x0, bottom):
        """把一張小圖蓋上去，bottom 是它最底列落在第幾列。"""
        top = bottom - len(rows) + 1
        for y, r in enumerate(rows):
            for x, ch in enumerate(r):
                if ch != ".":
                    self.set(x0 + x, top + y, pal[ch])

    def out(self):
        return [[c or "." for c in r] for r in self.g], {c: c for r in self.g for c in r if c}


def rock_face(b, edge, pal, rng):
    """edge[y] 是每一列岩壁最左邊的格，往右塗到底：朝上的面最亮、左緣次亮、裡面暗、懸空的底面最暗，再加裂縫和幾塊亮面。"""
    h = len(edge)
    for y in range(h):
        above = edge[y - 1] if y else edge[0]
        below = edge[y + 1] if y + 1 < h else edge[y]
        for x in range(edge[y], b.w):
            d = x - edge[y]
            b.set(x, y, pal["cap"] if x < above else pal["under"] if x < below else pal["rim"] if d == 0 else pal["mid"] if d <= 2 else pal["body"])
    for y in range(1, h):  # 岩壁左緣每次轉折，往裡面帶一小段亮線，看起來像一塊一塊的石面
        if edge[y] != edge[y - 1]:
            for x in range(max(edge[y], edge[y - 1]), max(edge[y], edge[y - 1]) + rng.randint(4, 11)):
                if b.get(x, y) == pal["body"]:
                    b.set(x, y, pal["mid"])
    for _ in range(h // 3):
        x, y, n = rng.randrange(b.w), rng.randrange(h), rng.randint(3, 9)
        for i in range(n):
            if b.get(x, (y + i) % h) == pal["body"]:
                b.set(x, (y + i) % h, pal["crack"])
    for _ in range(h // 7):
        x, y, w, n = rng.randrange(b.w), rng.randrange(h), rng.randint(2, 4), rng.randint(2, 5)
        for i in range(n):
            for k in range(w):
                if b.get(x + k, (y + i) % h) == pal["body"]:
                    b.set(x + k, (y + i) % h, pal["mid"])


CLIFF_W, CLIFF_H, CLIFF_EDGE = 48, 120, 21  # 峭壁 tile：96×240 邏輯 px；上下兩端的岩壁左緣都在第 21 格


def cliff_tile(seed, ledges, decor, pal):
    """峭壁 tile。上下兩端的左緣固定在 CLIFF_EDGE，所以兩種 tile 不管怎麼排，上下都接得起來。
    ledges: (平台在第幾列, 伸到第幾格, 厚幾列)。decor: (格子, 調色盤, x, 底在第幾列)。"""
    rng = random.Random(seed)
    edge, x = [], CLIFF_EDGE
    while len(edge) < CLIFF_H:
        edge += [x] * rng.randint(4, 9)
        x = max(16, min(27, x + rng.choice((-3, -2, -1, 1, 2, 3))))
    edge = edge[:CLIFF_H]
    for i in range(5):
        edge[i] = edge[-1 - i] = CLIFF_EDGE
    for row, reach, thick in ledges:
        for i in range(thick):
            edge[row + i] = reach
        for i in range(1, 10):  # 平台底下慢慢收回去
            y = row + thick - 1 + i
            if y < CLIFF_H - 5:
                edge[y] = min(edge[y], reach + i * 2)
    b = Board(CLIFF_W, CLIFF_H)
    rock_face(b, edge, pal, rng)
    for rows, dpal, x, bottom in decor:
        b.stamp(rows, dpal, x, bottom)
    return b.out()


SEABED_W, SEABED_H, FLOOR_ROWS = 130, 64, 14  # 海床：260×128 邏輯 px，靠右下對齊；最底下 14 列是沙


def seabed(s):
    """底部海床：遠處的岩柱剪影、峭壁的底座（最上面一列接得上峭壁 tile）、沙、石頭、珊瑚、海草。"""
    rng = random.Random(21)
    b = Board(SEABED_W, SEABED_H)
    floor = SEABED_H - FLOOR_ROWS
    for cx, height, half, color in ((36, 34, 9, 0), (74, 44, 9, 0), (58, 22, 8, 0), (47, 13, 10, 1), (12, 26, 8, 0)):
        for k in range(height):
            w = round(half * (1 - (k // 3 * 3 / height) ** 2.4))
            for x in range(cx - w, cx + w + 1):
                b.set(x, floor + 2 - k, s["spire"][color])
    x0 = SEABED_W - CLIFF_W + CLIFF_EDGE
    edge = plateaus(rng, [x0 - 24 * (y / SEABED_H) ** 1.4 for y in range(SEABED_H)])
    edge[:4] = [x0] * 4
    rock_face(b, edge, s["rock"], rng)
    b.stamp(sand_tile(FLOOR_ROWS, 9, SEABED_W), s["floor"], 0, SEABED_H - 1)
    for rows, pal, x, bottom in (
        (SEAWEED_3, s["weed"], 8, 52), (STONE_2, s["stone"], 2, 56), (CORAL_3, s["coral3"], 14, 54),   # 畫布比 216 寬才看得到的左邊
        (SEAWEED_1, s["weed"], 24, 53), (STONE_1, s["stone"], 27, 56), (STONE_3, s["stone"], 46, 57),
        (CORAL_1, s["coral1"], 71, 54), (STONE_2, s["stone"], 82, 57), (SEAWEED_2, s["weed"], 90, 50), (CORAL_2, s["coral2"], 104, 44),
    ):
        b.stamp(rows, pal, x, bottom)
    return b.out()


def surface(s, rows=14):
    """頂端的水面：一條亮線，底下是越來越疏的波光。靠右上對齊。"""
    rng = random.Random(31)
    b = Board(SEABED_W, rows)
    for x in range(SEABED_W):
        b.set(x, 0, s["ripple"]["2"])
    for y in range(rows):
        for _ in range(round(SEABED_W / 8 * (1 - y / rows) ** 1.5)):
            x0, n = rng.randrange(SEABED_W), rng.randint(3, max(3, 10 - y // 2))
            for i in range(n):
                b.set((x0 + i) % SEABED_W, y, s["ripple"]["1" if y < 3 else "2" if y < 7 else "3"])
    return b.out()


# ───────────────────────── 版本：配色與擺法 ─────────────────────────
SIZES = {"TW": 56, "TH": 34, "KW": 30, "KH": 20, "SW": 88, "SH": 40, "PEARL": 12, "BUBBLE": 10, "BUBBLE_SMALL": 6}
TW, TH, KW, KH, SW, SH = (SIZES[k] for k in ("TW", "TH", "KW", "KH", "SW", "SH"))
EDGE, PAD_X, PAD_BOTTOM = 8, 8, 8
SAND_H = 22        # 沙面（平均）離畫布底多高
SAND_TILE_H = 14   # 沙 tile 高（格）

SCENES = {
    "A": {
        "name": "深海光束",
        "block": 144,
        # 水：由上往下，上面亮。top 是佔畫布高的比例。
        "water": [(0.00, "#0c5475"), (0.11, "#0b4e6e"), (0.23, "#0a4766"), (0.37, "#08405e"), (0.52, "#073a56"), (0.68, "#06344e"), (0.84, "#052e46")],
        "rocks": {"b": "#083b57", "c": "#0a4563", "m": "#06324c", "n": "#083c58", "f": "#052a41", "g": "#07344e"},
        "rocksHeight": 34,
        "sand": {"e": "#2a626b", "E": "#6f8263", "n": "#aa9059", "l": "#c0a568", "d": "#8c7a4e", "p": "#587a72", "k": "#89784f", "K": "#6b6649"},
        "weed": {"l": "#72bd4a", "m": "#42983f", "d": "#1f7042"},
        "coral1": {"L": "#fbcdbb", "M": "#f2a593", "s": "#c97c93"},
        "coral2": {"L": "#cdb8f2", "M": "#a68ae0", "s": "#7663b6"},
        "coral3": {"L": "#f8d6a6", "M": "#efb47e", "s": "#bd8862"},
        "stone": {"o": "#0c2536", "L": "#42738c", "M": "#295771", "D": "#193e56"},
        "fish": {"x": "#06344d"},
        "beam": {"1": ("#c4f0fb", 0.11), "2": ("#c4f0fb", 0.075), "3": ("#c4f0fb", 0.04)},
        "label": {"onWater": "#8fb6c8", "onSand": "#3a3220"},
        "border": "#2e353c",
        # 圖層由後到前。place 的 items：(檔名, fx, dy)；fx 是「畫布寬 − 圖寬」的比例，dy 見各 anchor。
        "layers": [
            {"id": "rocks-far", "mode": "tile", "file": "rocks-far", "anchor": "sandTop", "dy": 4},
            {"id": "beams", "mode": "place", "anchor": "top",
             "items": [("beam-wide", 0.13, 0), ("beam-narrow", 0.29, 0), ("beam-wide", 0.53, 0), ("beam-narrow", 0.615, 0), ("beam-wide", 0.87, 0)]},
            {"id": "fish", "mode": "place", "anchor": "water", "items": [("fish-school-1", 0.405, 0.30), ("fish-school-2", 0.71, 0.16)]},
            {"id": "plants-back", "mode": "place", "anchor": "sandTop", "sway": True,
             "items": [("seaweed-1", 0.016, 5), ("seaweed-2", 0.285, 4), ("seaweed-2", 0.655, 4), ("seaweed-1", 0.972, 5)]},
            {"id": "sand", "mode": "tile", "file": "sand", "anchor": "bottom"},
            {"id": "decor-front", "mode": "place", "anchor": "sandTop",
             "items": [("stone-1", 0.022, 9), ("coral-1", 0.050, 5), ("stone-2", 0.074, 11), ("stone-3", 0.112, 8),
                       ("seaweed-3", 0.205, 5), ("stone-2", 0.345, 8), ("coral-3", 0.372, 6), ("seaweed-3", 0.455, 6),
                       ("stone-3", 0.530, 10), ("coral-2", 0.590, 5), ("seaweed-3", 0.745, 5), ("stone-3", 0.800, 9),
                       ("stone-2", 0.892, 7), ("coral-1", 0.917, 5), ("stone-1", 0.945, 10), ("seaweed-2", 0.930, 3)]},
        ],
    },
    "B": {
        "name": "午夜靜海",
        "block": 128,
        # 最上面接近 graphite 背景（#1d2125），往下慢慢變深、偏藍。
        "water": [(0.00, "#1c2329"), (0.18, "#1a242b"), (0.38, "#18242d"), (0.58, "#16232e"), (0.78, "#14212d")],
        "rocks": {"b": "#151e26", "c": "#19242d", "m": "#121a21", "n": "#161f27", "f": "#0f161c", "g": "#131b22"},
        "rocksHeight": 34,
        "sand": {"e": "#222a2f", "E": "#363a3b", "n": "#4c4a45", "l": "#57544d", "d": "#403e3a", "p": "#2e363b", "k": "#3c3a37", "K": "#31302e"},
        "weed": {"l": "#4d8858", "m": "#366b4a", "d": "#25513e"},
        "coral1": {"L": "#c9a5a1", "M": "#a48282", "s": "#79606d"},
        "coral2": {"L": "#9189ba", "M": "#70689a", "s": "#524d76"},
        "coral3": {"L": "#b7a086", "M": "#93816d", "s": "#6c6055"},
        "stone": {"o": "#0d1216", "L": "#3b4852", "M": "#2a353e", "D": "#1e272e"},
        "fish": {"x": "#25323d"},
        "beam": {"1": ("#a9cfe0", 0.05), "2": ("#a9cfe0", 0.034), "3": ("#a9cfe0", 0.018)},
        "jelly": {"x": ("#a9c4e8", 0.26), "X": ("#d3e3f6", 0.36)},
        "plankton": {"x": ("#8fe0d6", 0.32), "X": ("#c9f5ee", 0.46)},
        "label": {"onWater": "#74818c", "onSand": "#a9a69d"},
        "border": "#2e353c",
        "layers": [
            {"id": "rocks-far", "mode": "tile", "file": "rocks-far", "anchor": "sandTop", "dy": 4},
            {"id": "beams", "mode": "place", "anchor": "top", "items": [("beam-wide", 0.21, 0), ("beam-narrow", 0.67, 0)]},
            {"id": "fish", "mode": "place", "anchor": "water", "items": [("fish-school-2", 0.56, 0.20)]},
            {"id": "glow", "mode": "place", "anchor": "water",
             "items": [("jellyfish", 0.385, 0.16), ("plankton", 0.735, 0.40)]},
            {"id": "plants-back", "mode": "place", "anchor": "sandTop", "sway": True, "items": [("seaweed-1", 0.022, 5), ("seaweed-2", 0.715, 4)]},
            {"id": "sand", "mode": "tile", "file": "sand", "anchor": "bottom"},
            {"id": "decor-front", "mode": "place", "anchor": "sandTop",
             "items": [("stone-1", 0.040, 9), ("coral-1", 0.070, 5), ("seaweed-3", 0.295, 5), ("stone-3", 0.470, 9),
                       ("stone-2", 0.655, 8), ("coral-3", 0.682, 6), ("seaweed-3", 0.850, 5), ("stone-2", 0.950, 9)]},
        ],
    },
    "S": {
        "name": "右側直立海溝",
        "width": 230,          # 建議的欄寬（區塊）
        "previewHeight": 1000,
        # 水：越深越暗。top 是佔畫布高的比例。
        "water": [(0.00, "#125c7b"), (0.04, "#105575"), (0.09, "#0e4e6d"), (0.15, "#0c4765"), (0.23, "#0a405c"), (0.33, "#083953"),
                  (0.44, "#07324a"), (0.56, "#062c42"), (0.68, "#05263a"), (0.80, "#042133"), (0.91, "#041d2d")],
        "rock": {"cap": "#2a5169", "rim": "#1e4159", "mid": "#17354b", "body": "#112b3f", "crack": "#0c2233", "under": "#091b2a"},
        "table": {"L": "#d3a667", "M": "#b38650", "s": "#7c5d40"},
        "weed": {"l": "#5cab4b", "m": "#398841", "d": "#1d6340"},
        "coral1": {"L": "#f2c2b2", "M": "#e29b8d", "s": "#b5718a"},
        "coral2": {"L": "#bca7e8", "M": "#967bd2", "s": "#6957a6"},
        "coral3": {"L": "#ecc798", "M": "#d8a576", "s": "#a5795b"},
        "stone": {"o": "#081a28", "L": "#2f5b74", "M": "#1f465e", "D": "#143449"},
        "floor": {"e": "#0d3044", "E": "#1a455a", "n": "#28596f", "l": "#366c82", "d": "#1e4a5f", "p": "#15374a", "k": "#1c4559", "K": "#14384b"},
        "spire": ["#04202f", "#031b29"],
        "fish": {"x": "#07354f"},       # 上半段：比水暗
        "fishDeep": {"x": "#0c405c"},   # 下半段：比水亮一點
        "ripple": {"1": "#6fc0d3", "2": "#3f98b2", "3": "#22789a"},
        "ray": {"1": ("#c4f0fb", 0.10), "2": ("#c4f0fb", 0.06), "3": ("#c4f0fb", 0.03)},
        "label": {"onWater": "#86aabb", "onSand": "#b5cdd8"},
        "border": "#2e353c",
        "rays": [("ray-narrow", 0.00), ("ray-wide", 0.42), ("ray-wide", 1.00)],  # (檔名, fx)
        "fishAt": [("fish-school-2", 0.10, 0.125), ("fish-school-1", 0.20, 0.285), ("fish-deep-2", 0.34, 0.455),
                   ("fish-deep-1", 0.06, 0.63), ("fish-deep-2", 0.30, 0.815)],  # (檔名, fx, fy)
    },
}


def scene_sprites(v):
    """這個版本的佈景圖：名稱 → (格子, 調色盤)。"""
    s = SCENES[v]
    beam_rows = (160 - PAD_BOTTOM - 2 - SAND_H) // CELL  # 條高 160 時從水面到沙面；條比較矮時，多出來的被沙蓋住
    out = {
        "rocks-far": (rocks_far(s["rocksHeight"], [(24, 30, 27), (96, 20, 13), (152, 36, 21), (214, 18, 11)],
                                [(66, 34, 15), (124, 22, 9), (186, 30, 13), (234, 16, 8)], [(40, 26, 7), (108, 30, 9), (170, 18, 5), (206, 28, 8)], 5), s["rocks"]),
        "sand": (sand_tile(SAND_TILE_H, 7), s["sand"]),
        "beam-wide": (beam(16, beam_rows), s["beam"]),
        "beam-narrow": (beam(6, beam_rows), s["beam"]),
        "seaweed-1": (SEAWEED_1, s["weed"]), "seaweed-2": (SEAWEED_2, s["weed"]), "seaweed-3": (SEAWEED_3, s["weed"]),
        "coral-1": (CORAL_1, s["coral1"]), "coral-2": (CORAL_2, s["coral2"]), "coral-3": (CORAL_3, s["coral3"]),
        "stone-1": (STONE_1, s["stone"]), "stone-2": (STONE_2, s["stone"]), "stone-3": (STONE_3, s["stone"]),
        "fish-school-1": (FISH_SCHOOL_1, s["fish"]), "fish-school-2": (FISH_SCHOOL_2, s["fish"]),
    }
    if "jelly" in s:
        out["jellyfish"] = (JELLY, s["jelly"])
        out["plankton"] = (PLANKTON, s["plankton"])
    return out


# ───────────────────────── 位置：sea.js depths() 與 demo.js 的移植（新常數） ─────────────────────────
SHARK_GAP_3MIN = 125  # sea.js SHARK_STEPS 等 3 分鐘那一階
KID_GAP = 2           # 小海龜跟在母海龜後面，中間留 2 px（舊版是重疊 4 px）


def depths(width, height):
    sand_top = height - SAND_H
    swim_top = 22
    return {"width": width, "height": height, "sandTop": sand_top, "surface": 16, "swimTop": swim_top,
            "swimBottom": max(swim_top + 4, sand_top - TH - 16), "rest": sand_top - TH + 4}


DEPTH_FORMULA = {
    "sandTop": f"height - {SAND_H}", "surface": "16", "swimTop": "22",
    "swimBottom": "max(swimTop + 4, sandTop - TH - 16)", "rest": "sandTop - TH + 4",
}
# 「完成」的海龜：珍珠在鼻子前面，上面兩顆氣泡。面向右時的位移（相對海龜左上角）；面向左時 dx 改成 TW - dx - 圖寬。
DONE_PROPS = [("pearl", TW + 2, 8), ("bubble-small", TW + 10, -1), ("bubble", TW + 2, -12)]
BUBBLE_OPACITY = 0.8


def demo_scene(d):
    span = max(0, d["width"] - TW - 2 * EDGE)
    x = lambda f: EDGE + f * span
    mid = round((d["swimTop"] + d["swimBottom"]) / 2)
    shark_x = d["width"] - SW - EDGE
    blocked_x = shark_x - SHARK_GAP_3MIN - TW
    turtles = [
        {"space": "api", "shell": "ansi6", "status": "working", "x": x(0.04), "y": d["swimTop"] + 4, "facing": "r"},
        {"space": "docs", "shell": "ansi5", "status": "idle", "x": x(0.17), "y": d["rest"], "facing": "r"},
        {"space": "data", "shell": "ansi2", "status": "done", "x": x(0.31), "y": d["surface"], "facing": "r"},
        {"space": "~", "shell": "plain", "status": "working", "x": x(0.45), "y": d["swimBottom"] - 2, "facing": "r"},
        {"space": "web", "shell": "ansi4", "status": "working", "x": x(0.60), "y": d["swimTop"] + 12, "facing": "l", "kid": True},
        {"space": "infra", "shell": "ansi3", "status": "blocked", "x": blocked_x, "y": mid, "facing": "r"},
    ]
    kids = [{"shell": t["shell"], "x": t["x"] + TW + KID_GAP if t["facing"] == "l" else t["x"] - KW - KID_GAP,
             "y": t["y"] + TH - KH + 1, "facing": t["facing"]} for t in turtles if t.get("kid")]
    b = turtles[-1]
    sharks = [{"x": shark_x, "y": b["y"] + TH / 2 - SH / 2, "facing": "l"}]
    return turtles, kids, sharks


# ───────────────────────── 直立側欄版（S）：圖、深度、示範場景 ─────────────────────────
S_PAD = 6     # 欄位四周的 padding；畫布 = 區塊 − 2×6 − 邊框 2
S_FLOOR = 24  # 海床的沙面（平均）離畫布底多高
S_RAY_ROWS = 150
# 鯊魚在海龜正下方（或正上方）隔多遠等，依等了多久；單位是海龜和鯊魚兩張圖之間的垂直距離（px）。
S_SHARK_STEPS = [(0, 220), (60000, 170), (180000, 125), (360000, 88), (600000, 56)]


def side_sprites():
    s = SCENES["S"]
    weed, c1, c2, c3 = s["weed"], s["coral1"], s["coral2"], s["coral3"]
    return {
        "cliff-1": cliff_tile(41, [(30, 12, 4), (88, 10, 5)], [
            (TABLE_CORAL, s["table"], 6, 30), (SEAWEED_3, weed, 27, 30), (CORAL_2, c2, 37, 30),
            (CORAL_1, c1, 10, 88), (SEAWEED_1, weed, 31, 88)], s["rock"]),
        "cliff-2": cliff_tile(42, [(46, 8, 4), (102, 14, 4)], [
            (SEAWEED_1, weed, 8, 46), (CORAL_3, c3, 23, 46), (CORAL_1, c2, 31, 46),
            (TABLE_CORAL, s["table"], 8, 102), (SEAWEED_3, weed, 29, 102), (CORAL_3, c1, 40, 102)], s["rock"]),
        "seabed": seabed(s),
        "surface": surface(s),
        "ray-wide": (beam(12, S_RAY_ROWS, 3, 5), s["ray"]),
        "ray-narrow": (beam(5, S_RAY_ROWS, 3, 5), s["ray"]),
        "fish-school-1": (FISH_SCHOOL_1, s["fish"]), "fish-school-2": (FISH_SCHOOL_2, s["fish"]),
        "fish-deep-1": (FISH_SCHOOL_1, s["fishDeep"]), "fish-deep-2": (FISH_SCHOOL_2, s["fishDeep"]),
    }


def side_depths(width, height):
    floor_top = height - S_FLOOR
    return {"width": width, "height": height, "sandTop": floor_top,
            "doneTop": round(0.04 * height), "doneBottom": round(0.13 * height),
            "swimTop": round(0.18 * height), "swimBottom": round(0.72 * height),
            "rest": floor_top - TH + 4, "swimRight": width - TW - 30, "restRight": width - TW - 64}


S_DEPTH_FORMULA = {
    "floorTop": f"height - {S_FLOOR}",
    "done": "y 在 0.04×height 到 0.13×height 之間（靠水面的上段）；多隻時在這一段裡錯開",
    "working": "y 在 0.18×height 到 0.72×height 之間（中段）；x 在 EDGE 到 width − TW − 30 之間左右游",
    "idle": "y = floorTop − TH + 4（趴在海床的沙上，用 -sleep 圖）；x 在 EDGE 到 width − TW − 64 之間",
    "blocked": "停在原地（y 夾在 working 那一段裡），臉朝鯊魚",
    "shark": "x 跟海龜差不多（海龜 x − 44，夾在 EDGE 到 width − SW − EDGE），y = 海龜 y + TH + gap（從深處上來）；"
             "底下放不下（y + SH > floorTop）就改從上面來：y = 海龜 y − gap − SH。進場點在畫布外：下方 height + 12 或上方 −SH − 12",
}


def side_scene(d):
    span = d["swimBottom"] - d["swimTop"]
    at = lambda f: d["swimTop"] + round(f * span)
    turtles = [
        {"space": "data", "shell": "ansi2", "status": "done", "x": 30, "y": d["doneTop"] + 14, "facing": "r"},
        {"space": "api", "shell": "ansi6", "status": "working", "x": 16, "y": at(0.07), "facing": "r"},
        {"space": "web", "shell": "ansi4", "status": "working", "x": 70, "y": at(0.31), "facing": "l", "kid": True},
        {"space": "~", "shell": "plain", "status": "working", "x": 24, "y": at(0.56), "facing": "r"},
        {"space": "infra", "shell": "ansi3", "status": "blocked", "x": 78, "y": at(0.80), "facing": "l"},
        {"space": "docs", "shell": "ansi5", "status": "idle", "x": 46, "y": d["rest"], "facing": "r"},
    ]
    kids = [{"shell": t["shell"], "x": t["x"] + TW + KID_GAP if t["facing"] == "l" else t["x"] - KW - KID_GAP,
             "y": t["y"] + TH - KH + 1, "facing": t["facing"]} for t in turtles if t.get("kid")]
    b = turtles[4]
    sharks = [{"x": max(EDGE, b["x"] - 44), "y": b["y"] + TH + S_SHARK_STEPS[2][1], "facing": "r"}]
    return turtles, kids, sharks


def build_spec_side(sprites):
    s = SCENES["S"]
    size = lambda name: [len(sprites[name][0][0]) * CELL, len(sprites[name][0]) * CELL]
    cw, ch = s["width"] - 2 * S_PAD - 2, s["previewHeight"] - 2 * S_PAD - 2
    cliff, bed, top = size("cliff-1"), size("seabed"), size("surface")
    return {
        "variant": "S", "name": s["name"], "cell": CELL,
        "column": {
            "blockWidth": s["width"], "canvasWidth": cw, "supportedBlockWidth": [200, 260],
            "blockHeight": "整個視窗高（約 850–1150），可伸縮", "padding": S_PAD,
            "note": "畫布 = 區塊 − 四周 padding(6) − 邊框(1)：寬 − 14、高 − 14。所有背景都靠右對齊，欄位變窄只會裁掉左邊的開闊水域",
        },
        "sizes": {"TW": TW, "TH": TH, "KW": KW, "KH": KH, "SW": SW, "SH": SH,
                  "pearl": size("pearl"), "bubble": size("bubble"), "bubbleSmall": size("bubble-small"),
                  "note": "主角和道具跟版本 A 是同一份像素格子、同尺寸，沒有縮放"},
        "water": {"bands": [{"top": t, "color": c} for t, c in s["water"]]},
        "segments": {
            "top": f"固定高：surface.svg（高 {top[1]}）貼在最上面；光束 ray-*.svg（高 {size('ray-wide')[1]}）從 top = 0 往下",
            "middle": f"可伸縮：cliff-1.svg、cliff-2.svg（各 {cliff[0]}×{cliff[1]}）交替，由海床頂往上排到超出畫布頂",
            "bottom": f"固定高：seabed.svg（{bed[0]}×{bed[1]}）貼在最下面，最上面一列接得上峭壁 tile",
        },
        "layers": [
            {"id": "water", "order": 0, "mode": "bands", "note": "程式畫色塊：每一段從 top×畫布高 畫到下一段的 top"},
            {"id": "surface", "order": 1, "mode": "fixed", "file": "surface.svg", "size": top, "opacity": 1,
             "rule": f"left = 畫布寬 − {top[0]}、top = 0"},
            {"id": "rays", "order": 2, "mode": "place", "anchor": "top", "opacity": 1,
             "items": [{"file": f + ".svg", "size": size(f), "fx": fx, "dy": 0} for f, fx in s["rays"]]},
            {"id": "fish", "order": 3, "mode": "place", "anchor": "height", "opacity": 1,
             "items": [{"file": f + ".svg", "size": size(f), "fx": fx, "fy": fy} for f, fx, fy in s["fishAt"]]},
            {"id": "cliff", "order": 4, "mode": "tile-y", "files": ["cliff-1.svg", "cliff-2.svg"], "size": cliff, "tileHeight": cliff[1], "opacity": 1,
             "rule": f"left = 畫布寬 − {cliff[0]}。由下往上排：第 i 張（i = 0, 1, 2 …）的 top = (畫布高 − {bed[1]}) − (i + 1) × {cliff[1]}，"
                     f"檔案是 files[i % 2]；排到 top + {cliff[1]} ≤ 0 為止，最上面那張超出畫布的部分被裁掉"},
            {"id": "seabed", "order": 5, "mode": "fixed", "file": "seabed.svg", "size": bed, "opacity": 1,
             "rule": f"left = 畫布寬 − {bed[0]}（負值就是左邊被裁掉）、top = 畫布高 − {bed[1]}"},
        ],
        "anchors": {
            "top": "top = dy",
            "height": "top = round(fy × 畫布高)",
            "fx": "left = round(fx × (畫布寬 − 圖寬))",
        },
        "depths": {
            "bands": {"done": [0.04, 0.13], "working": [0.18, 0.72], "blocked": [0.18, 0.72], "idle": "floorTop − TH + 4（海床）"},
            "bandsNote": "數字是海龜 top 佔畫布高的比例",
            "formula": S_DEPTH_FORMULA,
            "atPreviewHeight": {("floorTop" if k == "sandTop" else k): n for k, n in side_depths(cw, ch).items()},
        },
        "shark": {"gapSteps": [{"afterMs": ms, "gap": px} for ms, px in S_SHARK_STEPS],
                  "note": "gap 是海龜和鯊魚兩張圖之間的垂直距離；取代橫條版 sea.js 的 SHARK_STEPS（那是水平距離）"},
        "ledges": {"note": "峭壁 tile 裡平台頂面的位置（相對 tile 左上角，邏輯 px）；海床睡不下時可以讓 idle 的海龜趴在平台上（選用）",
                   "cliff-1.svg": [{"y": 30 * CELL, "x0": 12 * CELL}, {"y": 88 * CELL, "x0": 10 * CELL}],
                   "cliff-2.svg": [{"y": 46 * CELL, "x0": 8 * CELL}, {"y": 102 * CELL, "x0": 14 * CELL}]},
        "actors": {
            "order": ["bubbles", "sharks", "kids", "turtles", "labels"],
            "doneProps": [{"file": f + ".svg", "size": size(f), "dx": dx, "dy": dy} for f, dx, dy in DONE_PROPS],
            "donePropsNote": "面向右時相對海龜左上角；面向左時 dx 改成 TW − dx − 圖寬",
            "bubbleOpacity": BUBBLE_OPACITY,
            "kidGap": KID_GAP,
        },
        "label": {"size": 9, "onWater": s["label"]["onWater"], "onSand": s["label"]["onSand"],
                  "rule": "名稱的 top（海龜 y + TH + 1）≥ floorTop 時用 onSand，否則用 onWater"},
        "tank": {"radius": 10, "border": "theme.border", "previewBorder": s["border"], "previewOutside": "#1d2125"},
    }


def preview_side(spec, pngs, width=None, height=None):
    s = SCENES["S"]
    width, height = width or s["width"], height or s["previewHeight"]
    w, h = width - 2 * S_PAD - 2, height - 2 * S_PAD - 2
    d = side_depths(w, h)
    c = Canvas(w, h, pngs)
    bands = spec["water"]["bands"]
    for i, b in enumerate(bands):
        c.band(round(b["top"] * h), round(bands[i + 1]["top"] * h) if i + 1 < len(bands) else h, b["color"])
    by_id = {layer["id"]: layer for layer in spec["layers"]}
    c.put("surface", w - by_id["surface"]["size"][0], 0)
    for it in by_id["rays"]["items"]:
        c.put(it["file"][:-4], round(it["fx"] * (w - it["size"][0])), it["dy"])
    for it in by_id["fish"]["items"]:
        c.put(it["file"][:-4], round(it["fx"] * (w - it["size"][0])), round(it["fy"] * h))
    cliff, bed = by_id["cliff"], by_id["seabed"]
    i = 0
    while (h - bed["size"][1]) - i * cliff["tileHeight"] > 0:
        c.put(cliff["files"][i % 2][:-4], w - cliff["size"][0], (h - bed["size"][1]) - (i + 1) * cliff["tileHeight"])
        i += 1
    c.put("seabed", w - bed["size"][0], h - bed["size"][1])
    draw_actors(c, spec, d, *side_scene(d))
    out = Image.new("RGBA", (width * DEV, height * DEV), spec["tank"]["previewOutside"])
    ImageDraw.Draw(out).rounded_rectangle([S_PAD * DEV, S_PAD * DEV, (S_PAD + w + 2) * DEV - 1, (S_PAD + h + 2) * DEV - 1],
                                          radius=10 * DEV, fill=spec["tank"]["previewBorder"])
    mask = Image.new("L", c.im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, c.im.width - 1, c.im.height - 1], radius=9 * DEV, fill=255)
    out.paste(c.im, ((S_PAD + 1) * DEV, (S_PAD + 1) * DEV), mask)
    return out.convert("RGB")


# ───────────────────────── spec ─────────────────────────
def build_spec(v, sprites):
    s = SCENES[v]
    size = lambda name: [len(sprites[name][0][0]) * CELL, len(sprites[name][0]) * CELL]
    canvas = s["block"] - PAD_BOTTOM - 2
    layers = [{"id": "water", "order": 0, "mode": "bands", "note": "程式畫色塊：每一段從 top×畫布高 畫到下一段的 top"}]
    for i, layer in enumerate(s["layers"], 1):
        out = {"id": layer["id"], "order": i, "mode": layer["mode"], "anchor": layer["anchor"], "opacity": layer.get("opacity", 1)}
        if layer["mode"] == "tile":
            out.update(file=layer["file"] + ".svg", size=size(layer["file"]), tileWidth=size(layer["file"])[0], dy=layer.get("dy", 0))
        else:
            out["sway"] = bool(layer.get("sway"))
            out["items"] = [{"file": f + ".svg", "size": size(f), "fx": fx, ("fy" if layer["anchor"] == "water" else "dy"): k} for f, fx, k in layer["items"]]
        layers.append(out)
    return {
        "variant": v, "name": s["name"], "cell": CELL,
        "strip": {
            "blockHeight": s["block"], "canvasHeight": canvas,
            "note": "blockHeight 是 layout 裡那個區塊的 px；畫布高 = blockHeight − PAD_BOTTOM(8) − 邊框(2)，也就是 main.js box().height",
            "supportedBlockHeight": [128, 160],
        },
        "sizes": {"TW": TW, "TH": TH, "KW": KW, "KH": KH, "SW": SW, "SH": SH,
                  "pearl": size("pearl"), "bubble": size("bubble"), "bubbleSmall": size("bubble-small")},
        "depths": {"formula": DEPTH_FORMULA, "atRecommendedHeight": depths(1442, canvas)},
        "water": {"bands": [{"top": t, "color": c} for t, c in s["water"]]},
        "layers": layers,
        "anchors": {
            "top": "top = dy",
            "water": "top = round(fy × sandTop)",
            "sandTop": "top = sandTop − 圖高 + dy（dy 是圖的底邊埋進沙面以下幾 px）",
            "bottom": "top = 畫布高 − 圖高",
            "fx": "left = round(fx × (畫布寬 − 圖寬))",
            "tile": "left = i × tileWidth，i = 0 … ceil(畫布寬 / tileWidth) − 1",
        },
        "actors": {
            "order": ["bubbles", "sharks", "kids", "turtles", "labels"],
            "doneProps": [{"file": f + ".svg", "size": size(f), "dx": dx, "dy": dy} for f, dx, dy in DONE_PROPS],
            "donePropsNote": "面向右時相對海龜左上角；面向左時 dx 改成 TW − dx − 圖寬",
            "bubbleOpacity": BUBBLE_OPACITY,
            "kidGap": KID_GAP,
        },
        "label": {"size": 9, "onWater": s["label"]["onWater"], "onSand": s["label"]["onSand"],
                  "rule": "名稱的 top（海龜 y + TH + 1）≥ sandTop 時用 onSand，否則用 onWater"},
        "tank": {"radius": 10, "border": "theme.border", "previewBorder": s["border"], "previewOutside": "#1d2125"},
    }


# ───────────────────────── 預覽與總表（PIL） ─────────────────────────
DEV = 2  # 預覽的輸出倍率（Retina 2x）


def font(px):
    for path in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    return ImageFont.load_default()


class Canvas:
    """邏輯 px 的畫布，內部以 DEV 倍輸出；每格 = CELL 邏輯 px。"""

    def __init__(self, w, h, pngs):
        self.w, self.h, self.pngs = w, h, pngs
        self.im = Image.new("RGBA", (w * DEV, h * DEV), (0, 0, 0, 255))

    def band(self, y0, y1, color):
        ImageDraw.Draw(self.im).rectangle([0, y0 * DEV, self.w * DEV, y1 * DEV - 1], fill=color)

    def put(self, name, x, y, opacity=1.0):
        src = self.pngs[name]
        big = src.resize((src.width * CELL * DEV, src.height * CELL * DEV), Image.NEAREST)
        if opacity < 1:
            big.putalpha(big.getchannel("A").point(lambda a: round(a * opacity)))
        layer = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        layer.paste(big, (round(x * DEV), round(y * DEV)))
        self.im.alpha_composite(layer)

    def text(self, s, mid_x, top, color, px=9):
        f = font(px * DEV)
        d = ImageDraw.Draw(self.im)
        w = d.textlength(s, font=f)
        d.text((mid_x * DEV - w / 2, top * DEV), s, font=f, fill=color)


def draw_background(c, spec, d):
    bands = spec["water"]["bands"]
    for i, b in enumerate(bands):
        y1 = round(bands[i + 1]["top"] * c.h) if i + 1 < len(bands) else c.h
        c.band(round(b["top"] * c.h), y1, b["color"])
    for layer in spec["layers"][1:]:
        if layer["mode"] == "tile":
            w, h = layer["size"]
            top = c.h - h if layer["anchor"] == "bottom" else d["sandTop"] - h + layer["dy"]
            for i in range(math.ceil(c.w / w)):
                c.put(layer["file"][:-4], i * w, top, layer["opacity"])
            continue
        for it in layer["items"]:
            w, h = it["size"]
            top = it["dy"] if layer["anchor"] == "top" else round(it["fy"] * d["sandTop"]) if layer["anchor"] == "water" else d["sandTop"] - h + it["dy"]
            c.put(it["file"][:-4], round(it["fx"] * (c.w - w)), top, layer["opacity"])


def draw_actors(c, spec, d, turtles, kids, sharks):
    for t in turtles:  # 游泳中的海龜頭上一串氣泡（程式裡是從頭邊往上升的那幾顆）
        if t["status"] == "working":
            hx = t["x"] + (TW - 6 if t["facing"] == "r" else 0)
            for name, dx, dy in (("bubble-small", -1, -9), ("bubble", 3, -21), ("bubble-small", -3, -33)):
                if t["y"] + dy > 2:
                    c.put(name, hx + dx, t["y"] + dy, BUBBLE_OPACITY)
    for s in sharks:
        c.put(f"shark-{s['facing']}", s["x"], s["y"])
    for k in kids:
        c.put(f"kid-{k['shell']}-{k['facing']}", k["x"], k["y"])
    for t in sorted(turtles, key=lambda t: t["status"] != "idle"):
        sleep = "-sleep" if t["status"] == "idle" else ""
        c.put(f"turtle-{t['shell']}-{t['facing']}{sleep}", t["x"], t["y"])
        if t["status"] == "done":
            for p in spec["actors"]["doneProps"]:
                dx = p["dx"] if t["facing"] == "r" else TW - p["dx"] - p["size"][0]
                c.put(p["file"][:-4], t["x"] + dx, t["y"] + p["dy"], 1 if p["file"] == "pearl.svg" else BUBBLE_OPACITY)
    for t in turtles:
        top = t["y"] + TH + 1
        c.text(t["space"], t["x"] + TW / 2, top, spec["label"]["onSand" if top >= d["sandTop"] else "onWater"])


def preview(spec, pngs, width=1460, block=None):
    block = block or spec["strip"]["blockHeight"]
    w, h = width - 2 * PAD_X - 2, block - PAD_BOTTOM - 2
    d = depths(w, h)
    c = Canvas(w, h, pngs)
    draw_background(c, spec, d)
    draw_actors(c, spec, d, *demo_scene(d))
    out = Image.new("RGBA", (width * DEV, block * DEV), spec["tank"]["previewOutside"])
    draw = ImageDraw.Draw(out)
    draw.rounded_rectangle([PAD_X * DEV, 0, (PAD_X + w + 2) * DEV - 1, (h + 2) * DEV - 1], radius=10 * DEV, fill=spec["tank"]["previewBorder"])
    mask = Image.new("L", c.im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, c.im.width - 1, c.im.height - 1], radius=9 * DEV, fill=255)
    out.paste(c.im, ((PAD_X + 1) * DEV, DEV), mask)
    return out.convert("RGB")


def sheet(sprites, pngs, bg, tiles, extras=()):
    """總表：每格 4 px（最近鄰）。tile 左右接兩份，看得出接縫；extras 是另外合成的 (圖, 說明)。"""
    z, pad, cap, maxw = 4, 14, 16, 2000
    f = font(11)
    cells = []
    for name in sprites:
        im = pngs[name]
        if name in tiles:
            two = Image.new("RGBA", (im.width * 2, im.height), (0, 0, 0, 0))
            two.paste(im, (0, 0))
            two.paste(im, (im.width, 0))
            im = two
        big = im.resize((im.width * z, im.height * z), Image.NEAREST)
        note = "  (x2, seam check)" if name in tiles else ""
        cells.append((big, f"{name}.svg  {pngs[name].width * cell_of(name)}×{pngs[name].height * cell_of(name)}{note}"))
    for im, label in extras:
        cells.append((im.resize((im.width * z, im.height * z), Image.NEAREST), label))
    rows, row, x = [], [], pad
    for big, label in cells:
        need = max(big.width, int(f.getlength(label))) + pad
        if row and x + need > maxw:
            rows.append(row)
            row, x = [], pad
        row.append((big, label, x))
        x += need
    rows.append(row)
    height = pad + sum(max(b.height for b, _, _ in r) + cap + pad for r in rows)
    out = Image.new("RGBA", (maxw, height), bg)
    draw = ImageDraw.Draw(out)
    y = pad
    for r in rows:
        hmax = max(b.height for b, _, _ in r)
        for big, label, x in r:
            out.alpha_composite(big, (x, y + hmax - big.height))
            draw.text((x, y + hmax + 3), label, font=f, fill="#c9d6dd")
        y += hmax + cap + pad
    return out.convert("RGB")


# ───────────────────────── 輸出 ─────────────────────────
def check_grid(name, rows, pal):
    w = len(rows[0])
    for y, r in enumerate(rows):
        assert len(r) == w, f"{name}: 第 {y} 列寬 {len(r)}，應為 {w}"
        for ch in r:
            assert ch == "." or ch in pal, f"{name}: 第 {y} 列有調色盤沒有的字元 {ch!r}"


def svg_text(rows, pal, cell=CELL):
    h, w = len(rows), len(rows[0])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * cell}" height="{h * cell}" shape-rendering="crispEdges">']
    for y, row in enumerate(rows):
        x = 0
        while x < w:
            if row[x] == ".":
                x += 1
                continue
            x0, color = x, pal[row[x]]
            while x < w and row[x] != "." and pal[row[x]] == color:
                x += 1
            fill, alpha = paint(color)
            alpha = f' fill-opacity="{alpha:g}"' if alpha < 1 else ""
            out.append(f'<rect x="{x0}" y="{y}" width="{x - x0}" height="1" fill="{fill}"{alpha}/>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


RECT = re.compile(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="(#[0-9a-f]{6})"(?: fill-opacity="([0-9.]+)")?/>')


def svg_matches(text, rows, pal, cell=CELL):
    """把寫出的 SVG 讀回格子，跟來源逐格比對。"""
    h, w = len(rows), len(rows[0])
    if f'viewBox="0 0 {w} {h}" width="{w * cell}" height="{h * cell}"' not in text:
        return False
    back = [[None] * w for _ in range(h)]
    for x, y, n, color, alpha in RECT.findall(text):
        for i in range(int(n)):
            if back[int(y)][int(x) + i] is not None:
                return False
            back[int(y)][int(x) + i] = (color, float(alpha or 1))
    return all(back[y][x] == (None if rows[y][x] == "." else paint(pal[rows[y][x]])) for y in range(h) for x in range(w))


def png_image(rows, pal):
    h, w = len(rows), len(rows[0])
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                fill, alpha = paint(pal[ch])
                px[x, y] = rgb(fill) + (round(alpha * 255),)
    return im


def is_red(c):
    """警示紅：色相在紅色附近，而且又飽和又亮。桃、粉、橘不算。"""
    r, g, b = (v / 255 for v in rgb(c))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return (h * 360 < 14 or h * 360 > 346) and s >= 0.5 and v >= 0.4


def hero_sprites():
    """名稱 → (格子, 調色盤)。三個版本都一樣。"""
    out = {}
    for shell in SHELLS:
        pal = turtle_pal(shell)
        out[f"turtle-{shell}-r"] = (TURTLE, pal)
        out[f"turtle-{shell}-l"] = (mirror(TURTLE), pal)
        out[f"turtle-{shell}-r-sleep"] = (TURTLE_SLEEP, pal)
        out[f"turtle-{shell}-l-sleep"] = (mirror(TURTLE_SLEEP), pal)
    for shell in SHELLS:
        pal = turtle_pal(shell)
        out[f"kid-{shell}-r"] = (KID, pal)
        out[f"kid-{shell}-l"] = (mirror(KID), pal)
    out["shark-r"] = (SHARK, SHARK_PAL)
    out["shark-l"] = (mirror(SHARK), SHARK_PAL)
    out["pearl"] = (PEARL, PEARL_PAL)
    out["bubble"] = (BUBBLE, BUBBLE_PAL)
    out["bubble-small"] = (BUBBLE_SMALL, BUBBLE_PAL)
    return out


def main():
    ap = argparse.ArgumentParser(description="Regenerate the aquarium mod's pixel art.")
    ap.add_argument("--variant", choices=sorted(SCENES), default="B", help="B (default) is the set the mod uses")
    ap.add_argument("--out", metavar="DIR", help="write art/, png/, spec.json, preview.png and sheet.png into DIR; "
                    "without it only the SVGs are written, into the mod's own art/")
    args = ap.parse_args()
    v = args.variant
    if not args.out and v != "B":
        sys.exit("The mod is laid out for variant B; write other variants elsewhere with --out DIR.")
    out = os.path.abspath(args.out) if args.out else None
    art_dir = os.path.join(out, "art") if out else MOD_ART
    heroes = hero_sprites()
    assert sum(n.startswith("turtle-") for n in heroes) == 24 and sum(n.startswith("kid-") for n in heroes) == 12
    assert (TW, TH, KW, KH, SW, SH) == (len(TURTLE[0]) * CELL, len(TURTLE) * CELL, len(KID[0]) * CELL, len(KID) * CELL, len(SHARK[0]) * CELL, len(SHARK) * CELL)
    assert len(TURTLE_SLEEP) == len(TURTLE) and len(TURTLE_SLEEP[0]) == len(TURTLE[0])
    sprites = {**heroes, **extra_sprites(), **(side_sprites() if v == "S" else scene_sprites(v))}
    for d in [art_dir] + ([os.path.join(out, "png")] if out else []):
        os.makedirs(d, exist_ok=True)
        for old in os.listdir(d):
            if old.endswith((".svg", ".png")):  # only what this script writes
                os.remove(os.path.join(d, old))
    pngs = {}
    for name, (rows, pal) in sprites.items():
        check_grid(name, rows, pal)
        for ch in {ch for r in rows for ch in r} - {"."}:
            assert not is_red(paint(pal[ch])[0]), f"{name}: {pal[ch]} 是紅色"
        text = svg_text(rows, pal, cell_of(name))
        assert svg_matches(text, rows, pal, cell_of(name)), f"{name}: SVG 讀回來跟格子不一樣"
        with open(os.path.join(art_dir, name + ".svg"), "w") as f:
            f.write(text)
        pngs[name] = png_image(rows, pal)
        if out:
            pngs[name].save(os.path.join(out, "png", name + ".png"))
    if not out:
        print(f"Variant {v}: {len(sprites)} SVGs written to {art_dir}")
        return
    spec = build_spec_side(sprites) if v == "S" else build_spec(v, sprites)
    with open(os.path.join(out, "spec.json"), "w") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
        f.write("\n")
    mid = spec["water"]["bands"][len(spec["water"]["bands"]) // 2]["color"]
    if v == "S":
        preview_side(spec, pngs).save(os.path.join(out, "preview.png"))
        stack = Image.new("RGBA", (CLIFF_W, CLIFF_H * 3), (0, 0, 0, 0))  # 峭壁上下接三張，看接縫
        for i, name in enumerate(("cliff-2", "cliff-1", "cliff-2")):
            stack.paste(pngs[name], (0, i * CLIFF_H))
        sheet(sprites, pngs, mid, set(), [(stack, "cliff-2 / cliff-1 / cliff-2  (stacked, seam check)")]).save(os.path.join(out, "sheet.png"))
        print(f"版本 S「{spec['name']}」：{len(sprites)} 張圖，欄寬 {spec['column']['blockWidth']}，畫布寬 {spec['column']['canvasWidth']}")
        return
    preview(spec, pngs).save(os.path.join(out, "preview.png"))
    sheet(sprites, pngs, mid, {"rocks-far", "sand"}).save(os.path.join(out, "sheet.png"))
    print(f"版本 {v}「{spec['name']}」：{len(sprites)} 張圖，條高 {spec['strip']['blockHeight']}，畫布高 {spec['strip']['canvasHeight']}")


if __name__ == "__main__":
    main()
