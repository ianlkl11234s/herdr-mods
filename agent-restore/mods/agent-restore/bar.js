// role "bar": the recorder, the judge of what can be resumed, the resume queue, and a one-line notice.
// It is the only copy that writes snapshot.json or types into a terminal; the panel sends it commands.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, agents, spaces, run, setShared, nextCommand, checking, hc } from "herdr";
import * as C from "./core.js";
import { strings } from "./strings.js";

const KEY = "agent-restore";
const NODE = "restore-bar";
const HEIGHT = 26;
const EVERY = 30_000;
const EXIT_GRACE = 25_000; // a claude that ended in its own shell is forgotten only on a later round
const GAP = 3_000;         // between two resumes
const CONFIRM = 10_000;    // to see claude in the foreground after typing the command

export class Bar {
  init(cx, p) {
    this.T = strings(p?.lang);
    this.labels = p?.accountLabels ?? null;
    this.snap = { version: 1, entries: {} };
    this.ready = false;
    this.boot = null;
    this.height = null;
    this.sig = null;
    this.pubSig = null;
    this.rev = 0;
    this.ticking = false;
    this.again = false;
    this.queue = [];
    this.running = false;
    this.inflight = new Set();
    this.progress = {};
    if (checking()) return;
    cx.spawn(async (cx) => {
      this.boot = await C.bootMs();
      this.snap = await C.readSnapshot();
      this.ready = true;
      this.share();
      await this.tick(cx);
    });
    cx.timer.every(EVERY, (cx) => {
      cx.spawn(async (cx) => this.tick(cx));
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try {
          await this.command(String(c ?? ""), cx);
        } catch (e) {
          console.log(`agent-restore: ${c}: ${e}`);
        }
      }
    });
  }

  async command(c, cx) {
    const i = c.indexOf(":");
    const name = i < 0 ? c : c.slice(0, i);
    const arg = i < 0 ? "" : c.slice(i + 1);
    const list = arg.split(",").map((s) => s.trim()).filter(Boolean);
    if (name === "open") this.openPanel();
    else if (name === "status") await this.status();
    else if (name === "refresh") await this.tick(cx);
    else if (name === "resume") this.enqueue(list, cx);
    else if (name === "skip") await this.skip(list, cx);
  }

  resumables() {
    return Object.values(this.snap.entries).filter((e) => e.state === "resumable");
  }

  share() {
    setShared(KEY, { n: this.resumables().length, rev: this.rev, progress: this.progress });
  }

  openPanel() {
    run("layout.select", { stack: "panel-body", child: "restore" });
    run("layout.show", { id: "panel" });
  }

  async tick(cx) {
    if (!this.ready) return;
    if (this.ticking) {
      this.again = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.again = false;
        await this.record(cx);
      } while (this.again);
    } catch (e) {
      console.log(`agent-restore: record: ${e}`);
    } finally {
      this.ticking = false;
    }
  }

  names() {
    const m = new Map();
    for (const sp of spaces()) if (!sp.machine) m.set(sp.id, { name: sp.name, tabs: new Map(sp.tabs.map((t) => [t.id, t.name])) });
    return m;
  }

  // One round: snapshot every live Claude agent, then judge the entries whose claude is gone.
  async record(cx) {
    const list = await C.hcList();
    if (!list) return; // core not answering: change nothing
    const dirs = await C.configDirs();
    const now = Date.now();
    const E = this.snap.entries;
    const names = this.names();
    const asked = new Set();
    const liveSessions = new Set();
    for (const t of list) {
      if (!C.local(t.address) || t.state !== "live") continue;
      const old = E[t.address];
      if (t.agent !== "claude-code" && !old) continue;
      const r = await C.hcGet(t.address);
      if (!r.ok || !r.g) continue;
      asked.add(t.address);
      const g = r.g, f = C.claudeFg(g);
      if (!f) {
        if (old) this.judge(old, g, now);
        continue;
      }
      // Only Herdr's own kept terminals: the ones that come back after a reboot.
      if (!g.keep || !g.labels?.["herdr.space"] || !g.labels?.["herdr.tab"] || !C.resumable(f.argv)) {
        delete E[t.address];
        continue;
      }
      const s = await C.sessionOf(dirs, f.pid);
      if (!s) continue; // claude still starting: next round
      liveSessions.add(s.sessionId);
      E[t.address] = await this.entry(g, f, s, old, names, now);
    }
    for (const a of Object.keys(E)) {
      if (asked.has(a)) continue;
      const e = E[a], r = await C.hcGet(a);
      if (!r.ok) continue;
      if (r.g && r.g.state === "live" && r.g.created_ms === e.createdMs) {
        this.judge(e, r.g, now);
        continue;
      }
      // Its terminal is gone. Lost in a reboot (or already waiting): keep it, marked; otherwise the tab was closed.
      if (e.state === "resumable" || (this.boot && e.ts < this.boot)) {
        e.state = "resumable";
        e.gone = true;
        e.lostAt = e.lostAt ?? now;
      } else delete E[a];
    }
    // Resumed by hand somewhere else: nothing waits any more.
    for (const [a, e] of Object.entries(E)) if (e.state === "resumable" && liveSessions.has(e.sessionId)) delete E[a];
    this.snap = { version: 1, updated: now, boot: this.boot, entries: E };
    await C.writeSnapshot(this.snap);
    this.publish(cx);
  }

  // A snapshot entry whose terminal is alive but runs no claude now.
  judge(e, g, now) {
    if (!g.foreground || g.state !== "live") return; // between loss and the new shell
    e.gone = false;
    if (e.state === "resumable") return;
    // The root process changed: herdr-core lost the terminal and gave it a new shell (same address).
    // Or the snapshot is older than this boot: nothing it saw can still run.
    if (g.pid !== e.rootPid || (this.boot && e.ts < this.boot)) {
      e.state = "resumable";
      e.lostAt = now;
      e.exitAt = null;
      return;
    }
    // Same shell, claude gone: the person ended it. Forget it on a later round.
    if (!e.exitAt) e.exitAt = now;
    else if (now - e.exitAt >= EXIT_GRACE) delete this.snap.entries[e.address];
  }

  async entry(g, f, s, old, names, now) {
    const same = old && old.sessionId === s.sessionId ? old : null;
    const spaceId = g.labels["herdr.space"], tabId = g.labels["herdr.tab"];
    const sp = names.get(spaceId);
    const status = g.status?.state ?? null;
    const title = s.name || g.title || "";
    let you = same?.you ?? null, reply = same?.agent ?? null, tries = same?.turnTries ?? 0;
    // The transcript is read only when the status or title changed, never every round
    // (plus up to 3 later rounds while a side is missing: Claude may not have written it yet).
    const changed = !same || same.status !== status || same.title !== title;
    if (changed || ((you === null || reply === null) && tries < 3)) {
      tries = changed ? 0 : tries + 1;
      const turns = await C.lastTurns(s.dir, s.cwd || f.cwd, s.sessionId).catch(() => null);
      if (turns) {
        you = turns.you ?? you;
        reply = turns.agent ?? reply;
      }
    }
    return {
      address: g.address,
      space: spaceId,
      spaceName: sp?.name ?? old?.spaceName ?? "",
      tab: tabId,
      tabName: sp?.tabs.get(tabId) ?? old?.tabName ?? "",
      configDir: s.dir,
      account: C.account(s.dir, this.labels),
      cwd: s.cwd || f.cwd || g.cwd,
      argv: f.argv ?? ["claude"],
      sessionId: s.sessionId,
      title,
      status,
      lastActivity: g.status_ms ?? s.updatedAt ?? same?.lastActivity ?? null,
      ts: now,
      you,
      agent: reply,
      turnTries: tries,
      rootPid: g.pid,
      createdMs: g.created_ms,
      claudePid: f.pid,
      state: "live",
      exitAt: null,
      lostAt: null,
      gone: false,
    };
  }

  publish(cx) {
    const R = this.resumables();
    const sig = R.map((e) => `${e.address}|${e.sessionId}|${e.gone ? 1 : 0}`).sort().join(",");
    if (sig !== this.pubSig) {
      this.pubSig = sig;
      this.rev = Date.now();
      this.share();
    }
    const px = R.length ? HEIGHT : 0;
    if (px !== this.height) {
      this.height = px;
      run("layout.resize", { id: NODE, px });
    }
    // Once per app run: the first time something can be resumed, open the list.
    if (R.length && !globalThis.__agentRestoreOpened) {
      globalThis.__agentRestoreOpened = true;
      this.openPanel();
    }
    cx.notify();
  }

  async skip(addresses, cx) {
    for (const a of addresses) if (this.snap.entries[a]?.state === "resumable" && !this.queue.includes(a)) {
      delete this.snap.entries[a];
      delete this.progress[a];
    }
    await C.writeSnapshot(this.snap);
    this.publish(cx);
    this.share();
  }

  enqueue(addresses, cx) {
    for (const a of addresses) {
      const e = this.snap.entries[a];
      if (!e || e.state !== "resumable") {
        this.progress[a] = { state: "failed", note: this.T.failNotListed };
        continue;
      }
      const p = this.progress[a]?.state;
      if (this.queue.includes(a) || p === "resuming") continue;
      this.queue.push(a);
      this.progress[a] = { state: "queued" };
    }
    this.share();
    if (!this.running) cx.spawn(async (cx) => this.drain(cx));
  }

  // One at a time, GAP apart.
  async drain(cx) {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const a = this.queue.shift();
        try {
          await this.resumeOne(a, cx);
        } catch (e) {
          this.progress[a] = { state: "failed", note: String(e) };
        }
        this.share();
        cx.notify();
        if (this.queue.length) await cx.sleep(GAP);
      }
    } finally {
      this.running = false;
    }
    await this.tick(cx);
  }

  async resumeOne(a, cx) {
    const e = this.snap.entries[a];
    const fail = (note) => {
      this.progress[a] = { state: "failed", note };
    };
    if (!e || e.state !== "resumable") return fail(this.T.failNotListed);
    if (e.gone) return fail(this.T.failGone);
    if (this.inflight.has(e.sessionId)) return fail(this.T.failSameSession);
    this.inflight.add(e.sessionId);
    this.progress[a] = { state: "resuming" };
    this.share();
    try {
      if (await C.sessionRunning(await C.configDirs(), e.sessionId)) return fail(this.T.failElsewhere);
      const r = await C.hcGet(a);
      if (!r.ok) return fail(this.T.failNoState);
      if (!r.g || r.g.state !== "live") return fail(this.T.failNoTerminal);
      if (!C.idleShell(r.g)) return fail(this.T.failBusy);
      const sent = await hc(["send", a, C.commandLine(e)]).catch(() => null);
      if (!sent || sent.code !== 0) return fail(this.T.failNotSent);
      for (let waited = 0; waited < CONFIRM; waited += 500) {
        await cx.sleep(500);
        const q = await C.hcGet(a);
        const f = q.ok ? C.claudeFg(q.g) : null;
        if (!f) continue;
        // Re-take this entry at once: a later /exit must be compared with the new shell.
        Object.assign(e, { state: "live", rootPid: q.g.pid, createdMs: q.g.created_ms, claudePid: f.pid, ts: Date.now(), exitAt: null, lostAt: null, gone: false });
        this.progress[a] = { state: "done", at: Date.now() };
        await C.writeSnapshot(this.snap).catch(() => null);
        this.publish(cx);
        return;
      }
      return fail(this.T.failNoStart);
    } finally {
      this.inflight.delete(e.sessionId);
    }
  }

  // A summary without titles, folders or conversation: counts, states, option names.
  async status() {
    const now = Date.now();
    const E = Object.values(this.snap.entries);
    const count = (k) => E.reduce((m, e) => ((m[e[k]] = (m[e[k]] ?? 0) + 1), m), {});
    const summary = {
      at: new Date(now).toISOString(),
      boot: this.boot ? new Date(this.boot).toISOString() : null,
      total: E.length,
      state: count("state"),
      account: count("account"),
      resumable: this.resumables().map((e) => e.address),
      queue: [...this.queue],
      progress: this.progress,
      entries: E.map((e) => ({
        address: e.address,
        account: e.account,
        state: e.state,
        status: e.status,
        gone: !!e.gone,
        session: !!e.sessionId,
        flags: C.flagNames(e.argv),
        argc: e.argv?.length ?? 0,
        snapshot_age_s: Math.round((now - e.ts) / 1000),
        has_you: !!e.you,
        has_agent: !!e.agent,
        exit_pending: !!e.exitAt,
      })),
    };
    setShared(`${KEY}.status`, summary);
    console.log(`agent-restore status: ${JSON.stringify(summary)}`);
  }

  render(cx) {
    // An agent changed state: take a snapshot now, not only every 30 seconds.
    const sig = agents().map((a) => `${a.address}:${a.status}`).join("|");
    if (sig !== this.sig) {
      const first = this.sig === null;
      this.sig = sig;
      if (this.ready && !first) cx.spawn(async (cx) => this.tick(cx));
    }
    const n = this.ready ? this.resumables().length : 0;
    if (!n) return div().id("agent-restore-bar").size_full();
    const t = theme();
    return h_flex().id("agent-restore-bar").size_full().px(14).gap(8).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.8).cursor_pointer().on_click(() => this.openPanel())
      .child(div().size(6).rounded(3).bg(t.ansi3))
      .child(div().text_color(t.ansi3).child(this.T.barCount(n)))
      .child(div().text_color(t.dim).child("·"))
      .child(div().id("agent-restore-open").text_color(t.ansi3).hover((s) => s.text_color(t.foreground)).child(this.T.barOpen));
  }
}
