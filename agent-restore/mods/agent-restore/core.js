// What a Claude agent's terminal looks like, where its session lives, and how to start it again.
// Only reads: hc get/ls, ~/.claude*/sessions/<pid>.json (never *.key), the tail of a transcript.
import { hc, exec, home, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";

export const dataDir = () => `${appHome()}/data/agent-restore`;
export const snapPath = () => `${dataDir()}/snapshot.json`;
export const DAY = 24 * 3600_000;

// Parts of this file (SHELLS, base(), local(), some hc ls/get calls and the terminal checks) are adapted from
// VladTemp27/herdr-mods (hibernate/core.js), Apache-2.0. See NOTICE.
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "xonsh", "pwsh", "login"]);
export const base = (s) => String(s ?? "").split("/").pop().replace(/^-/, "");
export const local = (address) => !String(address).includes("/");

// props.accountLabels[folder name] when given; else ~/.claude → "default", ~/.claude-work → "claude-work".
export function account(dir, labels) {
  const name = base(dir);
  const own = labels && typeof labels === "object" ? labels[name] : null;
  return typeof own === "string" && own ? own : name === ".claude" ? "default" : name.replace(/^\./, "");
}

export async function hcList() {
  const r = await hc(["ls", "--json"]).catch(() => null);
  if (!r || r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout).terminals ?? null;
  } catch {
    return null;
  }
}

// { ok: false }: couldn't ask (core starting, parse error) → change nothing.
// { ok: true, g: null }: hc says not_found → the terminal is gone.
export async function hcGet(address) {
  const r = await hc(["get", "--json", address]).catch(() => null);
  if (!r) return { ok: false };
  if (r.code === 0) {
    try {
      return { ok: true, g: JSON.parse(r.stdout) };
    } catch {
      return { ok: false };
    }
  }
  if (r.code === 3 || /"kind"\s*:\s*"not_found"/.test(`${r.stdout}${r.stderr}`)) return { ok: true, g: null };
  return { ok: false };
}

// The claude process in the foreground, or null.
export function claudeFg(g) {
  const f = g?.foreground;
  if (!f || g.state !== "live") return null;
  return base(f.argv?.[0]) === "claude" ? f : null;
}

// The terminal's own root shell is in the foreground: nothing else runs there.
export function idleShell(g) {
  const f = g?.foreground;
  return !!f && g.state === "live" && f.pid === g.pid && SHELLS.has(base(f.argv?.[0] ?? f.name));
}

// Every ~/.claude* folder that has a sessions/ folder (both accounts, and any later one).
export async function configDirs() {
  const h = home();
  let names = [];
  try {
    names = await fs.readdir(h);
  } catch {}
  const out = [];
  for (const n of names.filter((n) => n === ".claude" || n.startsWith(".claude-")).sort()) {
    if (await fs.exists(`${h}/${n}/sessions`).catch(() => false)) out.push(`${h}/${n}`);
  }
  return out;
}

// sessions/<pid>.json of a running claude: which folder has it says the account.
export async function sessionOf(dirs, pid) {
  for (const dir of dirs) {
    const text = await readTextFile(`${dir}/sessions/${pid}.json`).catch(() => null);
    if (!text) continue;
    try {
      const j = JSON.parse(text);
      if (j.sessionId) return { dir, sessionId: j.sessionId, name: j.name ?? null, cwd: j.cwd ?? null, status: j.status ?? null, updatedAt: j.updatedAt ?? null };
    } catch {}
  }
  return null;
}

// Is this session running right now anywhere (a sessions file whose pid is a live claude)?
export async function sessionRunning(dirs, sessionId) {
  for (const dir of dirs) {
    let names = [];
    try {
      names = (await fs.readdir(`${dir}/sessions`)).filter((n) => /^\d+\.json$/.test(n));
    } catch {}
    for (const n of names) {
      const text = await readTextFile(`${dir}/sessions/${n}`).catch(() => null);
      let j = null;
      try {
        j = JSON.parse(text ?? "null");
      } catch {}
      if (j?.sessionId !== sessionId) continue;
      // A file left behind by a killed claude names a pid that is gone, or reused by another
      // program: alive only if that pid is a claude that started when the file says (UTC).
      const r = await exec("env", ["LC_ALL=C", "TZ=UTC", "ps", "-o", "lstart=,comm=", "-p", n.replace(/\.json$/, "")]).catch(() => null);
      const words = r?.code === 0 ? r.stdout.trim().split(/\s+/) : [];
      if (base(words[words.length - 1]) !== "claude") continue;
      const started = words.slice(0, 5).join(" ");
      if (!j.procStart || String(j.procStart).trim().split(/\s+/).join(" ") === started) return true;
    }
  }
  return false;
}

