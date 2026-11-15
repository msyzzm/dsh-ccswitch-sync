import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = `- id: llm-pi-ai
  config:
    providers:
      freellm:
        apiKeyEnv: CC_SWITCH_DSH_FREELLM_KEY
`

let root
let sync

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccswitch-sync-'))
  // Set before import: the state directory is resolved at module load.
  process.env.CCSWITCH_SYNC_STATE = join(root, 'state')
  sync = await import('../lib/sync.mjs')
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

function pathsIn(dir) {
  return {
    sources: [join(dir, 'web', 'cordis.patch.yml'), join(dir, 'desktop', 'cordis.patch.yml')],
    target: join(dir, 'dsh-tui', 'cordis.patch.yml'),
  }
}

test('defaultPaths honours DSH_PROFILE_DIR for the target', () => {
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = join(root, 'custom-profile')
  try {
    assert.equal(sync.defaultPaths().target, join(root, 'custom-profile', 'cordis.patch.yml'))
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
  }
})

test('syncOnce reports a missing source without writing', async () => {
  const dir = join(root, 'empty')
  const result = await sync.syncOnce(pathsIn(dir))
  assert.equal(result.changed, false)
  assert.match(result.note, /no source/)
})

test('syncOnce writes once, then reports already in sync', async () => {
  const dir = join(root, 'roundtrip')
  const paths = pathsIn(dir)
  await mkdir(join(dir, 'web'), { recursive: true })
  await writeFile(paths.sources[0], SOURCE)

  const first = await sync.syncOnce(paths)
  assert.equal(first.changed, true)
  const written = await readFile(paths.target, 'utf8')
  assert.ok(written.includes('freellm'))
  assert.ok(written.includes(sync.BEGIN_MARK))

  const second = await sync.syncOnce(paths)
  assert.equal(second.changed, false)
  assert.match(second.note, /already in sync/)
  assert.ok(!(await readdir(join(dir, 'dsh-tui'))).some((name) => name.includes('.candidate.')))
})

test('syncOnce backs up the previous target before rewriting it', async () => {
  const dir = join(root, 'backup')
  const paths = pathsIn(dir)
  await mkdir(join(dir, 'web'), { recursive: true })
  await mkdir(join(dir, 'dsh-tui'), { recursive: true })
  await writeFile(paths.sources[0], SOURCE)
  await writeFile(paths.target, '- id: keep-me\n')

  await sync.syncOnce(paths)
  const backups = await readdir(join(sync.STATE_DIR, 'backups'))
  assert.ok(backups.length >= 1)
  const contents = await Promise.all(backups.map((name) => readFile(join(sync.STATE_DIR, 'backups', name), 'utf8')))
  assert.ok(contents.includes('- id: keep-me\n'))
})
