/**
 * dsh-ccswitch-sync — mirror CC Switch's DSH configuration into the dsh-tui
 * profile, and show how fresh it is.
 *
 * The mirror runs on `/ccswitch sync`, or at activation when
 * `DSH_CCSWITCH_SYNC_ON_START=1` is set. Writing `cordis.patch.yml` from a row
 * inside that same file triggers the profile's live reload, which is harmless
 * once at startup and disruptive in the middle of a turn — hence off by
 * default. `syncOnce` only writes when the composed text actually differs, so
 * the reload it causes settles after one pass.
 *
 * Service discovery goes through `ctx.inject`: on a cold boot the status and
 * command services mount after this row, so a one-shot `ctx.get` at apply time
 * would silently miss them.
 */
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR, defaultPaths, syncOnce } from './sync.mjs'

export const name = 'ccswitch-sync'

const LOG_PATH = join(STATE_DIR, 'plugin.log')

// Import-time probe: distinguishes "module never imported" from "apply never
// called" when the row fails to mount on a cold boot. Opt-in — a plugin should
// not create files just by being imported.
const DEBUG = process.env.DSH_CCSWITCH_DEBUG === '1'
if (DEBUG) {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] import: module evaluated pid=${process.pid}\n`)
  } catch {
    // probe only
  }
}
/** Same file the sync writes, so the status always describes what was synced. */
const PATCH_PATH = defaultPaths().target

const FIELD_KEY = 'ccswitch'
const REFRESH_MS = 60_000
const MAX_STATUS_CELLS = 20
const STARTUP_DELAY_MS = 200
/** Activation-time sync is opt-in; installing must never rewrite the profile. */
const SYNC_ON_START = process.env.DSH_CCSWITCH_SYNC_ON_START === '1'

async function log(line) {
  try {
    await mkdir(STATE_DIR, { recursive: true })
    await appendFile(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // logging is best effort
  }
}

function humanAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 90) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 90) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

async function snapshot() {
  const text = await readFile(PATCH_PATH, 'utf8').catch(() => '')
  const statInfo = await stat(PATCH_PATH).catch(() => undefined)
  return {
    providers: (text.match(/^\s+apiKeyEnv:/gm) ?? []).length,
    mcp: (text.match(/id: cc-switch-mcp-/g) ?? []).length,
    patchedAt: statInfo ? statInfo.mtimeMs : undefined,
  }
}

function statusText(snap) {
  if (snap.patchedAt === undefined) return 'ccs no patch'
  const age = humanAge(Date.now() - snap.patchedAt)
  // The key is internal to the host, so the field needs its own visible label.
  return `ccs ${snap.providers}p ${snap.mcp}mcp ${age}`.slice(0, MAX_STATUS_CELLS)
}

function describe(snap) {
  return [
    `providers: ${snap.providers}`,
    `mcp: ${snap.mcp}`,
    snap.patchedAt === undefined
      ? 'patch: 未找到'
      : `patch: ${new Date(snap.patchedAt).toLocaleString()}（${humanAge(Date.now() - snap.patchedAt)} 前）`,
    '',
    '/ccswitch sync 立即同步（会触发 profile 重载）',
  ].join('\n')
}

export function apply(ctx) {
  let syncing
  let refreshField
  void log('apply: mounted')

  const runSync = (origin) => {
    if (syncing !== undefined) return syncing
    syncing = (async () => {
      try {
        const result = await syncOnce(defaultPaths())
        await log(`sync(${origin}): ${result.note}`)
        await refreshField?.()
        return result
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        await log(`sync(${origin}) failed: ${message}`)
        return { changed: false, note: `failed: ${message}` }
      } finally {
        syncing = undefined
      }
    })()
    return syncing
  }

  ctx.inject(['tuiStatus'], (child) => {
    let disposer
    const refresh = async () => {
      try {
        const snap = await snapshot()
        disposer = child.tuiStatus.setField(FIELD_KEY, statusText(snap), {
          slot: 'right-head',
          tone: 'dim',
          maxCells: MAX_STATUS_CELLS,
          detail:
            snap.patchedAt === undefined
              ? 'cc-switch → dsh-tui: profile patch not found'
              : `cc-switch → dsh-tui: ${snap.providers} providers, ${snap.mcp} MCP`,
        })
      } catch {
        // the status bar is optional
      }
    }
    void refresh()
    refreshField = refresh
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    ctx.effect(() => () => {
      clearInterval(timer)
      try {
        disposer?.()
      } catch {
        // ignore
      }
    })
  })

  ctx.inject(['commands'], (child) => {
    try {
      const dispose = child.commands.register({
        name: 'ccswitch',
        description: 'CC Switch → dsh-tui 同步状态（/ccswitch sync 立即同步）',
        handler: async (invocation) => {
          const raw = String(invocation?.rawInput ?? '').trim().toLowerCase()
          if (raw === 'sync') {
            const result = await runSync('manual')
            return {
              kind: 'success',
              text: result.changed
                ? `已同步并写入 profile：${result.note}\n（profile 会重载，稍等几秒）`
                : `无需写入：${result.note}`,
            }
          }
          return { kind: 'success', text: describe(await snapshot()) }
        },
      })
      ctx.effect(() => () => {
        try {
          dispose?.()
        } catch {
          // ignore
        }
      })
    } catch {
      // commands service may be absent in bare compositions
    }
  })

  if (SYNC_ON_START) {
    const starting = setTimeout(() => void runSync('startup'), STARTUP_DELAY_MS)
    ctx.effect(() => () => clearTimeout(starting))
  }
}