const clip = (s, n = 400) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// What a person typed: plain text, a message another terminal sent (<hc from=…>…</hc>),
// or a slash command (<command-name>…</command-name>); never tool results or Claude's own notes.
function typed(t) {
  const s = String(t ?? "").trim();
  if (!s) return null;
  if (!s.startsWith("<")) return s;
  const hcMsg = /^<hc\b[^>]*>([\s\S]*?)<\/hc>\s*$/.exec(s);
  if (hcMsg) return hcMsg[1].trim() || null;
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(s);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(s);
    return `${cmd[1].trim()} ${args ? args[1].trim() : ""}`.trim();
  }
  return null;
}

function userText(j) {
  if (j.type === "last-prompt" && typeof j.lastPrompt === "string") return typed(j.lastPrompt);
  if (j.type !== "user" || j.isMeta || j.isSidechain) return null;
  const c = j.message?.content;
  if (typeof c === "string") return typed(c);
  if (Array.isArray(c) && !c.some((x) => x?.type === "tool_result")) return typed(c.filter((x) => x?.type === "text").map((x) => x.text).join(" "));
  return null;
}

function agentText(j) {
  if (j.type !== "assistant" || j.isSidechain) return null;
  const c = j.message?.content;
  if (!Array.isArray(c)) return null;
  const t = c.filter((x) => x?.type === "text").map((x) => x.text).join(" ");
  return t.trim() ? t : null;
}

// <config>/projects/<cwd with every non-alphanumeric character as "-">/<sessionId>.jsonl
export async function transcriptPath(dir, cwd, sessionId) {
  const guess = `${dir}/projects/${String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-")}/${sessionId}.jsonl`;
  if (await fs.exists(guess).catch(() => false)) return guess;
  const r = await exec("sh", ["-c", 'for f in "$1"/projects/*/"$2".jsonl; do [ -f "$f" ] && { printf %s "$f"; exit 0; }; done; exit 1', "sh", dir, sessionId]).catch(() => null);
  return r?.code === 0 && r.stdout ? r.stdout : null;
}

// Your last message and the agent's last reply, from the transcript's tail.
export async function lastTurns(dir, cwd, sessionId) {
  const path = await transcriptPath(dir, cwd, sessionId);
  if (!path) return { you: null, agent: null };
  let you = null, agent = null;
  for (const n of [65536, 524288]) {
    // First line: the file's size in bytes (stdout is characters, not bytes), then its tail.
    const r = await exec("sh", ["-c", 'wc -c < "$1" | tr -d " "; exec tail -c "$2" "$1"', "sh", path, String(n)], { timeout: 10_000 }).catch(() => null);
    if (!r || r.code !== 0) break;
    const nl = r.stdout.indexOf("\n");
    const size = Number(r.stdout.slice(0, nl));
    const whole = size <= n;
    const lines = r.stdout.slice(nl + 1).split("\n");
    if (!whole) lines.shift(); // the first line is cut
    for (let i = lines.length - 1; i >= 0 && (you === null || agent === null); i--) {
      let j;
      try {
        j = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (you === null) you = userText(j);
      if (agent === null) agent = agentText(j);
    }
    if ((you !== null && agent !== null) || whole) break;
  }
  return { you: you === null ? null : clip(you), agent: agent === null ? null : clip(agent) };
}

// Options whose value(s) follow them, from `claude --help`. Variadic ones take every
// following word up to the next option.
const VARIADIC = new Set(["--add-dir", "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools", "--betas", "--file", "--mcp-config", "--tools"]);
const VALUED = new Set(["--agent", "--agents", "--append-system-prompt", "--autocompact", "--debug-file", "--effort", "--environment", "--fallback-model",
  "--input-format", "--json-schema", "--max-budget-usd", "--model", "-n", "--name", "--output-format", "--permission-mode", "--permission-prompts",
  "--plugin-dir", "--plugin-url", "--remote-control-session-name-prefix", "--setting-sources", "--settings", "--system-prompt", "--system-prompt-snapshot",
  "--session-id"]);
const OPTIONAL = new Set(["-r", "--resume", "-d", "--debug", "--cloud", "--from-pr", "--prompt-suggestions", "--remote-control", "--teleport", "-w", "--worktree"]);
const BOOLEAN = new Set(["--allow-dangerously-skip-permissions", "--ax-screen-reader", "--bg", "--background", "--bare", "--brief", "--chrome", "-c", "--continue",
  "--dangerously-skip-permissions", "--desktop", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections", "--fork-session",
  "--forward-subagent-text", "--ide", "--include-hook-events", "--include-partial-messages", "--no-chrome", "--no-session-persistence", "-p", "--print",
  "--replay-user-messages", "--restricted", "--safe-mode", "--strict-mcp-config", "--tmux", "--verbose"]);
// Session-choosing flags (dropped: --resume <id> replaces them), plus ones that would start somewhere else.
const DROP = new Set(["-c", "--continue", "-r", "--resume", "--session-id", "--fork-session", "--from-pr", "--teleport", "--cloud", "-w", "--worktree", "--tmux", "--bg", "--background", "--desktop"]);
const NO_RESUME = new Set(["-p", "--print", "--no-session-persistence"]);

// argv → [{ flag, values }] and the positional words (a first prompt, never repeated).
function parse(argv) {
  const opts = [], words = [];
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") {
      words.push(a);
      continue;
    }
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const o = { flag, raw: [a] };
    if (eq < 0) {
      const next = () => i + 1 < argv.length && !String(argv[i + 1]).startsWith("-");
      if (VARIADIC.has(flag)) while (next()) o.raw.push(String(argv[++i]));
      else if (VALUED.has(flag)) { if (i + 1 < argv.length) o.raw.push(String(argv[++i])); }
      else if (OPTIONAL.has(flag)) { if (next()) o.raw.push(String(argv[++i])); }
      else if (!BOOLEAN.has(flag) && next()) o.raw.push(String(argv[++i])); // unknown: assume it takes a value
    }
    opts.push(o);
  }
  return { opts, words };
}

