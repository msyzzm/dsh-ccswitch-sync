import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BEGIN_MARK,
  END_MARK,
  blockSpans,
  composePatch,
  extractManaged,
  isLlmPiAiBlock,
  isManagedInsert,
} from '../lib/sync.mjs'

const SOURCE = `- id: llm-pi-ai
  config:
    providers:
      freellm:
        apiKeyEnv: CC_SWITCH_DSH_FREELLM_KEY
        baseURL: https://example.test/v1
- insert:
    - id: cc-switch-mcp-context7
      name: '@upstash/context7-mcp'
- id: unrelated
  config: {}
`

const TARGET = `- id: keep-me
  config:
    x: 1
`

test('blockSpans finds every top-level sequence entry', () => {
  const spans = blockSpans(SOURCE)
  assert.equal(spans.length, 3)
  assert.equal(SOURCE.slice(spans[0].start, spans[0].end), SOURCE.slice(0, SOURCE.indexOf('- insert:')))
})

test('extractManaged takes the llm-pi-ai block and cc-switch-mcp rows only', () => {
  const blocks = extractManaged(SOURCE)
  assert.equal(blocks.length, 2)
  assert.ok(isLlmPiAiBlock(blocks[0]))
  assert.ok(isManagedInsert(blocks[1]))
  assert.ok(!blocks.some((block) => block.includes('unrelated')))
  assert.ok(blocks.every((block) => block.endsWith('\n')))
})

test('extractManaged falls back to an empty providers block', () => {
  const blocks = extractManaged('- id: unrelated\n  config: {}\n')
  assert.equal(blocks.length, 1)
  assert.ok(isLlmPiAiBlock(blocks[0]))
  assert.match(blocks[0], /providers: \{\}/)
})

test('composePatch appends the managed block after foreign rows', () => {
  const out = composePatch(TARGET, extractManaged(SOURCE))
  assert.ok(out.startsWith(TARGET.trimEnd() + '\n'))
  assert.ok(out.includes(BEGIN_MARK))
  assert.ok(out.trimEnd().endsWith(END_MARK))
  assert.ok(out.includes('cc-switch-mcp-context7'))
})

test('composePatch is idempotent — the second pass is byte-identical', () => {
  const blocks = extractManaged(SOURCE)
  const once = composePatch(TARGET, blocks)
  const twice = composePatch(once, blocks)
  assert.equal(twice, once)
})

test('composePatch replaces a previous managed block instead of nesting it', () => {
  const before = composePatch(TARGET, extractManaged(SOURCE))
  const after = composePatch(before, extractManaged('- id: llm-pi-ai\n  config:\n    providers: {}\n'))
  assert.equal(after.split(BEGIN_MARK).length - 1, 1)
  assert.equal(after.split(END_MARK).length - 1, 1)
  assert.ok(!after.includes('freellm'))
})

test('composePatch drops a stray llm-pi-ai row outside the markers', () => {
  const target = `- id: llm-pi-ai
  config:
    providers: {}
- id: keep-me
`
  const out = composePatch(target, extractManaged(SOURCE))
  assert.equal(out.split('id: llm-pi-ai').length - 1, 1)
  assert.ok(out.includes('id: keep-me'))
})

test('composePatch collapses a lone empty flow sequence', () => {
  const out = composePatch('[]\n', extractManaged(SOURCE))
  assert.ok(!out.includes('[]'))
  assert.ok(out.startsWith(BEGIN_MARK))
})

test('composePatch keeps rows that follow the managed block', () => {
  const text = `${BEGIN_MARK}\nstale\n${END_MARK}\n- insert:\n    - id: after\n`
  const out = composePatch(text, extractManaged(SOURCE))
  assert.ok(out.includes('id: after'))
  assert.ok(!out.includes('stale'))
  assert.ok(out.indexOf('id: after') > out.indexOf(END_MARK))
})
