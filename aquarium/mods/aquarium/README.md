# Aquarium

A strip of night-time sea along the bottom of the Herdr window. Every agent is a pixel-art sea turtle and its sub-agents are
little turtles swimming behind it. When an agent is waiting for you, a blue-grey shark drifts in and stops a little closer the
longer it waits. Click the water to feed the turtles; now and then a school of fish or a far-off shark passes by.

Tested on Herdr 0.1.16 (the desktop app, `herdr-app`).

## What each status looks like

| Agent status | In the tank |
|---|---|
| `working` | Swims back and forth in open water: a stretch, then a glide, bobbing gently. Bubbles rise now and then, some from its head. |
| `idle` | Sinks to the sand and sleeps with its eyes closed; shuffles a little once in a while. |
| `done` (finished, not looked at yet) | Floats up near the surface with a small pearl in front of it and two bubbles above. |
| `blocked` (waiting for you) | Stops and turns to face the shark. The shark swims in from the nearer edge that has room and waits at 210 px, then 165 px after 1 min, 125 px after 3 min, 92 px after 6 min and 64 px after 10 min, where it stays. When the status changes, it turns round and swims away. |

- **Sub-agents** (live terminals whose `parent` is the agent) are little turtles that follow their parent, up to 3. If any of
  them is blocked, the whole family counts as blocked and the shark comes.
- **Shell color** follows the space's color in the sidebar (the shared `space.colors` value that Herdr's spaces list keeps) when
  it is `ansi6`, `ansi3`, `ansi4`, `ansi5` or `ansi2`. Any other value (`ansi1`, a custom hex) is mapped onto those five by space
  id. The `~` space is grey. Skin and shells are toned towards natural turtle browns, so the hue tells spaces apart without
  shouting.
- **Labels**: the space name in small grey text under each turtle (`#74818c` over water, `#a9a69d` over sand). When names would
  overlap, only the more urgent turtle gets one; in a crowded tank (less than about 120 px per turtle) a name shows only on hover.
- **Hover** a turtle or a shark for a tooltip: space › tab · status, with how long it has been working or waiting.
- **Click** a turtle or a shark to jump to that agent (`agent.focus`).
- No red, no flashing, no pulsing. Every movement is a native `.transition` or `.loop`; a timer only decides what happens next:
  every 2 s while something is about to change, every 10 s otherwise.

## Feeding

- Click empty water (not a turtle, a little one or a waiting shark) and 3 to 5 flakes drop from the surface at that spot, spread
  out a little, and sink to the sand in 6 to 8 s. At most 10 flakes are in the tank at once.
- The one or two nearest awake turtles (`working` or `done`) swim over at 1.8 times their usual speed, one on each side. As the
  flakes land they fade out one by one (that is the eating), the turtle lets go a small bubble, and about 3 s later it goes back
  to what its status asks for. Little ones follow their parent.
- Sleeping (`idle`) turtles don't wake up and a `blocked` one doesn't move: it is watching the shark. Flakes nobody comes for stay
  on the sand and fade after about 30 s.
- Feeding works in the demo too; the demo turtles swim back to their places afterwards.

## Passers-by

At most one group at a time. They can't be clicked and have no tooltip (a click on them counts as a click on the water).

- **A school of fish**: 5 to 9 small fish of one kind (12×8 px, grey-blue or dark silver), crossing from one side to the other,
  each at a slightly different speed and depth. On average every 4 minutes (each wait is random, 2 to 6 minutes).
- **A far-off shark**: the waiting shark's outline at half size (44×20 px), one flat dark blue-grey at 42% opacity, drawn behind
  the far rocks so it reads as distance and can't be mistaken for a shark that is waiting on someone. It crosses the upper half
  slowly (16 px/s) without stopping. On average every 12.5 minutes. It never comes while a shark is waiting on an agent (it tries
  again a minute later), and a scheduled one already crossing fades out within 2 s when an agent starts waiting.
- The schedule runs only in the live tank, not in the demo. A window resized mid-crossing doesn't change that group's path.

## Commands

```sh
herdr-app do aquarium.demo-on      # the demo tank: a fixed cast, one of every status
herdr-app do aquarium.demo-off     # back to your agents
herdr-app do aquarium.demo         # toggle
herdr-app do aquarium.feed         # drop food at a random spot
herdr-app do aquarium.feed:300     # drop food at x = 300 (logical px from the tank's left edge)
herdr-app do aquarium.visit-fish   # send a school of fish now
herdr-app do aquarium.visit-shark  # send a far-off shark now
```

Commands reach only a copy that is on screen, so the layout needs the aquarium block. `feed:300` must be written with the colon;
`--x 300` is ignored and gives a random spot. A visit is ignored while another group is still crossing. `visit-shark` comes even
when a shark is waiting on someone (the schedule never does that). The demo state is kept in the shared value `aquarium.demo`.

The mod ships no `keys.json`. To put a command on a key, add it to yours, for example
`"global": { "ctrl-alt-f": "aquarium.feed" }`.

The demo cast: two working turtles (one with a little one), one idle, one done and one blocked with its shark, labelled `api`,
`docs`, `data`, `web` and `infra`. Clicking them does nothing and they stay put except to feed.

## Install

1. Copy `mods/aquarium/` to `~/.config/herdr-app/mods/aquarium/`. Keep the folder name `aquarium`: the art is loaded from
   `mods/aquarium/art/` and the commands are `aquarium.*`.
2. Add a block to a layout of your own. Herdr's shipped layouts don't accept new structure, so clone one first (command
   palette → Duplicate layout, or `herdr-app do layout.clone --name main`, which makes `main-copy` and switches to it).
