// Passers-by: now and then a school of small fish crosses the tank, and, rarer, a shark far off in the dark. Neither is an agent:
// they can't be clicked and have no tooltip. At most one party is in the tank at a time. No drawing here (main.js draws it) and no
// stepping: a party is drawn once at its start, then handed one long native `.transition` to the far side; the tick only notices
// when it's due and when it's over.

// How often, on average. Each wait is a random one between half and one and a half of this.
export const FISH_EVERY_MS = 4 * 60000;
export const SHARK_EVERY_MS = 12.5 * 60000;
// The far shark's own opacity (0.35 to 0.5 reads as "far off, in the dark"); main.js draws it with this.
export const FAR_OPACITY = 0.42;

export const FISH_W = 12, FISH_H = 8, FAR_W = 44, FAR_H = 20;
const SCHOOL_SPEED = 30, FAR_SPEED = 16;
const RETRY_MS = 60000, GAP_MS = 30000, FADE_MS = 2000;

const wait = (mean, rand) => Math.round(mean * (0.5 + rand()));

export const newVisits = (now, rand) => ({ group: null, nextId: 0, nextFish: now + wait(FISH_EVERY_MS, rand), nextShark: now + wait(SHARK_EVERY_MS, rand) });

// A school: 5 to 9 of one kind, strung out a little along the way they swim, each a touch different in speed and depth.
function school(d, rand) {
  const way = rand() < 0.5 ? 1 : -1, kind = 1 + Math.floor(rand() * 2), count = 5 + Math.floor(rand() * 5);
  const lo = 24, hi = Math.max(lo + 8, d.sandTop - 36), base = lo + rand() * (hi - lo);
  const items = Array.from({ length: count }, (_, i) => {
    const behind = rand() * 110;
    const x0 = way > 0 ? -FISH_W - 10 - behind : d.width + 10 + behind;
    const x1 = way > 0 ? d.width + 10 : -FISH_W - 10;
    const y = Math.round(Math.min(d.sandTop - FISH_H - 14, Math.max(14, base + (rand() - 0.5) * 24)));
    return { i, kind, x0, x1, y, facing: way > 0 ? "r" : "l", ms: Math.round(Math.abs(x1 - x0) / (SCHOOL_SPEED * (0.92 + rand() * 0.16)) * 1000), period: 1500 + Math.round(rand() * 1500) };
  });
  return { kind: "fish", items, ms: Math.max(...items.map((f) => f.ms)) };
}

// A shark at one height in the upper half of the water, crossing slowly; it doesn't stop and doesn't come near anyone.
function farShark(d, rand) {
  const way = rand() < 0.5 ? 1 : -1, x0 = way > 0 ? -FAR_W - 10 : d.width + 10, x1 = way > 0 ? d.width + 10 : -FAR_W - 10;
  const lo = 16, hi = Math.max(lo, Math.round(d.sandTop * 0.5 - FAR_H + 8));
  const item = { i: 0, x0, x1, y: Math.round(lo + rand() * (hi - lo)), facing: way > 0 ? "r" : "l", ms: Math.round(Math.abs(x1 - x0) / FAR_SPEED * 1000) };
  return { kind: "shark", items: [item], ms: item.ms };
}

// Starts a party now unless one is still in the tank. `auto` is the schedule's own; a test command (`auto` false) comes even when a
// reminder shark is on screen, which the schedule never does. Says the party, or null.
export function launch(v, kind, d, now, rand, auto) {
  if (v.group && now < v.group.endAt) return null;
  const made = kind === "shark" ? farShark(d, rand) : school(d, rand);
  const group = { id: v.nextId++, kind: made.kind, items: made.items, auto, phase: "new", born: now, fading: false, endAt: now + made.ms + 1500 };
  v.group = group;
  // The schedule starts its next wait from here; a test command leaves it alone. Neither kind comes while this one is in the tank.
  if (auto && kind === "shark") v.nextShark = now + wait(SHARK_EVERY_MS, rand);
  if (auto && kind !== "shark") v.nextFish = now + wait(FISH_EVERY_MS, rand);
  v.nextFish = Math.max(v.nextFish, group.endAt + GAP_MS);
  v.nextShark = Math.max(v.nextShark, group.endAt + GAP_MS);
  return group;
}

// Lets go of a party's start (it was drawn first at the edge), clears one that's over, and, on the schedule, sends the next.
// `auto` is whether the schedule runs at all (not in the demo); `alert` whether a shark is waiting on someone in the tank, in
// which case no far shark comes, and one already crossing fades out. Says whether anything changed and the party that just began.
export function tendVisits(v, d, now, rand, auto, alert) {
  const g = v.group;
  if (g) {
    let changed = false;
    if (g.phase === "new" && now >= g.born + 2000) {
      g.phase = "go";
      changed = true;
    }
    if (g.kind === "shark" && g.auto && alert && !g.fading) {
      g.fading = true;
      g.endAt = Math.min(g.endAt, now + FADE_MS + 500);
      changed = true;
    }
    if (now >= g.endAt) {
      v.group = null;
      changed = true;
    }
    return { changed, started: null };
  }
  if (!auto) return { changed: false, started: null };
  if (now >= v.nextShark) {
    if (alert) v.nextShark = now + RETRY_MS;
    else {
      const started = launch(v, "shark", d, now, rand, true);
      if (started) return { changed: true, started };
    }
  }
  if (now >= v.nextFish) {
    const started = launch(v, "fish", d, now, rand, true);
    if (started) return { changed: true, started };
  }
  return { changed: false, started: null };
}
