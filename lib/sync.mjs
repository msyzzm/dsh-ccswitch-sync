/**
 * The mirror itself: copy the CC Switch-managed parts of a DSH profile patch
 * (`llm-pi-ai.providers` and the `cc-switch-mcp-*` insert rows) into the
 * dsh-tui profile patch, inside a marked block.
 *
 * Pure text splicing on purpose: the source blocks are copied verbatim, so no
 * YAML parser is needed and nothing outside the markers is touched. The write
 * is atomic and only happens when the composed text actually differs, which is
 * what keeps the live reload from looping.
 */
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const BEGIN_MARK = '# >>> cc-switch sync (managed) >>>'
export const END_MARK = '# <<< cc-switch sync (managed) <<<'

const EMPTY_PROVIDERS_BLOCK = '- id: llm-pi-ai\n  config:\n    providers: {}\n'
const KEEP_BACKUPS = 20
/** Overridable so tests never touch the real state directory. */
const STATE_DIR = process.env.CCSWITCH_SYNC_STATE || join(homedir(), '.dsh-tui')

export function defaultPaths() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profiles = join(home, 'profiles')
  return {
    sources: [
      join(profiles, 'web', 'cordis.patch.yml'),
      join(profiles, 'desktop', 'cordis.patch.yml'),
    ],
    target: join(profiles, 'dsh-tui', 'cordis.patch.yml'),
  }
}

function linesWithEnds(text) {
  const out = []
  let index = 0
  while (index < text.length) {
    const newline = text.indexOf('\n', index)
    if (newline === -1) {
      out.push(text.slice(index))
      break
    }
    out.push(text.slice(index, newline + 1))
    index = newline + 1
  }
  return out
}

/** Character spans of every top-level "- " entry in a YAML sequence. */
export function blockSpans(text) {
  const spans = []
  let position = 0
  let start
  for (const line of linesWithEnds(text)) {
    if (line.startsWith('- ')) {
      if (start !== undefined) spans.push({ start, end: position })
      start = position
    }
    position += line.length
  }
  if (start !== undefined) spans.push({ start, end: position })
  return spans
}

function firstLine(block) {
  const newline = block.indexOf('\n')
  return newline === -1 ? block : block.slice(0, newline)
}

export function isLlmPiAiBlock(block) {
  return /^- id:\s*llm-pi-ai\s*$/.test(firstLine(block).trimEnd())
}

export function isManagedInsert(block) {
  return block.startsWith('- insert:') && block.includes('cc-switch-mcp-')
}

/** The blocks to mirror, always with an `llm-pi-ai` entry. */
export function extractManaged(sourceText) {
  const blocks = blockSpans(sourceText).map(({ start, end }) => sourceText.slice(start, end))
  const wanted = blocks.filter((block) => isLlmPiAiBlock(block) || isManagedInsert(block))
  if (!wanted.some(isLlmPiAiBlock)) wanted.unshift(EMPTY_PROVIDERS_BLOCK)
  return wanted.map((block) => (block.endsWith('\n') ? block : `${block}\n`))
}

function dropBlocks(text, predicate) {
  const spans = blockSpans(text)
    .filter(({ start, end }) => predicate(text.slice(start, end)))
    .map(({ start, end }) => ({ start, end }))
  let result = text
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    result = result.slice(0, spans[i].start) + result.slice(spans[i].end)
  }
  return result
}

/** Remove a lone `[]` line (an empty YAML sequence) when nothing else is left. */
function dropEmptyFlowSequence(text) {
  const meaningful = text
    .split('\n')
    .map((line) => line.replace(/^\uFEFF/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
  if (meaningful.length !== 1 || meaningful[0] !== '[]') return text
  return (
    text
      .split('\n')
      .filter((line) => line.replace(/^\uFEFF/, '').trim() !== '[]')
      .join('\n')
      .replace(/\n+$/, '') + '\n'
  )
}

/** Splice the managed block into the target patch text. */
export function composePatch(targetText, managedBlocks) {
  const managed = `${BEGIN_MARK}\n${managedBlocks.join('')}${END_MARK}\n`
  let head = targetText
  let tail = ''
  const begin = targetText.indexOf(BEGIN_MARK)
  const end = targetText.indexOf(END_MARK)
  if (begin !== -1 && end > begin) {
    head = targetText.slice(0, begin)
    tail = targetText.slice(end + END_MARK.length)
  }
  head = dropBlocks(head, isLlmPiAiBlock)
  tail = dropBlocks(tail, isLlmPiAiBlock)
  head = dropEmptyFlowSequence(head)
  const trimmedHead = head.replace(/\n+$/, '')
  let out = trimmedHead === '' ? managed : `${trimmedHead}\n${managed}`
  if (tail.trim() !== '') out += tail.replace(/^\n+/, '')
  return out
}

async function readStable(path) {
  try {
    const first = await readFile(path, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 150))
    const second = await readFile(path, 'utf8')
    return second === first ? first : second
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function backupTarget(target) {
  try {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .slice(0, 15)
    const dir = join(STATE_DIR, 'ccswitch-sync', 'backups')
    await mkdir(dir, { recursive: true })
    const dest = join(dir, `cordis.patch.${stamp}.yml`)
    await copyFile(target, dest)
    const names = (await readdir(dir)).filter((name) => name.endsWith('.yml')).sort()
    for (const name of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) {
      await unlink(join(dir, name)).catch(() => {})
    }
  } catch {
    // backups are best-effort; never block the write
  }
}

/**
 * Mirror the newest readable source into the target.
 * @returns `{ changed, note }` — `changed` is true only when bytes were written.
 */
export async function syncOnce(paths = defaultPaths()) {
  const candidates = []
  for (const path of paths.sources) {
    try {
      await stat(path)
      candidates.push(path)
    } catch {
      // missing profile: skip
    }
  }
  if (candidates.length === 0) return { changed: false, note: 'no source profile patch found' }

  const source = candidates[0]
  const profile = dirname(source).split(/[\\/]/).pop()
  const sourceText = await readStable(source)
  if (sourceText === undefined) return { changed: false, note: `source=${profile}: unreadable` }

  let targetText = (await readStable(paths.target)) ?? ''
  const composed = composePatch(targetText, extractManaged(sourceText))
  if (composed === targetText) return { changed: false, note: `source=${profile}: already in sync` }

  await mkdir(dirname(paths.target), { recursive: true })
  const stage = `${paths.target}.candidate.yml`
  await writeFile(stage, composed, 'utf8')
  await backupTarget(paths.target)
  await rename(stage, paths.target)
  return { changed: true, note: `source=${profile}: wrote ${composed.length} bytes` }
}
