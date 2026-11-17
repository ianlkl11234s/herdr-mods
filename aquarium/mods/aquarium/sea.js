// Who is where in the tank and where they're headed. No drawing here: main.js draws it. Every move is a start, a target and
// a length, and the swim itself is the app's own `.transition("left"/"top")`, so this only runs when something starts or stops.
export const TICK_MS = 2000;
export const REST_MS = 10000;
export const TW = 56, TH = 34, KW = 30, KH = 20, SW = 88, SH = 40;
export const EDGE = 8;
const SWIM_SPEED = 15, SINK_SPEED = 12, SCOOT_SPEED = 5, SHARK_SPEED = 20, LEAVE_SPEED = 36;
const MAX_KIDS = 3;

// How far off the shark waits, in px from the turtle, by how long the agent has waited. Closer in steps, then it stays.
const SHARK_STEPS = [[0, 210], [60000, 165], [180000, 125], [360000, 92], [600000, 64]];
export const sharkGap = (waited) => SHARK_STEPS.reduce((gap, [after, px]) => (waited >= after ? px : gap), SHARK_STEPS[0][1]);

export const newSea = () => ({ turtles: new Map(), kids: new Map(), sharks: new Map(), bubbles: [], nextBubble: 0, food: [], nextFood: 0, nextPatch: 0 });

// Depths in the tank, from its size.
export function depths(width, height) {
  const sandTop = height - 22;
  const swimTop = 22, swimBottom = Math.max(swimTop + 4, sandTop - TH - 16);
  return { width, height, sandTop, surface: 16, swimTop, swimBottom, rest: sandTop - TH + 4 };
}

// Whole ticks, so a swim ends on a tick and the next decision comes as it stops.
const travel = (px, speed) => Math.max(1, Math.round(px / speed / (TICK_MS / 1000))) * TICK_MS;

export function at(thing, now) {
  if (!thing.ms || now >= thing.t0 + thing.ms) return { x: thing.x, y: thing.y };
  const k = (now - thing.t0) / thing.ms;
  return { x: thing.fx + (thing.x - thing.fx) * k, y: thing.fy + (thing.y - thing.fy) * k };
}

export const inMotion = (thing, now) => thing.ms > 0 && now < thing.t0 + thing.ms;

function moveTo(thing, x, y, now, ms) {
  const p = at(thing, now);
  thing.fx = p.x;
  thing.fy = p.y;
  thing.x = x;
  thing.y = y;
  thing.t0 = now;
  thing.ms = ms;
  if (Math.abs(x - p.x) > 1) thing.facing = x > p.x ? "r" : "l";
}

