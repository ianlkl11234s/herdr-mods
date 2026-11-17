// Aquarium: a strip of sea where each agent is a turtle. Working ones swim, idle ones rest on the sand, finished ones come up
// to the surface with a pearl, and one waiting for you has a shark drifting closer the longer it waits. Moves live in sea.js;
// the swimming itself is native (`.transition` / `.loop`), the timer only decides where to go next. A press on empty water
// drops fish food (sea.js); now and then a school of small fish or a far-off shark passes through (visit.js).
import { View, div, image } from "gpui-kit";
import { agents, checking, nextCommand, props, run, setShared, settings, shared, spaces, terminals, theme } from "herdr";
import { EDGE, FOOD_H, FOOD_W, KH, KW, REST_MS, SH, SW, TH, TICK_MS, TW, at, busy, callEaters, depths, fit, newSea, release, scatter, step } from "./sea.js";
import { FAR_H, FAR_OPACITY, FAR_W, FISH_H, FISH_W, launch, newVisits, tendVisits } from "./visit.js";
import { demoScene } from "./demo.js";

const DEMO_KEY = "aquarium.demo";
const ART = "mods/aquarium/art";
const PAD_X = 8, PAD_BOTTOM = 8;
// Until the app reports a size.
const FIRST = { width: 900, height: 120 };

// The sidebar's space colors (shared "space.colors", kept by the spaces mods). Only read here, never written.
const SHELLS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2"];
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// What the tooltips say, by the block's `lang` prop: "en" (the default) or "zh-TW".
const TEXT = {
  en: {
    words: { working: "working", idle: "idle", done: "done, not seen yet", blocked: "needs you" },
    underMin: "under 1 min", min: (m) => `${m} min`, hours: (h, m) => `${h} h ${m} min`,
    tab: (n) => `tab ${n}`, kid: "sub-agent", demo: "Demo",
    waited: (t) => `, waiting ${t}`, waits: (t) => ` needs you, waiting ${t}`,
  },
  "zh-TW": {
    words: { working: "工作中", idle: "閒置", done: "完成了，還沒看", blocked: "等你處理" },
    underMin: "不到 1 分鐘", min: (m) => `${m} 分鐘`, hours: (h, m) => `${h} 小時 ${m} 分`,
    tab: (n) => `分頁 ${n}`, kid: "子 agent", demo: "示範",
    waited: (t) => `，已等 ${t}`, waits: (t) => ` 在等你，已等 ${t}`,
  },
};
const say = () => (props()?.lang === "zh-TW" ? TEXT["zh-TW"] : TEXT.en);