3. In that layout file, put the block in the `work` column between `work-body` and `status`:

   ```json
   { "id": "aquarium", "type": "block", "size": { "px": 128 }, "content": { "mod": "aquarium", "props": { "lang": "en" } } }
   ```

   `lang` picks the tooltip language: `"en"` (the default when left out) or `"zh-TW"` (Traditional Chinese). The art is laid out
   for a 128 px block; the light beams are long enough for up to 160 px.
4. Run `herdr-app check ~/.config/herdr-app/mods/aquarium`, then `herdr-app do aquarium.demo-on` to see it.

The colors are fixed for a dark theme; there is no light palette.

## What it reads, writes and runs

- **Reads** Herdr's live data through the mod API: `agents()`, `terminals()`, `spaces()`, `settings().zoom`, `theme()` and the
  shared `space.colors` (read only, never written).
- **Writes** the shared value `aquarium.demo`, and one `localStorage` entry, `since`: when each agent's status last changed, so a
  shark keeps its distance across reloads. Entries for agents that are gone are dropped after 24 hours. Herdr keeps it under
  `~/.config/herdr-app/data/aquarium/`.
- **Runs** one Herdr command, `agent.focus`, when you click a turtle or a shark.
- It does **not** use `exec`, `hc`, `fetch` or `fs`: no programs, no network, no files of its own.
- `source/make_art.py` runs only when you run it. It reads no input files; it writes the SVGs (see below) and, with `--out`, the
  previews, for which it may read a system font (`/System/Library/Fonts/SFNS.ttf` or `Helvetica.ttc`) to draw the labels.

## Regenerating the art

All images in `art/` come from the pixel grids and palettes in `source/make_art.py`: pixel art at 2 logical px per cell (the
far-off shark at 1 px per cell). It needs Python 3 and Pillow (`pip3 install pillow`).

```sh
cd ~/.config/herdr-app/mods/aquarium
python3 source/make_art.py                 # rewrites art/*.svg in place (variant B, the set the mod uses)
python3 source/make_art.py --out /tmp/aq   # leaves the mod alone: art/, png/, spec.json, preview.png, sheet.png in /tmp/aq
```

Before writing, the script deletes the `*.svg` and `*.png` files in the target `art/`, so a renamed sprite leaves nothing behind. Variants `A`
and `S` are earlier sketches kept for reference and need `--out`; the mod's code is laid out for `B`.

If you change sizes, colors or the backdrop layout (see `spec.json` from an `--out` run), update `TW/TH/KW/KH/SW/SH` and
`depths()` in `sea.js`, and `WATER`, `BACKDROP` and `PROPS` in `main.js`, which are copied from it by hand. Then run
`herdr-app check` and look at the demo.

Notes from building it:

- The light beams, jellyfish and plankton are see-through through SVG `fill-opacity`, which `image()` honours.
- Herdr can't flip an image horizontally, so every sprite that faces a way has a left (`-l`) and a right (`-r`) file.
- At zoom 0.9, 2 px cells are not whole device pixels, so edges are a little softer than at zoom 1.0. The repeating `rocks-far`
  and `sand` tiles also come out about a device pixel short on each side and leave a dark seam, so `TILE_OVERLAP` in `main.js`
  overlaps them by 12 px. Check the seams again if you change the tile sizes.
- `coral-2.svg` and `fish-school-1.svg` are part of the set but not placed.

## Tuning

- `visit.js`, at the top: `FISH_EVERY_MS` and `SHARK_EVERY_MS` (average waits; each wait is random between half and one and a half
  of it), `FAR_OPACITY` (0.35 to 0.5 reads as far away), `SCHOOL_SPEED` and `FAR_SPEED` (px/s).
- `sea.js`, the Feeding section: `MAX_FOOD`, `FEED_SPEED`, `SPREAD`, `FALL_MS`, `EAT_STAGGER`, `EAT_FADE`, `AFTER_MEAL`,
  `SAND_LIFE`. `SHARK_STEPS` sets how close the waiting shark comes and when.

## Remove

1. Take the `aquarium` block out of your layout.
2. Delete `~/.config/herdr-app/mods/aquarium/`.
3. Optionally delete `~/.config/herdr-app/data/aquarium/` (its `localStorage`). The shared `aquarium.demo` value is harmless.

Deleting only the folder leaves an empty strip in the layout.

## Files

- `main.js`: reads the agents, decides when to look again, draws the tank; clicks, feeding and the commands.
- `sea.js`: who is where and where they are going (start, target, duration), feeding included. Draws nothing.
- `visit.js`: the passing school and the far-off shark (schedule and settings). Draws nothing.
- `demo.js`: the demo cast.
- `art/`: 65 full-color SVGs drawn with `image()`.
- `source/make_art.py`: the source of the art.

## Credits

Inspired by Woolhill by adamentwistle on [herdr.dev/mods](https://herdr.dev/mods), where the agents are sheep and a wolf comes
closer while one waits.

## 繁體中文摘要

視窗底部的一條夜間海底水族箱。每個 agent 是一隻像素海龜，子 agent 是跟在後面的小海龜。工作中的在水裡游，閒置的趴在沙上睡，完成的浮到水面帶一顆珍珠，等你處理的會有一隻鯊魚游過來，等越久停得越近。點水面可以餵食，偶爾會有魚群或遠處的鯊魚經過。滑鼠移到海龜上會顯示狀態，點一下會跳到那個 agent。

在版面 block 的 `props` 加 `"lang": "zh-TW"`，提示文字就會是中文，預設是英文。這個 mod 不連網、不執行外部程式，只讀 Herdr 提供的 agent 資料，並用 `localStorage` 記錄每個 agent 開始等待的時間。美術由 `source/make_art.py` 產生。