export const resumable = (argv) => !parse(argv ?? []).opts.some((o) => NO_RESUME.has(o.flag));
export const flagNames = (argv) => parse(argv ?? []).opts.map((o) => o.flag);

// The original argv without session flags or a first prompt, then --resume <id>.
export function resumeArgv(argv, sessionId) {
  const a = argv?.length ? argv : ["claude"];
  const first = /\/claude\/versions\//.test(String(a[0])) ? "claude" : String(a[0]);
  const kept = parse(a).opts.filter((o) => !DROP.has(o.flag)).flatMap((o) => o.raw);
  return [first, ...kept, "--resume", sessionId];
}

// A bare word may not start with "=": zsh would expand =word to a program's path.
// Shell quoting follows the pattern in Herdr Desktop's shipped mods (herdrdev/herdr-app, Apache-2.0). See NOTICE.
export const quote = (s) => (/^[A-Za-z0-9_@%+:,./-][A-Za-z0-9_@%+=:,./-]*$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
const squote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// cd '<cwd>' && [CLAUDE_CONFIG_DIR=<dir> ]claude ... --resume <id>
// ~/.claude is Claude's default: no variable (setting it would make Claude look for another login).
export function commandLine(e) {
  const env = base(e.configDir) === ".claude" ? "" : `CLAUDE_CONFIG_DIR=${quote(e.configDir)} `;
  return `cd ${squote(e.cwd)} && ${env}${resumeArgv(e.argv, e.sessionId).map(quote).join(" ")}`;
}

// T: the string table (strings.js).
export function ago(ms, T) {
  if (!ms) return "";
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (m < 1) return T.justNow;
  if (m < 60) return T.minutesAgo(m);
  const h = Math.floor(m / 60);
  return h < 24 ? T.hoursAgo(h) : T.daysAgo(Math.floor(h / 24));
}

// macOS: kern.boottime → { sec = 1700000000, usec = ... }
export async function bootMs() {
  const r = await exec("sysctl", ["-n", "kern.boottime"]).catch(() => null);
  const m = /sec\s*=\s*(\d+)/.exec(r?.stdout ?? "");
  return m ? Number(m[1]) * 1000 : null;
}

// Writes through a temporary file, keeping the previous version as snapshot.prev.json.
export async function writeSnapshot(obj) {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = `snapshot.json.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await fs.writeFile(`${dir}/${tmp}`, JSON.stringify(obj, null, 1));
  // Owner-only, like the transcripts it quotes (0600; the folder 0700).
  const r = await exec("sh", ["-c", 'umask 077; cd "$1" || exit 1; chmod 700 . ; chmod 600 "$2" || exit 1; if [ -f snapshot.json ]; then cp -f snapshot.json snapshot.prev.json && chmod 600 snapshot.prev.json; fi; mv -f "$2" snapshot.json', "sh", dir, tmp]);
  if (r.code !== 0) throw new Error(r.stderr || "mv failed");
}

export async function readSnapshot() {
  try {
    const j = JSON.parse((await readTextFile(snapPath())) ?? "null");
    if (j && typeof j.entries === "object") return j;
  } catch {}
  return { version: 1, entries: {} };
}

export async function copyText(text) {
  await exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text]).catch(() => null);
}