// The "midnight" palette (art by source/make_art.py (variant B)): fixed colors for the dark theme, not mixed from the theme. Water is a
// few bands, each drawn from its top (a fraction of the tank's height) down to the floor, so a later one covers the one above.
const WATER = [[0, "#1c2329"], [0.18, "#1a242b"], [0.38, "#18242d"], [0.58, "#16232e"], [0.78, "#14212d"]];
const LABEL = { onWater: "#74818c", onSand: "#a9a69d" };
// Back to front. A tile repeats along the tank; an item is [file, w, h, fx, v]: fx places it across the tank's free width, v is
// per `at`: top = px from the top, water = fraction of the sand line, sand = px its bottom edge sinks into the sand.
const BACKDROP = [
  { tile: "rocks-far", size: [480, 68], at: "sand", dy: 4 },
  { at: "top", items: [["beam-wide", 96, 128, 0.21, 0], ["beam-narrow", 76, 128, 0.67, 0]] },
  { at: "water", items: [["fish-school-2", 48, 18, 0.56, 0.2]] },
  { at: "water", items: [["jellyfish", 14, 18, 0.385, 0.16], ["plankton", 60, 28, 0.735, 0.4]] },
  { at: "sand", sway: true, items: [["seaweed-1", 28, 56, 0.022, 5], ["seaweed-2", 38, 30, 0.715, 4]] },
  { tile: "sand", size: [480, 28], at: "bottom" },
  { at: "sand", items: [["stone-1", 36, 18, 0.04, 9], ["coral-1", 34, 26, 0.07, 5], ["seaweed-3", 22, 14, 0.295, 5], ["stone-3", 12, 8, 0.47, 9],
    ["stone-2", 22, 12, 0.655, 8], ["coral-3", 16, 10, 0.682, 6], ["seaweed-3", 22, 14, 0.85, 5], ["stone-2", 22, 12, 0.95, 9]] },
];
// A tile is drawn about 1 device px short on each side (the image is fitted to a whole-pixel height, and 28 px at zoom 0.9 isn't one),
// which leaves a thin dark seam between tiles. So they overlap by this many px, and the first starts half of it off the left edge.
const TILE_OVERLAP = 12;
// What a finished turtle carries, [file, w, h, dx, dy] from its top-left when it faces right (mirrored when it faces left); the
// two bubbles drift a little. Free bubbles are 10 or 6 px, drawn at 0.8.
const PROPS = { pearl: ["pearl", 12, 12, 58, 8], small: ["bubble-small", 6, 6, 66, -1], big: ["bubble", 10, 10, 58, -12] };

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function shellOf(spaceId, spaceName) {
  if (spaceName === "~") return "plain";
  const c = (shared("space.colors") ?? {})[spaceId];
  return SHELLS.includes(c) ? c : SHELLS[hash(spaceId) % SHELLS.length];
}

function minutes(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return say().underMin;
  if (m < 60) return say().min(m);
  return say().hours(Math.floor(m / 60), m % 60);
}

// A sub-agent without a pane reports its raw word, error counting as blocked; it's never "done" (its parent's done is the news).
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" || !RANK[s] ? "idle" : s;
};

export default class Aquarium extends View {
  init(_props, cx) {
    this.sea = newSea();
    this.px = null;
    this.hover = null;
    this.fast = null;
    this.closed = false;
    // The demo has a tank of its own (its cast stays put and only moves to feed); the passers-by are shared by both.
    this.demoSea = null;
    this.visits = newVisits(Date.now(), Math.random);
    try {
      this.since = JSON.parse(localStorage.getItem("since") ?? "{}") ?? {};
    } catch {
      this.since = {};
    }
    if (checking()) return;
    cx.spawn(async (cx) => {
      while (!this.closed) {
        const c = await nextCommand();
        if (c === "demo") setShared(DEMO_KEY, shared(DEMO_KEY) !== true);
        else if (c === "demo-on") setShared(DEMO_KEY, true);
        else if (c === "demo-off") setShared(DEMO_KEY, false);
        else if (c === "feed" || c.startsWith("feed:")) this.feed(cx, Number(c.slice(5)) || undefined);
        else if (c === "visit-fish") this.visit(cx, "fish");
        else if (c === "visit-shark") this.visit(cx, "shark");
        if (c === "demo" || c === "demo-on" || c === "demo-off") this.demoSea = null;
        cx.notify();
      }
    });
  }

  async close() {
    this.closed = true;
    this.ticker?.cancel();
  }

  // The tank's own box, in the units the mod draws in: the size comes in window pixels, and the mod's units follow zoom.
  box() {
    const zoom = Number(settings().zoom) || 1;
    const px = this.px ? { width: this.px.width / zoom, height: this.px.height / zoom } : FIRST;
    // Less the padding around the tank and its 1 px border.
    return { width: Math.max(120, px.width - 2 * PAD_X - 2), height: Math.max(60, px.height - PAD_BOTTOM - 2) };
  }

