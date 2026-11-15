# dsh-ccswitch-sync

[中文](README.zh.md) · [npm](https://www.npmjs.com/package/dsh-ccswitch-sync) · [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) · [Plugin directory](https://dshtui.com/plugins)

A [dsh-TUI](https://dshtui.com) plugin that mirrors the DSH configuration **CC Switch** keeps
in its own profile into the `dsh-tui` profile, and shows how fresh the mirror is in the footer.

CC Switch writes `llm-pi-ai.providers` and `cc-switch-mcp-*` rows into
`~/.dsh/profiles/web/cordis.patch.yml` (falling back to `desktop`). dsh-TUI runs its own
profile, `~/.dsh/profiles/dsh-tui`, so those providers and MCP servers never show up there.
This plugin ports the CC Switch mirror into the plugin itself: the same text splice, executed
from inside the TUI, with a footer field so you can see whether the mirror is current.

```
ccs 3p 4mcp 1m        ← 3 providers, 4 MCP servers, patch written 1 minute ago
```

## Install

```sh
# from npm
dsh plugin --profile dsh-tui add dsh-ccswitch-sync

# or from a local checkout
dsh plugin --profile dsh-tui add link:/path/to/dsh-ccswitch-sync
```

Inside the terminal, `/plugin install <spec>` works too. Restart dsh-TUI after installing —
a bundle is only composed when the process starts.

```sh
dsh plugin --profile dsh-tui remove dsh-ccswitch-sync
```

## Use

| | |
| --- | --- |
| `/ccswitch` | Provider count, MCP count, patch age |
| `/ccswitch sync` | Mirror now (this rewrites the profile patch, see below) |
| footer field `ccswitch` | Same counters, refreshed every 60s; `left-tail`/`right-head`/`right-tail` via the `slot` option |

The footer field is a plugin field, so `/settings → statusBar.pluginFields` can hide it and
`statusBar.pluginFieldsOrder` can place it per slot group. Turn the field off and the command
still works.

## When it syncs

**It never syncs on its own.** Installing, activating, reloading and switching sessions all
leave the profile untouched:

- `/ccswitch sync` — mirror once, now.
- `DSH_CCSWITCH_SYNC_ON_START=1` — opt in to mirroring once at activation.
- No file watcher, no timer that writes. The only timer refreshes the footer text.

That default is deliberate. dsh-TUI profiles use `patchReload: live`, so writing
`cordis.patch.yml` reloads the whole composition — and the row that runs this plugin lives in
that same file. A mirror that fires on activation would reload the profile that just activated
it. Doing it on demand keeps that reload a deliberate act.

## How the mirror works

The managed rows go into one marked block at the end of the target patch:

```yaml
# >>> cc-switch sync (managed) >>>
- id: llm-pi-ai
  config:
    providers: { ... }
- insert:
    - id: cc-switch-mcp-context7
      ...
# <<< cc-switch sync (managed) <<<
```

- **Text splice, not YAML round-trip.** Blocks are copied verbatim, so comments, ordering and
  quoting in the source survive. No YAML dependency, no re-serialisation surprises.
- **Idempotent.** The composed text is compared with the current file; identical bytes mean no
  write, no `mtime` change, no reload. This is what keeps the live reload from looping.
- **Atomic.** Written to `<patch>.candidate.yml` and renamed over the target.
- **Backed up.** The previous patch is copied to `~/.dsh-tui/ccswitch-sync/backups/` before
  each rewrite; the newest 20 are kept.
- **Inside the markers only.** A stale `llm-pi-ai` row outside the block is removed (otherwise
  the composition would have two) — nothing else outside the block is touched.
- **Source preference.** `web` is mirrored when it exists, `desktop` otherwise.

## What it does not touch

- `~/.dsh/.credentials.yaml` and every credential. Provider entries reference
  `CC_SWITCH_DSH_*` environment names; the secrets stay where CC Switch put them.
- `~/.dsh/skills` and any shared skill tree.
- Rows outside the managed block, and every other profile.
- CC Switch's own files: it only reads them.

## Declared permissions

`dsh-plugin.json` declares exactly three (`/plugin` shows the same rows):

| Permission | Scope |
| --- | --- |
| `dsh-ccswitch-sync.profile.read` | `~/.dsh/profiles/{web,desktop}/cordis.patch.yml` |
| `dsh-ccswitch-sync.profile.write` | `~/.dsh/profiles/dsh-tui/cordis.patch.yml` |
| `dsh-ccswitch-sync.state.write` | `~/.dsh-tui/ccswitch-sync/` |

Permissions are behavioural declarations, not an OS sandbox: as with any dsh-TUI plugin, this
code runs in-process with the privileges of your terminal (`trusted-in-process`).

## Uninstall and leftover data

`disable` marks the row `disabled`; `remove` takes the bundle out of the profile. Both are
reversible/ordinary profile operations. **Neither deletes user data**, so after a `remove`:

| Left behind | Where |
| --- | --- |
| Patch backups and `plugin.log` | `~/.dsh-tui/ccswitch-sync/` |
| The managed block in the profile patch | `~/.dsh/profiles/dsh-tui/cordis.patch.yml` |

Delete that directory if you want the backups gone. To drop the managed block, delete the two
`# >>> / # <<<` marker lines and everything between them — `/ccswitch sync` recreates the block
on the next run.

## Compatibility

- dsh-TUI ≥ 0.20.0 (the two host seams it uses: footer fields `tuiStatus.setField`, and the
  `commands` service). Both are probed softly through `ctx.inject`; if either is missing the
  plugin degrades to a no-op instead of breaking startup.
- Manifest: Community v0.15 (`dsh-plugin.json`), facet `v1alpha1`.
- Node `^22.19 || >=24`, ESM only, zero runtime dependencies.
- Windows, macOS and Linux. All paths come from `DSH_HOME`/`~`, never from a hardcoded drive.

## Development

```sh
npm test                           # splicing (idempotency, markers, BOM) + file-level sync
node scripts/check-manifest.mjs    # dependency-free manifest shape check
```

The authoritative manifest validator is the Community v0.15 parser (`@dsh-std/manifest`);
`dsh-plugin.json` here parses and projects cleanly under `0.1.1-rc.2`.

## Links

- dsh-TUI: <https://github.com/ccch1mneyyy/dsh-TUI> · <https://dshtui.com>
- Plugin admission and development guide:
  <https://github.com/ccch1mneyyy/dsh-TUI/blob/main/tui-profile/docs/plugin-admission-and-development.md>
- Ecosystem organisation: <https://github.com/dsh-tui-ecosystem>

## License

MIT.
