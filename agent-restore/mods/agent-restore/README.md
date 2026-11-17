# agent-restore: resume your Claude Code agents after a reboot

After a reboot, Herdr brings its kept terminals back at the same address, but as fresh shells in the
same folder: the `claude` that ran there does not start again. This mod remembers which Claude Code
session ran in each terminal. After a restart it lists the interrupted ones in the side panel, and for
the ones you check it types `claude … --resume <id>` back into the same terminal.

## What it does on your machine (read this first)

- **Runs programs.**
  - `hc ls --json` and `hc get --json <terminal>`: every 30 seconds and whenever an agent's status changes.
  - `hc send <terminal> <command>`: only to resume.
  - Through `exec`:
    - `sysctl -n kern.boottime`: once per load.
    - `ps -o lstart=,comm= -p <pid>`: before a resume.
    - `sh -c` with `wc -c` and `tail -c`: to read the end of a transcript.
    - A `for` loop: to find a transcript.
    - `chmod`, `cp`, `mv`: to write the snapshot.
    - `pbcopy`: when you press Copy.
- **Reads files outside its folder.**
  - `~/.claude*/sessions/<pid>.json`: session id, name, folder. It never reads `*.key`.
  - The end of the session's transcript, `~/.claude*/projects/<folder>/<sessionId>.jsonl` (last 64 KB, at most 512 KB), to quote your last message and the agent's last reply.
  - `space-groups.json` in Herdr's home, if it exists (optional, see below).
- **Stores conversation snippets.** `~/.config/herdr-app/data/agent-restore/snapshot.json`, and the previous version as `snapshot.prev.json`, hold for each terminal:
  - space and tab names, folder, the `claude` command line, session id and title;
  - your last message and the agent's last reply, up to 400 characters each.
  - Both files are `0600` and the folder is `0700`.
- **Types into terminals.**
  - Only into a terminal you checked, or one named in `agent-restore.resume:`.
  - Only after `hc get` shows the terminal's own idle shell in the foreground.
  - One at a time, 3 seconds apart.
- **Does not:**
  - reach the network;
  - change Claude Code's settings, hooks or sessions;
  - kill or restart any terminal or herdr-core;
  - touch other mods, `keys.json`, `settings.json` or themes.

## What counts as "resumable"

**In short: the mod checks whether the terminal's root process changed.**

When a kept terminal's program is lost (reboot, logout, a crash of herdr-core, a signal), herdr-core
gives it a new shell at the same address with the same `created_ms`, and does not rerun the old
command. The new shell has a **new root `pid`**. The `lost` and `restarted` events are not seen when
the app was not running, and `hc get`'s `reason` describes the current program, not the history. So
the pid is the signal that survives.

Only local terminals are recorded, and only those with `keep: true` and the `herdr.space` and `herdr.tab` labels: the ones Herdr opens and brings back.
For each snapshot entry:

| The terminal now | Verdict |
|---|---|
| `claude` in the foreground | Running: the entry is updated |
| Alive, no `claude`, root pid differs from the snapshot | **Resumable**: herdr-core recovered it |
| Alive, no `claude`, snapshot older than this boot (`kern.boottime`) | **Resumable**: guards against a reused pid |
| Alive, no `claude`, same root pid | You ended it (for example `/exit`). It is marked, and forgotten on a later round at least 25 seconds on, never listed |
| Alive but no foreground yet (between loss and the new shell) | In between: no verdict |
| `hc get` says not found, or finished | Was running: deleted, because the tab was closed. Already resumable, or the snapshot is older than this boot: kept, marked "its tab was closed" |
| `hc ls` or `hc get` fails (core still starting) | Nothing changes this round |
| A resumable session already runs in another terminal | Deleted: you resumed it by hand |

Agents started with `-p/--print` or `--no-session-persistence` are not recorded: they cannot be resumed.

## Install

1. Copy `mods/agent-restore/` to `~/.config/herdr-app/mods/`.
2. Add two blocks to your layout (for example a copy of `layouts/main.json`). Their ids are fixed in the code.
   1. `restore-bar`: the one-line notice. Put it in the `work` column, between `work-body` and `status`. It stays 0 px until something can be resumed, then the mod resizes it to 26 px.
   2. `restore`: the list. Put it in the side panel stack `panel-body`, after `files` and `changes`.

   `restore-bar`:

   ```json
   { "id": "restore-bar", "type": "block", "size": { "px": 0 },
     "content": { "mod": "agent-restore", "props": { "role": "bar", "lang": "en" } } }
   ```

   `restore`:

   ```json
   { "id": "restore", "type": "block",
     "content": { "mod": "agent-restore", "props": { "role": "panel", "lang": "en" } } }
   ```