  // Top-level agents (a kept sub-agent is drawn as its parent's little one, not twice), each with its family's status.
  family() {
    const list = agents(), all = terminals();
    const listed = new Map(list.map((a) => [a.address, a.status]));
    const live = all.filter((k) => k.parent && k.state === "live");
    const below = (addr) => live.filter((k) => k.parent === addr).flatMap((k) => [k, ...below(k.address)]);
    const kidsOf = new Map(), nested = new Set();
    for (const a of list) {
      const kids = below(a.address).map((k) => ({ ...k, status: kidStatus(k, listed) }));
      kidsOf.set(a.address, kids);
      for (const k of kids) nested.add(k.address);
    }
    const tops = list.filter((a) => !nested.has(a.address)).map((a) => {
      const worst = (kidsOf.get(a.address) ?? []).reduce((m, k) => (RANK[k.status] > RANK[m] ? k.status : m), a.status);
      return { ...a, family: worst === "blocked" ? "blocked" : a.status };
    });
    return { list: tops, kidsOf };
  }

  // When each one's status last changed, kept across reloads so a shark doesn't start over on every save.
  track(list, kidsOf, now) {
    const tabs = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, t])));
    let dirty = false;
    const note = (address, status, tab) => {
      const rec = this.since[address];
      if (rec?.s === status) return;
      let when = now;
      const info = tabs.get(tab);
      if (!rec && info?.status === status && info.changed_at) when = info.changed_at;
      this.since[address] = { s: status, at: when };
      dirty = true;
    };
    for (const a of list) {
      note(a.address, a.family, a.tab);
      for (const k of kidsOf.get(a.address) ?? []) note(k.address, k.status, a.tab);
    }
    if (!dirty) return;
    const keep = new Set([...list.map((a) => a.address), ...[...kidsOf.values()].flat().map((k) => k.address)]);
    for (const [k, rec] of Object.entries(this.since)) if (!keep.has(k) && now - rec.at > 86400000) delete this.since[k];
    localStorage.setItem("since", JSON.stringify(this.since));
  }

  sinceOf(address, now) {
    return this.since[address]?.at ?? now;
  }

  signature(list, kidsOf) {
    return list.map((a) => `${a.address}=${a.family}:${(kidsOf.get(a.address) ?? []).map((k) => k.address).join("+")}`).join();
  }

  // Two speeds: every 2 s while anything is about to change, else every 10 s. It draws only when something did.
  pace(cx, fast) {
    if (this.fast === fast) return;
    this.fast = fast;
    this.ticker?.cancel();
    this.ticker = cx.timer.every(fast ? TICK_MS : REST_MS, (cx) => this.tick(cx));
  }

  tick(cx) {
    if (this.closed || !this.px || checking()) return;
    const now = Date.now(), { list, kidsOf } = this.family(), box = this.box(), d = depths(box.width, box.height);
    const demo = shared(DEMO_KEY) === true;
    this.looked = this.signature(list, kidsOf);
    this.track(list, kidsOf, now);
    let changed = step(this.sea, list, kidsOf, (a) => this.sinceOf(a, now), d, now, Math.random, this.fast !== false);
    let fast = busy(this.sea, list, now);
    if (demo) {
      const cast = this.demoCast(d);
      this.demoSea ??= newSea();
      changed = step(this.demoSea, cast.list, cast.kidsOf, () => now, d, now, Math.random, true, cast.homes) || changed;
      fast = busy(this.demoSea, cast.list, now, true) || fast;
    }
    // The schedule only runs in the live tank, and sends no far shark while a reminder shark waits there (or is about to).
    const alert = !demo && (this.sea.sharks.size > 0 || list.some((a) => a.family === "blocked"));
    const seen = tendVisits(this.visits, d, now, Math.random, !demo, alert);
    if (seen.started) this.letGo(cx, seen.started);
    if (changed || seen.changed) cx.notify();
    this.pace(cx, fast);
  }

  // The demo's fixed cast as the same kind of list the live tank is stepped with, and where each one stays.
  demoCast(d) {
    const scene = demoScene(d);
    return {
      list: scene.turtles.map((s) => ({ address: s.key, family: s.status })),
      kidsOf: new Map(scene.turtles.map((s) => [s.key, scene.kids.filter((k) => k.parent === s.key).map((k) => ({ address: k.key, status: k.status }))])),
      homes: new Map(scene.turtles.map((s) => [s.key, { x: s.x, y: s.y, facing: s.facing }])),
    };
  }

  // Flakes at `x` (anywhere when none given): scatter them, send the nearest awake turtles, and let them sink a moment after
  // they were drawn at the surface (a transition only runs from one drawn state to the next).
  feed(cx, x) {
    if (!this.px || checking()) return;
    this.tick(cx);
    const demo = shared(DEMO_KEY) === true, sea = demo ? this.demoSea : this.sea;
    if (!sea) return;
    const now = Date.now(), box = this.box(), d = depths(box.width, box.height);
    const patch = scatter(sea, d, now, Math.random, x ?? EDGE + 24 + Math.random() * Math.max(1, d.width - 2 * EDGE - 48));
    if (patch === null) return;
    callEaters(sea, demo ? this.demoCast(d).list : this.family().list, d, now, Math.random, patch);
    // Ticks start now, so a swim that takes whole ticks ends on one.
    this.fast = null;
    this.pace(cx, true);
    cx.notify();
    cx.timer.after(150, (cx) => {
      if (release(sea, Date.now())) cx.notify();
    });
  }

  // A school or a far shark now, unless one is already crossing.
  visit(cx, kind) {
    if (!this.px || checking()) return;
    const box = this.box(), party = launch(this.visits, kind, depths(box.width, box.height), Date.now(), Math.random, false);
    if (party) this.letGo(cx, party);
  }

  // A party is drawn at its start first; a moment later it is given its far side and the app's own transition carries it there.
  letGo(cx, party) {
    cx.notify();
    cx.timer.after(150, (cx) => {
      if (party.phase !== "new") return;
      party.phase = "go";
      cx.notify();
    });
  }

  // Where a press landed in the tank's own units. `bounds` makes it independent of zoom; without it, divide by zoom.
  point(e) {
    const p = e.local_position;
    if (!p) return null;
    const box = this.box(), zoom = Number(settings().zoom) || 1;
    const sx = e.bounds?.width ? (box.width + 2) / e.bounds.width : 1 / zoom, sy = e.bounds?.height ? (box.height + 2) / e.bounds.height : 1 / zoom;
    return { x: p.x * sx - 1, y: p.y * sy - 1 };
  }

  // Is this spot on a turtle, a little one or a reminder shark? Those have their own click, so it isn't a feeding.
  overActor({ x, y }, now) {
    const demo = shared(DEMO_KEY) === true, sea = demo ? this.demoSea : this.sea, box = this.box();
    const hits = (thing, w, h) => {
      const q = at(thing, now);
      return x >= q.x - 3 && x <= q.x + w + 3 && y >= q.y - 3 && y <= q.y + h + 3;
    };
    if (sea && [...sea.turtles.values()].some((t) => hits(t, TW, TH))) return true;
    if (sea && [...sea.kids.values()].some((k) => hits(k, KW, KH))) return true;
    if (sea && [...sea.sharks.values()].some((s) => hits(s, SW, SH))) return true;
    return demo && demoScene(depths(box.width, box.height)).sharks.some((s) => hits({ x: s.x, y: s.y, ms: 0 }, SW, SH));
  }

  sprinkle(e, cx) {
    if (!this.px || checking()) return;
    const p = this.point(e);
    if (!p || p.x < 0 || p.y < 0 || this.overActor(p, Date.now())) return;
    this.feed(cx, p.x);
  }

  jump(address) {
    if (shared(DEMO_KEY) === true || !address) return;
    run("agent.focus", { terminal: address });
  }

  setHover(key, on, cx) {
    const next = on ? key : this.hover === key ? null : this.hover;
    if (next === this.hover) return;
    this.hover = next;
    cx.notify();
  }

  // What to draw, from the live tank.
  liveScene(d, now) {
    const { list, kidsOf } = this.family();
    const tabs = new Map(spaces().flatMap((s) => s.tabs.map((t) => [t.id, t])));
    const byAddress = new Map(list.map((a) => [a.address, a]));
    const tabLabel = (a) => (!a.tab_name || /^[0-9]+$/.test(a.tab_name) ? say().tab(a.tab_name || a.tab_index) : a.tab_name);
    const words = (status, address, tab) => {
      if (status === "working") {
        const since = tabs.get(tab)?.working_since;
        return since ? `${say().words.working} ${minutes(now - since)}` : say().words.working;
      }
      if (status === "blocked") return `${say().words.blocked}${say().waited(minutes(now - this.sinceOf(address, now)))}`;
      return say().words[status] ?? status;
    };
    const turtles = [], kids = [], sharks = [];
    for (const a of list) {
      const t = this.sea.turtles.get(a.address);
      if (!t) continue;
      turtles.push({
        key: a.address, x: t.x, y: t.y, ms: t.ms, facing: t.facing, status: a.family,
        sleep: a.family === "idle" && t.mode === "rest", shell: shellOf(a.space, a.space_name), space: a.space_name,
        tip: `${a.space_name} › ${tabLabel(a)} · ${words(a.family, a.address, a.tab)}`, address: a.address,
      });
      for (const k of kidsOf.get(a.address) ?? []) {
        const kt = this.sea.kids.get(k.address);
        if (!kt) continue;
        const name = k.name || k.template || k.program?.name || k.address;
        kids.push({
          key: k.address, x: kt.x, y: kt.y, ms: kt.ms, facing: kt.facing, status: k.status, sleep: t.mode === "rest",
          shell: shellOf(a.space, a.space_name), tip: `${a.space_name} › ${say().kid} ${name} · ${words(k.status, k.address, a.tab)}`,
          address: k.address,
        });
      }
    }
    for (const s of this.sea.sharks.values()) {
      const a = byAddress.get(s.address);
      sharks.push({
        key: s.address, x: s.x, y: s.y, ms: s.ms, facing: s.facing, address: a ? s.address : null,
        tip: a ? `${a.space_name} › ${tabLabel(a)}${say().waits(minutes(now - this.sinceOf(a.address, now)))}` : "",
      });
    }
    return { turtles, kids, sharks, bubbles: this.sea.bubbles, food: this.sea.food };
  }

  demoScene(d) {
    const scene = demoScene(d), cast = this.demoSea;
    // Where each one is now: its own spot, or wherever feeding has taken it.
    const now = (s, mine) => {
      const t = mine?.get(s.key);
      return t ? { ...s, x: t.x, y: t.y, ms: t.ms, facing: t.facing } : { ...s, ms: 0 };
    };
    const words = (s) => (s.status === "working" ? `${say().words.working} ${say().min(s.minutes)}` : s.status === "blocked" ? `${say().words.blocked}${say().waited(say().min(s.minutes))}` : say().words[s.status]);
    return {
      turtles: scene.turtles.map((s) => ({ ...now(s, cast?.turtles), sleep: s.status === "idle", tip: `${say().demo} · ${s.space} › ${s.tab} · ${words(s)}`, address: null })),
      kids: scene.kids.map((s) => ({ ...now(s, cast?.kids), sleep: false, tip: `${say().demo} · ${s.space} › ${say().kid} · ${words(s)}`, address: null })),
      sharks: scene.sharks.map((s) => ({ ...s, ms: 0, tip: `${say().demo} · ${s.space}${say().waits(say().min(s.minutes))}`, address: null })),
      bubbles: cast?.bubbles ?? [],
      food: cast?.food ?? [],
    };
  }

  render(cx) {
    const t = theme(), demo = shared(DEMO_KEY) === true, now = Date.now();
    const { width, height } = this.box(), d = depths(width, height);
    if (!demo && !checking()) {
      // The app renders when an agent changes, sooner than the next tick: look now, outside render.
      const { list, kidsOf } = this.family();
      if (this.signature(list, kidsOf) !== this.looked) {
        this.looked = this.signature(list, kidsOf);
        cx.timer.after(1, (cx) => this.tick(cx));
      }
    }
    if (width !== this.laidOut) {
      this.laidOut = width;
      fit(this.sea, d, now);
      // The demo's cast follows the new width at once (it is laid out afresh) unless a feeding has some of it elsewhere.
      if (this.demoSea && !this.demoSea.food.length && !busy(this.demoSea, [], now, true)) this.demoSea = null;
    }
    // Nobody swims in until the tank's size is known, so nothing glides over from a guessed size.
    const scene = !this.px ? { turtles: [], kids: [], sharks: [], bubbles: [], food: [] } : demo ? this.demoScene(d) : this.liveScene(d, now);
    const labels = this.labels(scene.turtles, width);

    const layers = [
      ...WATER.map(([f, c]) => div().absolute().left(0).top(Math.round(f * height)).w(width).h(height - Math.round(f * height)).bg(c)),
      ...this.farShark(),
      ...this.backdrop(width, height, d),
      ...scene.bubbles.map((b) => div().id(`bubble-${b.id}`).absolute().left(Math.round(b.x)).top(b.y).w(b.size).h(b.size)
        .opacity(b.phase === "new" ? 0 : 0.8)
        .transition("top", { duration: b.ms, easing: "linear" }).transition("opacity", { duration: 900 })
        .child(div().id(`bubble-wob-${b.id}`).absolute().top(0).left(0).w(b.size).h(b.size).loop("left", { from: -1.5, to: 1.5, period: 1800 + (b.id % 4) * 300 })
          .child(image(`${ART}/${b.size > 8 ? "bubble" : "bubble-small"}.svg`).w(b.size).h(b.size)))),
      ...this.school(),
      ...scene.sharks.map((s) => this.shark(s, cx)),
      ...scene.kids.map((k) => this.turtle(k, { w: KW, h: KH, kid: true, label: false, d }, t, cx)),
      ...[...scene.turtles].sort((a, b) => (a.status === "idle") - (b.status === "idle")).reverse()
        .map((s) => this.turtle(s, { w: TW, h: TH, kid: false, label: labels.has(s.key), d }, t, cx)),
      ...scene.food.map((p) => this.flake(p)),
    ];

    return div().id("aquarium-root").size_full().px(PAD_X).pb(PAD_BOTTOM)
      .on_size_change((size, cx) => {
        if (size.width === this.px?.width && size.height === this.px?.height) return;
        const first = !this.px;
        this.px = { width: size.width, height: size.height };
        if (first) this.tick(cx);
        cx.notify();
      })
      .child(div().id("aquarium-tank").relative().size_full().rounded(10).border_1().border_color(t.border).overflow_hidden().bg(WATER[0][1])
        .on_mouse_down("left", (e, cx) => this.sprinkle(e, cx))
        .children(layers));
  }

  // The far-off shark: a dark blue-grey silhouette, small (one px a cell, half the size of the reminder shark) and see-through, drawn
  // behind the rocks and everything else, so it reads as distance and not as someone waiting. Not clickable, no tooltip.
  farShark() {
    const g = this.visits.group;
    if (g?.kind !== "shark") return [];
    const s = g.items[0];
    return [div().id(`far-shark-${g.id}`).absolute().left(g.phase === "go" ? s.x1 : s.x0).top(s.y).w(FAR_W).h(FAR_H)
      .opacity(g.fading ? 0 : FAR_OPACITY)
      .transition("left", { duration: s.ms, easing: "linear" }).transition("opacity", { duration: 2000 })
      .child(div().id(`far-shark-bob-${g.id}`).absolute().left(0).top(0).w(FAR_W).h(FAR_H).loop("top", { from: 0, to: 2, period: 7000 })
        .child(image(`${ART}/far-shark-${s.facing}.svg`).w(FAR_W).h(FAR_H)))];
  }

  // A passing school: each fish gets one long transition across the tank (its own length, so they drift a little) and bobs a
  // little on the way. Behind the turtles; not clickable, no tooltip.
  school() {
    const g = this.visits.group;
    if (g?.kind !== "fish") return [];
    return g.items.map((f) => div().id(`fish-${g.id}-${f.i}`).absolute().left(g.phase === "go" ? f.x1 : f.x0).top(f.y).w(FISH_W).h(FISH_H)
      .transition("left", { duration: f.ms, easing: "linear" })
      .child(div().id(`fish-bob-${g.id}-${f.i}`).absolute().left(0).top(0).w(FISH_W).h(FISH_H).loop("top", { from: -1.5, to: 1.5, period: f.period })
        .child(image(`${ART}/fish-pass-${f.kind}-${f.facing}.svg`).w(FISH_W).h(FISH_H))));
  }

  // One flake of food: drawn at the surface, then given the sand as its target; fades out when eaten (or when nobody came).
  flake(p) {
    return div().id(`food-${p.id}`).absolute().left(p.x).top(p.phase === "new" ? p.y0 : p.ground).w(FOOD_W).h(FOOD_H)
      .opacity(p.fade ? 0 : 1)
      .transition("top", { duration: p.ms, easing: "linear" }).transition("opacity", { duration: p.fade?.ms ?? 500, delay: p.fade?.delay ?? 0 })
      .child(div().id(`food-sway-${p.id}`).absolute().left(0).top(0).w(FOOD_W).h(FOOD_H)
        .when(p.phase !== "sand", (el) => el.loop("left", { from: -1.5, to: 1.5, period: 1600 + (p.id % 4) * 250 }))
        .child(image(`${ART}/food.svg`).w(FOOD_W).h(FOOD_H)));
  }

  // The sea behind everyone, from BACKDROP, at whole pixels. Only the plants sway.
  backdrop(width, height, d) {
    const out = [];
    BACKDROP.forEach((layer, li) => {
      if (layer.tile) {
        const [w, h] = layer.size, top = layer.at === "bottom" ? height - h : d.sandTop - h + layer.dy;
        for (let left = -TILE_OVERLAP / 2; left < width; left += w - TILE_OVERLAP) out.push(image(`${ART}/${layer.tile}.svg`).absolute().left(left).top(top).w(w).h(h));
        return;
      }
      layer.items.forEach(([file, w, h, fx, v], i) => {
        const left = Math.round(fx * (width - w));
        const top = layer.at === "top" ? v : layer.at === "water" ? Math.round(v * d.sandTop) : d.sandTop - h + v;
        const pic = image(`${ART}/${file}.svg`).w(w).h(h);
        out.push(layer.sway
          ? div().id(`sway-${li}-${i}`).absolute().left(left).top(top).w(w).h(h).loop("left", { from: left - 1.5, to: left + 1.5, period: 5200 + i * 1500 }).child(pic)
          : pic.absolute().left(left).top(top));
      });
    });
    return out;
  }

  // Which turtles get their space name underneath: the ones whose name doesn't run into another's (the most urgent first),
  // or, in a crowded tank, only the one under the pointer. The tooltip always has it.
  labels(turtles, width) {
    const shown = new Set(), placed = [];
    const crowded = turtles.length * 120 > width;
    const textWidth = (s) => [...(s ?? "")].reduce((w, c) => w + (c.charCodeAt(0) < 128 ? 5.3 : 9.5), 6);
    const order = [...turtles].sort((a, b) => (b.key === this.hover) - (a.key === this.hover) || RANK[b.status] - RANK[a.status]);
    for (const s of order) {
      const hovered = s.key === this.hover;
      if (crowded && !hovered) continue;
      const w = Math.min(TW + 72, textWidth(s.space)), mid = s.x + TW / 2, y = s.y + TH + 1;
      if (!hovered && placed.some((p) => Math.abs(p.mid - mid) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < 13)) continue;
      placed.push({ mid, w, y });
      shown.add(s.key);
    }
    return shown;
  }

  turtle(s, o, t, cx) {
    const bob = s.status === "idle" ? null
      : o.kid ? { from: 0, to: 2, period: 2300 }
      : s.status === "done" ? { from: 0, to: 2, period: 4400 }
      : s.status === "blocked" ? { from: 0, to: 1.5, period: 3800 }
      : { from: 0, to: 3, period: 2600 + (hash(s.key) % 5) * 200 };
    const move = { duration: s.ms || 400, easing: "linear", delay: o.kid ? 500 : 0 };
    const pic = image(`${ART}/${o.kid ? "kid" : "turtle"}-${s.shell}-${s.facing}${s.sleep && !o.kid ? "-sleep" : ""}.svg`).w(o.w).h(o.h);
    // A prop's left edge: mirrored when the turtle faces left.
    const propX = ([, w, , dx]) => (s.facing === "r" ? dx : o.w - dx - w);
    const [pearl, small, big] = [PROPS.pearl, PROPS.small, PROPS.big];
    const body = div().id(`turtle-bob-${s.key}`).absolute().left(0).top(0).w(o.w).h(o.h)
      .when(Boolean(bob), (el) => el.loop("top", bob))
      .child(pic)
      .when(s.status === "done" && !o.kid, (el) => el
        .child(image(`${ART}/pearl.svg`).absolute().left(propX(pearl)).top(pearl[4]).w(pearl[1]).h(pearl[2]))
        .child(div().id(`pearl-b1-${s.key}`).absolute().left(propX(small)).top(small[4]).w(small[1]).h(small[2]).loop("top", { from: small[4] + 1, to: small[4] - 2, period: 3800 })
          .child(image(`${ART}/bubble-small.svg`).w(small[1]).h(small[2])))
        .child(div().id(`pearl-b2-${s.key}`).absolute().left(propX(big)).top(big[4]).w(big[1]).h(big[2]).loop("top", { from: big[4] + 1, to: big[4] - 2, period: 4600 })
          .child(image(`${ART}/bubble.svg`).w(big[1]).h(big[2]))));
    return div().id(`turtle-${s.key}`).absolute().left(s.x).top(s.y).w(o.w).h(o.h)
      .transition("left", move).transition("top", move)
      .cursor_pointer()
      .tooltip(s.tip)
      .on_click((_e, cx) => this.jump(s.address))
      .on_hover((on, cx) => this.setHover(s.key, on, cx))
      .child(body)
      .when(o.label, (el) => el.child(div().absolute().top(o.h + 1).left(-36).w(o.w + 72).text_center().truncate()
        .text_size(9).text_color(s.y + TH + 1 >= o.d.sandTop ? LABEL.onSand : LABEL.onWater).child(s.space ?? "")));
  }

  shark(s, cx) {
    const move = { duration: s.ms || 400, easing: "linear" };
    return div().id(`shark-${s.key}`).absolute().left(s.x).top(s.y).w(SW).h(SH)
      .transition("left", move).transition("top", move)
      .when(Boolean(s.address), (el) => el.cursor_pointer().on_click((_e, cx) => this.jump(s.address)))
      .when(Boolean(s.tip), (el) => el.tooltip(s.tip))
      .child(div().id(`shark-bob-${s.key}`).absolute().left(0).top(0).w(SW).h(SH).loop("top", { from: 0, to: 2.5, period: 4200 })
        .child(image(`${ART}/shark-${s.facing}.svg`).w(SW).h(SH)));
  }
}
