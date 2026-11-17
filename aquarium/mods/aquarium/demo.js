// A fixed tank with one of every state, for `aquarium.demo`. Nothing here is a real agent and clicks do nothing.
import { EDGE, KH, SW, SH, TH, TW, sharkGap } from "./sea.js";

export function demoScene(d) {
  const span = Math.max(0, d.width - TW - 2 * EDGE), x = (f) => EDGE + f * span;
  const mid = Math.round((d.swimTop + d.swimBottom) / 2);
  const sharkX = d.width - SW - EDGE, gap = sharkGap(180000);
  const blockedX = sharkX - gap - TW;
  const turtles = [
    { key: "d1", space: "api", tab: "fix login", shell: "ansi6", status: "working", x: x(0.05), y: d.swimTop + 2, facing: "r", minutes: 12 },
    { key: "d3", space: "docs", tab: "2", shell: "ansi5", status: "idle", x: x(0.2), y: d.rest, facing: "r" },
    { key: "d4", space: "data", tab: "report", shell: "ansi2", status: "done", x: x(0.34), y: d.surface, facing: "r" },
    { key: "d2", space: "web", tab: "refactor", shell: "ansi4", status: "working", x: Math.min(x(0.5), blockedX - 2 * TW), y: d.swimBottom, facing: "l", minutes: 3 },
    { key: "d5", space: "infra", tab: "deploy", shell: "ansi3", status: "blocked", x: blockedX, y: mid, facing: "r", minutes: 3 },
  ];
  const parent = turtles.find((t) => t.key === "d2");
  const kids = [{ key: "d2k", parent: "d2", space: "web", shell: "ansi4", status: "working", x: parent.x + TW + 2, y: parent.y + TH - KH + 1, facing: "l" }];
  const blocked = turtles.find((t) => t.key === "d5");
  const sharks = [{ key: "d5", x: sharkX, y: blocked.y + TH / 2 - SH / 2, facing: "l", minutes: 3, space: "infra" }];
  return { turtles, kids, sharks };
}