3. Run `herdr-app check ~/.config/herdr-app/mods/agent-restore`.
4. Check that the app wrote no `layout.error`.

## Props

| Prop | Copy | Default | Meaning |
|---|---|---|---|
| `role` | both | `"bar"` | `"bar"` records, judges and resumes; `"panel"` is the list. Only the bar writes the snapshot or types into a terminal; the panel sends it commands. |
| `lang` | both | `"en"` | Interface language: `"en"` or `"zh-TW"`. Anything else falls back to `"en"`. |
| `accountLabels` | bar | none | Map from a config folder's name to the label shown on each row. Without it, `~/.claude` shows `default` and any other folder its name without the leading dot (`~/.claude-work` → `claude-work`). |

For example, with a second Claude Code config folder at `~/.claude-work`:

```json
"props": { "role": "bar", "lang": "en", "accountLabels": { ".claude": "home", ".claude-work": "work" } }
```

The label is written into the snapshot when the bar records an agent. An entry that is already
waiting to be resumed keeps the label it had. Giving the panel the same props does no harm.

## `space-groups.json` (optional)

With no file, each space is its own group in the list, named after the space. To group spaces, put
this file in Herdr's home, `~/.config/herdr-app/space-groups.json`:

```json
{ "groups": [
  { "name": "Work", "spaces": ["<space id>", "<space id>"] },
  { "name": "Side projects", "spaces": ["<space id>"] }
] }
```

- `spaces` holds space ids (`herdr-app ls` shows them), not names.
- Groups keep the file's order.
- Spaces in no group come after them, each as its own group.
- The mod only reads this file.

## The list

- **Each row:**
  - a checkbox and the title;
  - the account label;
  - `space › tab`;
  - how long ago the agent was last active.
- **Notes on a row:**
  - Working before the restart: ask it where it got to.
  - Waiting for your answer: it will stop at the same question.
  - Its tab was closed: copy the command and paste it yourself.
- **Details:** your last message, the agent's last reply, and the full resume command with a Copy button (`pbcopy`).
- **Checked at first:** rows active in the last 24 hours. The others are listed but not checked.
- **Buttons:**
  - Resume N;
  - All;
  - Clear;
  - Skip: drops the checked rows from the list and the snapshot without resuming them.
- **When it opens by itself:** once per app run, the first time something can be resumed. Clicking the bar opens it again.
- **When the bar folds:** once everything is resumed or skipped, the bar goes back to 0 px.

## How a resume works

1. **One at a time.** The next one starts 3 seconds after the previous one is confirmed.
2. **Never twice.** The same session id is never resumed twice at once. A session running somewhere else is not resumed either. To tell, the mod looks for a `~/.claude*/sessions/<pid>.json` with that session id. The session counts as running only if that pid is still a `claude` that started when the file's `procStart` says. A file left behind by a power cut does not block the resume.
3. **Idle shell first.** `hc get` must show the terminal's own root shell in the foreground.
4. **The command.** `hc send <terminal> "<command>"` pastes it and presses Enter. It looks like:
   ```
   cd '<folder>' && [CLAUDE_CONFIG_DIR=<config folder> ]<original argv> --resume <sessionId>
   ```
   - The original argv comes from `hc get`'s `foreground.argv`. Flags like `--dangerously-skip-permissions` and every `--add-dir` are kept.
   - Every word is shell-quoted.
   - **Dropped flags:**
     - session choosers: `-c/--continue`, `-r/--resume`, `--session-id`, `--fork-session`;
     - flags that would start somewhere else: `--from-pr`, `--teleport`, `--cloud`, `-w/--worktree`, `--tmux`, `--bg/--background`, `--desktop`;
     - the first prompt, so the task is not sent again.
   - `CLAUDE_CONFIG_DIR` is added only for folders other than `~/.claude`, which is Claude Code's default.
5. **Confirm within 10 seconds.** `hc get` must show `claude` in the foreground.
   - Yes: the row is marked resumed and the entry is recorded again at once with the new shell's pid.
   - No: the row says why and stays. Try again, or copy the command.

