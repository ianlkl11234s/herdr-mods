// role "panel": the list of agents to resume, in the right-hand panel beside Files and Changes.
// It only reads snapshot.json; resuming and skipping go to the bar copy as commands.
import { div } from "gpui-kit";
import { h_flex, v_flex, Scrollbar } from "gpui-base";
import { theme, run, shared, readTextFile, appHome, checking, settings } from "herdr";
import * as C from "./core.js";
import { strings } from "./strings.js";

const KEY = "agent-restore";
const keyOf = (e) => `${e.address}|${e.sessionId}`;

export class Panel {
  init(cx, p) {
    this.T = strings(p?.lang);
    this.entries = [];
    this.groups = null;
    this.checked = new Set();
    this.known = new Set();
    this.expanded = new Set();
    this.copied = null;
    this.rev = undefined;
    if (checking()) return;
    this.load(cx);
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const snap = await C.readSnapshot();
      let groups = null;
      try {
        groups = JSON.parse((await readTextFile(`${appHome()}/space-groups.json`)) ?? "null");
      } catch {}
      this.groups = groups;
      this.entries = Object.values(snap.entries).filter((e) => e.state === "resumable");
      const keys = new Set(this.entries.map(keyOf));
      for (const e of this.entries) {
        const k = keyOf(e);
        // Checked by default once its terminal is there: active in the last 24 hours.
        if (this.known.has(k) || e.gone) continue;
        this.known.add(k);
        if (e.lastActivity && Date.now() - e.lastActivity < C.DAY) this.checked.add(k);
      }
      for (const k of [...this.checked]) if (!keys.has(k)) this.checked.delete(k);
      cx.notify();
    });
  }

  // Grouped like the sidebar (space-groups.json); a space in no group is its own group.
  grouped() {
    const defs = Array.isArray(this.groups?.groups) ? this.groups.groups : [];
    const out = [];
    const at = new Map();
    const add = (name, order, e) => {
      if (!at.has(name)) {
        const g = { name, order, rows: [] };
        at.set(name, g);
        out.push(g);
      }
      at.get(name).rows.push(e);
    };
    for (const e of this.entries) {
      const i = defs.findIndex((g) => Array.isArray(g.spaces) && g.spaces.includes(e.space));
      if (i >= 0) add(String(defs[i].name), i, e);
      else add(e.spaceName || this.T.unnamedSpace, defs.length, e);
    }
    out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    for (const g of out) g.rows.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
    return out;
  }

  copy(text, k, cx) {
    cx.spawn(async (cx) => {
      await C.copyText(text);
      this.copied = k;
      cx.notify();
      await cx.sleep(1500);
      if (this.copied === k) this.copied = null;
      cx.notify();
    });
  }

  button(id, label, t, { primary = false, enabled = true, onClick }) {
    return div().id(id).h(28).px(primary ? 12 : 10).flex().items_center().rounded(7).text_size(12)
      .when(primary, (e) => e.bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim))
      .when(!primary, (e) => e.border_1().border_color(t.border).text_color(enabled ? t.foreground : t.dim))
      .when(enabled, (e) => e.cursor_pointer().hover((s) => (primary ? s.opacity(0.9) : s.bg(t.hover))).on_click((_e, cx) => onClick(cx)))
      .child(label);
  }

  row(e, t, prog) {
    const k = keyOf(e);
    const busy = prog?.state === "queued" || prog?.state === "resuming";
    const can = !busy; // a row whose tab is gone can still be checked, to skip it
    const on = can && this.checked.has(k);
    const open = this.expanded.has(k);
    const notes = [];
    const T = this.T;
    if (e.gone) notes.push(T.noteGone);
    if (e.status === "working") notes.push(T.noteWorking);
    if (e.status === "blocked") notes.push(T.noteBlocked);
    if (prog?.state === "failed") notes.push(T.noteFailed(prog.note));
    const tag = prog?.state === "queued" ? T.tagQueued : prog?.state === "resuming" ? T.tagResuming : prog?.state === "failed" ? T.tagFailed : null;
    const cmd = C.commandLine(e);
    const mono = settings().font_family ?? "JetBrains Mono";
    const box = div().size(14).flex_none().mt(2).rounded(3).border_1().flex().items_center().justify_center().text_size(10)
      .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background).text_color(t.accent_foreground).child(on ? "✓" : "");
    const line = (label, text) => v_flex().gap(2)
      .child(div().text_size(10.5).text_color(t.dim).child(label))
      .child(div().text_size(11.5).text_color(t.muted).child(text || T.nothingRead));
    return v_flex().id(`row-${k}`).px(8).py(7).gap(5).rounded(7).hover((s) => s.bg(t.hover))
      .child(h_flex().gap(8).items_start()
        .child(div().id(`ck-${k}`).flex_none().when(can, (el) => el.cursor_pointer().on_click((_e, cx) => {
          if (this.checked.has(k)) this.checked.delete(k);
          else this.checked.add(k);
          cx.notify();
        })).child(box))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(6).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(!e.gone && !busy ? t.foreground : t.muted).child(e.title || T.noTitle))
            .when(Boolean(tag), (el) => el.child(div().flex_none().text_size(10.5).text_color(prog.state === "failed" ? t.ansi3 : t.muted).child(tag))))
          .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
            .child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(e.account || "?"))
            .child(div().flex_1().min_w(0).truncate().child(`${e.spaceName || "?"} › ${e.tabName || "?"}`))
            .child(div().flex_none().child(C.ago(e.lastActivity, T))))
          .children(notes.map((n) => div().text_size(11).text_color(t.ansi3).child(n)))
          .child(div().id(`more-${k}`).text_size(10.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => {
              if (open) this.expanded.delete(k);
              else this.expanded.add(k);
              cx.notify();
            }).child(open ? T.less : T.details))
          .when(open, (el) => el.child(v_flex().gap(6).p(8).rounded(6).bg(t.surface).border_1().border_color(t.border)
            .child(line(T.youSaid, e.you))
            .child(line(T.agentSaid, e.agent))
            .child(v_flex().gap(3)
              .child(h_flex().items_center().justify_between()
                .child(div().text_size(10.5).text_color(t.dim).child(T.resumeCommand))
                .child(div().id(`copy-${k}`).px(6).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).cursor_pointer()
                  .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.copy(cmd, k, cx)).child(this.copied === k ? T.copied : T.copy)))
              .child(div().font_family(mono).text_size(10.5).text_color(t.foreground).child(cmd)))))));
  }

  state() {
    return shared(KEY) ?? {};
  }

  render(cx) {
    const st = this.state();
    if (st.rev !== this.rev && !checking()) {
      this.rev = st.rev;
      this.load(cx);
    }
    const t = theme();
    const progress = st.progress ?? {};
    const busy = Object.values(progress).some((p) => p.state === "queued" || p.state === "resuming");
    const done = Object.values(progress).filter((p) => p.state === "done").length;
    const picked = this.entries.filter((e) => !e.gone && this.checked.has(keyOf(e)));
    const n = this.entries.length;
    const groups = this.grouped();
    const T = this.T;
    return v_flex().id("agent-restore-panel").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(T.title))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${n}`))
        .child(div().flex_1())
        .child(div().id("restore-close").px(6).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => run("layout.hide", { id: "panel" })).child("×")))
      .child(v_flex().flex_none().px(14).py(8).gap(3).border_b(1).border_color(t.border).text_size(11.5).text_color(t.muted)
        .child(div().child(n ? T.interrupted(n) : T.nothing))
        .when(n > 0, (el) => el.child(div().text_color(t.dim).child(T.hint)))
        .when(done > 0, (el) => el.child(div().text_color(t.muted).child(T.resumedCount(done)))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("restore-list").absolute().inset_0().overflow_y_scroll().p(6).gap(2)
          .children(groups.flatMap((g) => [
            div().px(8).pt(8).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(g.name),
            ...g.rows.map((e) => this.row(e, t, progress[e.address])),
          ])))
        .child(Scrollbar.vertical("restore-list").absolute().inset_0()))
      .child(h_flex().flex_none().p(10).gap(6).border_t(1).border_color(t.border)
        .child(this.button("restore-go", busy ? T.resumingButton : T.resumeButton(picked.length), t, {
          primary: true,
          enabled: picked.length > 0 && !busy,
          onClick: () => run(`agent-restore.resume:${picked.map((e) => e.address).join(",")}`),
        }))
        .child(this.button("restore-all", T.selectAll, t, {
          enabled: n > 0,
          onClick: (cx) => {
            for (const e of this.entries) if (!(progress[e.address]?.state in { queued: 1, resuming: 1 })) this.checked.add(keyOf(e));
            cx.notify();
          },
        }))
        .child(this.button("restore-none", T.clear, t, {
          enabled: this.checked.size > 0,
          onClick: (cx) => {
            this.checked.clear();
            cx.notify();
          },
        }))
        .child(div().flex_1())
        .child(this.button("restore-skip", T.skip, t, {
          enabled: this.checked.size > 0 && !busy,
          onClick: (cx) => {
            const list = this.entries.filter((e) => this.checked.has(keyOf(e))).map((e) => e.address);
            for (const e of this.entries) this.checked.delete(keyOf(e));
            run(`agent-restore.skip:${list.join(",")}`);
            cx.notify();
          },
        })));
  }
}
