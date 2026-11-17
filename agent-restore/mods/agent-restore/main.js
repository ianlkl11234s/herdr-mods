// agent-restore: after a reboot, Herdr's terminals come back as fresh shells at the same address.
// This mod remembers which Claude agent ran in each one and types `claude --resume <id>` back in.
// Two copies, by props: {"role":"bar"} records and resumes; {"role":"panel"} is the list.
// Both take {"lang": "en" | "zh-TW"}; the bar takes {"accountLabels": {".claude": "work", ...}}.
import { View } from "gpui-kit";
import { props } from "herdr";
import { Bar } from "./bar.js";
import { Panel } from "./panel.js";

export default class AgentRestore extends View {
  init(p, cx) {
    const o = p ?? props() ?? {};
    this.part = o.role === "panel" ? new Panel() : new Bar();
    this.part.init(cx, o);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