## Commands

```sh
herdr-app do agent-restore.open             # open the list
herdr-app do agent-restore.status           # counts and states (no titles, folders or conversation) to shared state `agent-restore.status` and the console
herdr-app do agent-restore.refresh          # record a round now
herdr-app do agent-restore.resume:t1m,t1n   # resume these terminals (the same path as the button)
herdr-app do agent-restore.skip:t1m         # drop from the list
```

## What has been tested

On macOS with Herdr 0.1.16, herdr-core (`hc`) 0.1.21 and Claude Code 2.1, one test:

1. Started `claude --dangerously-skip-permissions` with a second config folder in one kept terminal, and let it answer one message.
2. Killed the terminal's shell with SIGKILL, which herdr-core treats as a lost program.
3. Saw the row in the list and the notice in the bar.
4. Resumed it with `agent-restore.resume:`, which is the path the button takes.
5. Checked that `claude` was in the foreground, with the same session id and `--dangerously-skip-permissions`.
6. Ended it with `/exit` and saw it leave the snapshot.

**It has not yet been through a real reboot.**

Not tested yet:

- several rows queued at once;
- Skip;
- retrying after a failure;
- pressing the buttons by hand;
- a tab closed before the restart;
- Linux.

## Known limits

- **macOS only.** It uses `sysctl kern.boottime`, `pbcopy` and `ps -o lstart=`.
- **The list can fold away.** Herdr's tabs mod remembers, per space, which side panel page is open, and it only knows Files and Changes. Switching spaces can fold the list away. The bar stays: click it to open the list again.
- **Records only while Herdr runs** with both blocks in the shown layout. An agent you `/exit` while Herdr is closed can still be listed after a restart: Skip it.
- **A closed tab is not reopened.** If the tab was closed, no new tab is opened; the row offers the command to copy.
- **It depends on Claude Code's session files.** If Claude Code stops writing `sessionId` to `~/.claude*/sessions/<pid>.json`, nothing is recorded.
- **Local terminals only.** Terminals on other machines (`machine/t7`) are skipped.

## Remove

1. Remove the `restore-bar` and `restore` blocks from your layout.
2. Delete `~/.config/herdr-app/mods/agent-restore/`.
3. Optional: delete `~/.config/herdr-app/data/agent-restore/`. It holds the snapshot, with its conversation snippets.
4. Optional: the shared-state keys `agent-restore` and `agent-restore.status` in `shared.json` can be removed.

## Credits

Parts of `core.js` follow the hibernate mod in [VladTemp27/herdr-mods](https://github.com/VladTemp27/herdr-mods), which is under the Apache License 2.0 and has a NOTICE file. The adapted lines are marked in `core.js`; see this repository's [NOTICE](../../../NOTICE) and [LICENSES/Apache-2.0.txt](../../../LICENSES/Apache-2.0.txt).

- **Identical lines:**
  - the `SHELLS` list;
  - `base()` and `local()`;
  - the `hc ls --json` and `hc get --json` calls.
- **Similar in shape:**
  - the foreground checks (`claudeFg`, `idleShell`);
  - the `not_found` check in `hcGet`;
  - `quote()` and `commandLine()` (`cd <folder> && <argv>`);
  - the rule that a recovered terminal has a new shell pid.

## 繁體中文摘要

電腦重開後，Herdr 的終端機會在原位址回來，但只剩新的 shell，原本跑的 `claude` 不會自己重跑。

這個 mod 平常每 30 秒記下每個 Claude Code agent 的啟動方式和 session。重開後，它把中斷的 agent 列在右側面板。你勾選後，它會在原終端機打回 `claude … --resume <id>`。

判斷方式是看終端機的 root pid 有沒有換：換了，代表被 herdr-core 復原過；沒換，代表是你自己 `/exit` 的，不會列出。

它會：
- 執行 `hc` 和幾個系統指令；
- 讀 `~/.claude*/sessions/*.json` 和對話紀錄的尾端；
- 在快照裡存對話片段（權限 0600）；
- 只對你勾選的終端機送出指令。

它不連網，也不改 Claude 的設定。

介面語言用 props 的 `lang` 切換（`"en"` 或 `"zh-TW"`）。帳號標籤用 `accountLabels` 自訂。

目前只用 SIGKILL 測過單一終端機，還沒經過真的重開機，也只支援 macOS。