function stop(thing, now) {
  const p = at(thing, now);
  thing.x = thing.fx = p.x;
  thing.y = thing.fy = p.y;
  thing.ms = 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const roomX = (d) => Math.max(EDGE, d.width - TW - EDGE);

// Of a few random spots, the one farthest from everyone already in the tank.
function newTurtle(sea, address, d, now, rand) {
  const others = [...sea.turtles.values()].map((o) => o.x);
  let x = EDGE + rand() * (roomX(d) - EDGE), best = -1;
  for (let i = 0; i < 8 && others.length; i++) {
    const c = EDGE + rand() * (roomX(d) - EDGE), room = Math.min(...others.map((o) => Math.abs(o - c)));
    if (room > best) [x, best] = [c, room];
  }
  const y = d.swimTop + rand() * (d.swimBottom - d.swimTop);
  return { address, x, y, fx: x, fy: y, t0: now, ms: 0, facing: rand() < 0.5 ? "l" : "r", mode: "start", until: 0 };
}

// A smaller window leaves less tank: whatever is past the new edge comes back to it.
export function fit(sea, d, now) {
  for (const t of sea.turtles.values()) {
    if (t.feed) continue;
    const p = at(t, now);
    const x = clamp(Math.max(t.x, p.x), EDGE, roomX(d)), y = clamp(t.y, 4, d.rest);
    if (x === t.x && y === t.y) continue;
    t.x = t.fx = x;
    t.y = t.fy = y;
    t.ms = 0;
    t.until = 0;
  }
  for (const s of sea.sharks.values()) if (!s.leaving) s.gap = null;
}

// Working: swim a stretch, glide a while, swim again; depth wanders inside the swim band.
function tendWorking(t, d, now, rand) {
  if (!["start", "swim", "glide"].includes(t.mode)) {
    t.mode = "start";
    t.until = 0;
  }
  if (now < t.until) return false;
  if (t.mode === "swim" || (t.mode === "glide" && rand() < 0.3)) {
    stop(t, now);
    t.mode = "glide";
    t.until = now + 6000 + Math.round(rand() * 12000);
    return true;
  }
  const here = at(t, now), reach = 40 + rand() * 140, way = rand() < 0.5 ? -1 : 1;
  let x = here.x + reach * way;
  if (x < EDGE || x > roomX(d)) x = here.x - reach * way;
  x = clamp(x, EDGE, roomX(d));
  const y = d.swimTop + rand() * (d.swimBottom - d.swimTop);
  const ms = travel(Math.hypot(x - here.x, y - here.y), SWIM_SPEED);
  moveTo(t, x, y, now, ms);
  t.mode = "swim";
  t.until = now + ms;
  return true;
}

const ON_SAND = ["sink", "rest", "scoot"];

// The nearest spot on the sand to `x` with room beside the turtles already resting there.
function sandSpot(sea, self, x, d) {
  const others = [...sea.turtles.values()].filter((o) => o !== self && ON_SAND.includes(o.mode)).map((o) => o.x);
  for (let k = 0; k < 60; k++) {
    for (const way of k ? [1, -1] : [1]) {
      const c = clamp(x + way * k * 10, EDGE, roomX(d));
      if (others.every((o) => Math.abs(o - c) >= TW + 6)) return c;
    }
  }
  return x;
}

// Idle: sink to the sand and rest; now and then shuffle a little.
function tendIdle(sea, t, d, now, rand) {
  if (!ON_SAND.includes(t.mode)) {
    const here = at(t, now), x = sandSpot(sea, t, here.x, d);
    const ms = travel(Math.hypot(x - here.x, d.rest - here.y), SINK_SPEED);
    moveTo(t, x, d.rest, now, ms);
    t.mode = "sink";
    t.until = now + ms;
    return true;
  }
  if (now < t.until) return false;
  if (t.mode !== "rest") {
    t.mode = "rest";
    t.until = now + 60000 + Math.round(rand() * 120000);
    return true;
  }
  if (rand() < 0.5) {
    const here = at(t, now), way = rand() < 0.5 ? -1 : 1;
    const x = clamp(here.x + way * (10 + rand() * 24), EDGE, roomX(d));
    if (sandSpot(sea, t, x, d) !== x) {
      t.until = now + 60000;
      return false;
    }
    const ms = travel(Math.abs(x - here.x), SCOOT_SPEED);
    moveTo(t, x, d.rest, now, ms);
    t.mode = "scoot";
    t.until = now + ms;
    return true;
  }
  t.until = now + 60000;
  return false;
}

// Done: come up near the surface and stay there, with the pearl.
function tendDone(t, d, now) {
  if (t.mode === "rise" || t.mode === "float") {
    if (t.mode === "rise" && now >= t.until) {
      t.mode = "float";
      return true;
    }
    return false;
  }
  const here = at(t, now);
  const ms = travel(Math.abs(here.y - d.surface), SINK_SPEED);
  moveTo(t, here.x, d.surface, now, ms);
  t.mode = "rise";
  t.until = now + ms;
  return true;
}

// Blocked: stop where it is and look at the shark.
function tendBlocked(t, shark, now) {
  const facing = shark ? (shark.side > 0 ? "r" : "l") : t.facing;
  if (t.mode === "alert" && t.facing === facing) return false;
  stop(t, now);
  t.mode = "alert";
  t.facing = facing;
  return true;
}

// A shark comes in from the nearer edge when there's room on that side to wait in, else from the other one, so it crosses as
// little of the tank as it can.
function newShark(t, d, now, since) {
  const here = at(t, now), need = SHARK_STEPS[0][1] + SW + EDGE;
  const left = here.x, right = d.width - here.x - TW;
  let side = left < right ? -1 : 1;
  if ((side < 0 ? left : right) < need) side = left > right ? -1 : 1;
  const x = side > 0 ? d.width + 12 : -SW - 12;
  const y = clamp(here.y + TH / 2 - SH / 2, 4, d.sandTop - SH + 2);
  return { address: t.address, side, x, y, fx: x, fy: y, t0: now, ms: 0, facing: side > 0 ? "l" : "r", since, gap: null, leaving: false, doneAt: 0 };
}

function tendShark(s, t, d, now) {
  const gap = sharkGap(now - s.since);
  if (gap !== s.gap) {
    s.gap = gap;
    const here = at(t, now);
    const nose = s.side > 0 ? here.x + TW + gap : here.x - gap - SW;
    const x = clamp(nose, EDGE, d.width - SW - EDGE);
    const y = clamp(here.y + TH / 2 - SH / 2, 4, d.sandTop - SH + 2);
    moveTo(s, x, y, now, travel(Math.hypot(x - at(s, now).x, y - at(s, now).y), SHARK_SPEED));
    return true;
  }
  const facing = s.side > 0 ? "l" : "r";
  if (!inMotion(s, now) && s.facing !== facing) {
    s.facing = facing;
    return true;
  }
  return false;
}

// Not chased: it just turns round and swims off, unhurried.
function swimOff(s, d, now) {
  const here = at(s, now);
  const away = s.side > 0 ? d.width + SW : -SW * 2;
  const ms = Math.max(1500, Math.round((Math.abs(away - here.x) / LEAVE_SPEED) * 1000));
  moveTo(s, away, here.y, now, ms);
  s.leaving = true;
  s.doneAt = now + ms;
}

// Little ones keep close behind their parent: same target, same length, a beat later.
function follow(k, t, d, now) {
  const behind = t.facing === "r" ? -(KW + 2) - k.index * (KW - 6) : TW + 2 + k.index * (KW - 6);
  const x = clamp(t.x + behind, 2, d.width - KW - 2);
  const y = clamp(t.y + TH - KH + (k.index % 2 ? -10 : 1), 4, d.sandTop - KH + 4);
  const facing = t.facing;
  if (Math.abs(x - k.x) < 1 && Math.abs(y - k.y) < 1 && facing === k.facing) return false;
  const left = inMotion(t, now) ? t.t0 + t.ms - now : 0;
  const here = at(k, now);
  k.fx = here.x;
  k.fy = here.y;
  k.x = x;
  k.y = y;
  k.t0 = now;
  k.ms = Math.max(left, travel(Math.hypot(x - here.x, y - here.y), SWIM_SPEED * 1.6));
  k.facing = facing;
  return true;
}

// Feeding. A click (or `aquarium.feed`) scatters a few flakes at the surface and they sink to the sand in 6 to 8 s. The nearest
// one or two awake turtles (working or done) swim over, faster than usual; once the flakes are down they fade out one by one, which
// is the turtle eating them. Then it lets go a small bubble and, a few seconds on, goes back to whatever its state asks. A sleeping
// or blocked turtle doesn't come. Flakes nobody came for stay on the sand and fade out after SAND_LIFE.
export const MAX_FOOD = 10;
export const FOOD_W = 8, FOOD_H = 6;
const FEED_SPEED = SWIM_SPEED * 1.8;
const SPREAD = 28, FALL_MS = [6000, 8000];
const EAT_STAGGER = 700, EAT_FADE = 500, AFTER_MEAL = 3000, SAND_LIFE = 30000, SAND_FADE = 2500;

// 3 to 5 flakes around `x`, never more than MAX_FOOD in the tank. Drawn first at the surface; `release` lets them go. Says which
// patch they are, or null when the tank is full.
export function scatter(sea, d, now, rand, x) {
  const n = Math.min(MAX_FOOD - sea.food.length, 3 + Math.floor(rand() * 3));
  if (n <= 0) return null;
  const patch = sea.nextPatch++;
  for (let i = 0; i < n; i++) {
    sea.food.push({
      id: sea.nextFood++, patch, born: now, phase: "new", t0: 0, landedAt: 0, owner: null, fade: null, removeAt: 0,
      x: Math.round(clamp(x + ((i + rand() * 0.8) / n * 2 - 1) * SPREAD, EDGE, d.width - FOOD_W - EDGE)),
      y0: Math.round(4 + rand() * 8), ground: Math.round(d.sandTop - 2 + rand() * 8),
      ms: Math.round(FALL_MS[0] + rand() * (FALL_MS[1] - FALL_MS[0])),
    });
  }
  return patch;
}

// The flakes were drawn at the surface first; this lets them go, and the app's own transition does the sinking.
export function release(sea, now) {
  let any = false;
  for (const p of sea.food) {
    if (p.phase !== "new") continue;
    p.phase = "fall";
    p.t0 = now;
    any = true;
  }
  return any;
}

// Sends the nearest one or two awake turtles to a patch: each stands on its own side of it, nose over the flakes nearest to it.
// Two from the same side: the second stands back a little and higher. Says how many went.
export function callEaters(sea, list, d, now, rand, patch) {
  const flakes = sea.food.filter((p) => p.patch === patch);
  if (!flakes.length) return 0;
  const left = Math.min(...flakes.map((p) => p.x)), right = Math.max(...flakes.map((p) => p.x)) + FOOD_W, mid = (left + right) / 2;
  const seen = new Map();
  const stands = list
    .filter((a) => (a.family === "working" || a.family === "done") && sea.turtles.get(a.address) && !sea.turtles.get(a.address).feed)
    .map((a) => ({ t: sea.turtles.get(a.address), from: at(sea.turtles.get(a.address), now).x + TW / 2 }))
    .sort((p, q) => Math.abs(p.from - mid) - Math.abs(q.from - mid))
    .slice(0, rand() < 0.5 ? 1 : 2)
    .map((e) => {
      const side = e.from < mid ? -1 : 1, behind = seen.get(side) ?? 0;
      seen.set(side, behind + 1);
      return { t: e.t, side, nose: side < 0 ? left + 10 - behind * 28 : right - 10 + behind * 28, lift: behind * 9, mine: [] };
    });
  if (!stands.length) return 0;
  for (const f of flakes) {
    const at0 = f.x + FOOD_W / 2;
    stands.reduce((m, s) => (Math.abs(s.nose - at0) < Math.abs(m.nose - at0) ? s : m)).mine.push(f);
  }
  let sent = 0;
  for (const s of stands) {
    if (!s.mine.length) continue;
    const t = s.t, face = s.side < 0 ? "r" : "l", here = at(t, now);
    const x = clamp(face === "r" ? s.nose - TW + 2 : s.nose - 2, EDGE, roomX(d)), y = clamp(d.rest + 5 - s.lift, 4, d.sandTop);
    const ms = travel(Math.hypot(x - here.x, y - here.y), FEED_SPEED);
    moveTo(t, x, y, now, ms);
    t.facing = face;
    t.mode = "feed";
    t.until = now + ms;
    t.feed = { ids: s.mine.map((f) => f.id), nose: s.nose, phase: "go" };
    for (const f of s.mine) f.owner = t.address;
    sent++;
  }
  return sent;
}

// It stopped being awake, or its agent is gone: let go of the flakes it had claimed (tendFood sees it) and carry on from here.
function quitFeed(t, now) {
  stop(t, now);
  t.feed = null;
  t.mode = "start";
  t.until = 0;
}

// Done: with a `home` (the still demo tank) swim back to it, else the state's own tending takes over.
function endFeed(t, now, home) {
  t.feed = null;
  if (!home) {
    t.mode = "start";
    t.until = 0;
    return;
  }
  const here = at(t, now), ms = travel(Math.hypot(home.x - here.x, home.y - here.y), SWIM_SPEED);
  moveTo(t, home.x, home.y, now, ms);
  t.mode = "home";
  t.until = now + ms + TICK_MS;
}

// go (swim over) -> eat (each flake fades as it lands, a beat after the one before) -> after (a small bubble, a few seconds).
// The fade's own delay lines the eating up with the landing, so nothing waits for a tick.
function tendFeed(sea, t, now, home) {
  const f = t.feed, mine = sea.food.filter((p) => f.ids.includes(p.id));
  if (f.phase === "go") {
    if (now < t.until || mine.some((p) => p.phase === "new")) return false;
    if (!mine.length) {
      endFeed(t, now, home);
      return true;
    }
    let eatAt = now - EAT_STAGGER;
    for (const p of [...mine].sort((p, q) => Math.abs(p.x + FOOD_W / 2 - f.nose) - Math.abs(q.x + FOOD_W / 2 - f.nose))) {
      eatAt = Math.max(p.phase === "fall" ? p.t0 + p.ms : now, eatAt + EAT_STAGGER, now);
      p.fade = { delay: eatAt - now, ms: EAT_FADE };
      p.removeAt = eatAt + EAT_FADE + 500;
    }
    f.phase = "eat";
    t.until = now + Math.ceil((eatAt - now + EAT_FADE + 200) / TICK_MS) * TICK_MS;
    return true;
  }
  if (f.phase === "eat") {
    if (now < t.until) return false;
    const here = at(t, now), y = here.y + 10;
    sea.bubbles.push({ id: sea.nextBubble++, x: here.x + (t.facing === "r" ? TW - 4 : 0), y, size: 6, phase: "new", t0: now, ms: Math.round((y + 12) / 10 * 1000) });
    f.phase = "after";
    t.until = now + AFTER_MEAL;
    return true;
  }
  if (now < t.until) return false;
  endFeed(t, now, home);
  return true;
}

// The flakes themselves: they land, lose their owner when its turtle can't eat them any more, fade when nobody came, and go.
function tendFood(sea, now) {
  let changed = false;
  for (const p of sea.food) {
    if (p.phase === "new" && now >= p.born + 2000) {
      p.phase = "fall";
      p.t0 = now;
      changed = true;
    }
    if (p.phase === "fall" && now >= p.t0 + p.ms) {
      p.phase = "sand";
      p.landedAt = now;
      changed = true;
    }
    if (p.owner && !p.fade && !sea.turtles.get(p.owner)?.feed?.ids.includes(p.id)) {
      p.owner = null;
      changed = true;
    }
    if (p.phase === "sand" && !p.owner && !p.fade && now >= p.landedAt + SAND_LIFE) {
      p.fade = { delay: 0, ms: SAND_FADE };
      p.removeAt = now + SAND_FADE + 500;
      changed = true;
    }
  }
  const kept = sea.food.filter((p) => !p.removeAt || now < p.removeAt);
  if (kept.length !== sea.food.length) {
    sea.food = kept;
    changed = true;
  }
  return changed;
}

// A still tank (the demo): each one is where it was put, and swims back there after a detour.
function tendHome(t, home, now) {
  if (t.mode === "home" && now < t.until) return false;
  if (t.mode === "pinned" && !t.ms && t.x === home.x && t.y === home.y && t.facing === home.facing) return false;
  Object.assign(t, { x: home.x, y: home.y, fx: home.x, fy: home.y, ms: 0, facing: home.facing, mode: "pinned", until: 0 });
  return true;
}

// One bubble is drawn first, unseen, on the sand; the next step lets it go and it rises with the app's own transition.
function tendBubbles(sea, d, now, rand, fast, heads, still) {
  let changed = false;
  for (const b of sea.bubbles) {
    // One made earlier in this very step (a turtle that has eaten) waits a step too, or it would never be drawn at its start.
    if (b.phase === "new" && b.t0 < now) {
      b.phase = "up";
      b.y = -12;
      b.t0 = now;
      changed = true;
    }
  }
  const kept = sea.bubbles.filter((b) => b.phase !== "up" || now < b.t0 + b.ms);
  if (kept.length !== sea.bubbles.length) changed = true;
  sea.bubbles = kept;
  if (!still && sea.bubbles.length < 5) {
    const chance = fast ? 0.12 : 0.45;
    const fromHead = heads.length && rand() < 0.5;
    if (rand() < chance) {
      const head = fromHead ? heads[Math.floor(rand() * heads.length)] : null;
      const x = head ? head.x : EDGE + rand() * (d.width - 2 * EDGE);
      const y = head ? head.y : d.sandTop - 4;
      const size = rand() < 0.5 ? 6 : 10;
      sea.bubbles.push({ id: sea.nextBubble++, x, y, size, phase: "new", t0: now, ms: Math.round((y + 12) / (9 + rand() * 5) * 1000) });
      changed = true;
    }
  }
  return changed;
}

// The whole tank, one step on. `agents` is the top-level list with each one's family status; `kidsOf` maps an address to its
// live sub-agents. Says if there's anything new to draw. `pinned` (the demo) maps each address to where it stays and which way it
// faces: those only leave it to feed.
export function step(sea, list, kidsOf, sinceOf, d, now, rand, fast, pinned = null) {
  let changed = false;
  const seen = new Set(list.map((a) => a.address));
  for (const a of list) {
    if (sea.turtles.has(a.address)) continue;
    const t = newTurtle(sea, a.address, d, now, rand), home = pinned?.get(a.address);
    if (home) Object.assign(t, { x: home.x, y: home.y, fx: home.x, fy: home.y, facing: home.facing, mode: "pinned" });
    sea.turtles.set(a.address, t);
    changed = true;
  }
  for (const address of [...sea.turtles.keys()]) {
    if (seen.has(address)) continue;
    sea.turtles.delete(address);
    changed = true;
  }

  for (const a of list) {
    const t = sea.turtles.get(a.address);
    const shark = sea.sharks.get(a.address);
    if (t.feed && a.family !== "working" && a.family !== "done") {
      quitFeed(t, now);
      changed = true;
    }
    if (pinned) {
      if (t.feed) changed = tendFeed(sea, t, now, pinned.get(a.address)) || changed;
      if (!t.feed) changed = tendHome(t, pinned.get(a.address), now) || changed;
      continue;
    }
    if (a.family === "blocked") {
      if (!shark) {
        // Drawn once past the edge before it sets off, or it would simply appear in the tank.
        const s = newShark(t, d, now, sinceOf(a.address));
        sea.sharks.set(a.address, s);
        tendBlocked(t, s, now);
        changed = true;
        continue;
      }
      changed = tendBlocked(t, shark, now) || changed;
      changed = tendShark(shark, t, d, now) || changed;
      continue;
    }
    if (shark && !shark.leaving) {
      swimOff(shark, d, now);
      changed = true;
    }
    if (t.feed) {
      changed = tendFeed(sea, t, now, null) || changed;
      if (t.feed) continue;
    }
    if (a.family === "working") changed = tendWorking(t, d, now, rand) || changed;
    else if (a.family === "done") changed = tendDone(t, d, now) || changed;
    else changed = tendIdle(sea, t, d, now, rand) || changed;
  }

  for (const [address, s] of sea.sharks) {
    if (s.leaving && now >= s.doneAt) {
      sea.sharks.delete(address);
      changed = true;
    } else if (!s.leaving && !seen.has(address)) {
      swimOff(s, d, now);
      changed = true;
    }
  }

  const kidSeen = new Set();
  for (const a of list) {
    const t = sea.turtles.get(a.address);
    (kidsOf.get(a.address) ?? []).slice(0, MAX_KIDS).forEach((kid, index) => {
      kidSeen.add(kid.address);
      let k = sea.kids.get(kid.address);
      const fresh = !k;
      if (!k) {
        const here = at(t, now);
        k = { address: kid.address, parent: a.address, index, x: here.x, y: here.y + TH - KH, fx: here.x, fy: here.y + TH - KH, t0: now, ms: 0, facing: t.facing };
        sea.kids.set(kid.address, k);
        changed = true;
      }
      k.index = index;
      changed = follow(k, t, d, now) || changed;
      if (fresh && pinned) {
        k.fx = k.x;
        k.fy = k.y;
        k.ms = 0;
      }
    });
  }
  for (const address of [...sea.kids.keys()]) {
    if (kidSeen.has(address)) continue;
    sea.kids.delete(address);
    changed = true;
  }

  const heads = list.filter((a) => a.family === "working").map((a) => {
    const t = sea.turtles.get(a.address), p = at(t, now);
    return { x: p.x + (t.facing === "r" ? TW - 4 : 0), y: p.y + 6 };
  });
  changed = tendFood(sea, now) || changed;
  changed = tendBubbles(sea, d, now, rand, fast, heads, Boolean(pinned)) || changed;
  return changed;
}

// Is anything in the tank going to change by itself soon? When not, the tick slows down. `still` (the demo): agents' states don't
// count, only a feeding does. Flakes lying on the sand, waiting to fade, can wait for a slow tick.
export const busy = (sea, list, now, still = false) =>
  (!still && (list.some((a) => a.family === "working" || a.family === "blocked") || sea.sharks.size > 0)) ||
  sea.food.some((p) => p.phase !== "sand" || p.fade) ||
  [...sea.turtles.values()].some((t) => t.feed || inMotion(t, now) || ["sink", "rise", "scoot", "home"].includes(t.mode));
