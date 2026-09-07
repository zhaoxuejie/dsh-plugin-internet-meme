import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { apply } from '../lib/index.js'

async function loadSource(name) {
  const source = readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}
const { defaults, normalizeSettings } = await loadSource('settings')
const { enqueue } = await loadSource('queue')

test('invalid storage shapes and maxVisible cannot disable the removal bound', () => {
  for (const value of [null, [], false, 42, 'text']) assert.deepEqual(normalizeSettings(value), defaults)
  for (const maxVisible of [0, -1, 1.5, '3', null, NaN, Infinity, 999]) {
    assert.equal(normalizeSettings({ maxVisible }).maxVisible, 4)
  }
  for (const maxVisible of [3, 4, 5]) assert.equal(normalizeSettings({ maxVisible }).maxVisible, maxVisible)
})

test('settings validate types, clamp opacity and bound custom text', () => {
  const settings = normalizeSettings({ enabled: 'false', theme: '__proto__', fontSize: null, customLines: {}, opacity: 1000, extra: 'discard' })
  assert.equal(settings.enabled, true)
  assert.equal(settings.theme, 'classic')
  assert.equal(settings.customLines, '')
  assert.equal(settings.opacity, 100)
  assert.equal('extra' in settings, false)
  assert.equal(normalizeSettings({ opacity: -20 }).opacity, 35)
  assert.equal(normalizeSettings({ opacity: NaN }).opacity, 86)
  assert.equal(normalizeSettings({ soundEnabled: 'yes', soundMode: 'all', soundVolume: 150 }).soundEnabled, false)
  assert.equal(normalizeSettings({ soundEnabled: true, soundMode: 'announce', soundVolume: -1 }).soundMode, 'announce')
  assert.equal(normalizeSettings({ soundEnabled: true, soundMode: 'announce', soundVolume: -1 }).soundVolume, 0)
  const lines = normalizeSettings({ customLines: Array(150).fill('x'.repeat(250)).join('\r\n') }).customLines.split('\n')
  assert.ok(lines.length <= 100)
  assert.ok(lines.every((line) => line.length <= 200))
  assert.equal(normalizeSettings({ customLines: ' a \r\n\r\n b ' }).customLines, 'a\nb')
})

const meme = (fields = {}) => ({ kind: 'tool-call', message: '调用工具', repeat: 1, ...fields })
test('different tools, calls and unidentified calls remain separate', () => {
  const queue = []
  for (const item of [{ toolName: 'A', callId: '1' }, { toolName: 'B', callId: '1' }, { toolName: 'B', callId: '2' }, {}, {}]) enqueue(queue, meme(item))
  assert.equal(queue.length, 5)
  enqueue(queue, meme({ toolName: 'C', callId: '3' }))
  enqueue(queue, meme({ toolName: 'C', callId: '3' }))
  assert.equal(queue.at(-1).repeat, 2)
})

test('overflow keeps failure and completion ahead of disposable pulses', () => {
  const queue = [meme({ kind: 'tool-result', failed: true }), meme({ kind: 'turn-end' })]
  for (let i = 0; i < 20; i++) enqueue(queue, meme({ callId: String(i) }))
  assert.equal(queue.length, 8)
  assert.equal(queue[0].failed, true)
  assert.equal(queue[1].kind, 'turn-end')
  enqueue(queue, meme({ previewId: 'request-1' }))
  assert.equal(queue[0].previewId, 'request-1')
  assert.equal(queue.length, 8)
})

function host() {
  const routes = new Map(), listeners = new Map()
  let cleanup
  apply({
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    effect(callback) { cleanup = callback(); return cleanup },
  })
  const response = () => Object.assign(new EventEmitter(), {
    status: 0, writableEnded: false, chunks: [],
    writeHead(status) { this.status = status },
    write(chunk) { this.chunks.push(String(chunk)); return true },
    end() { this.writableEnded = true; this.emit('close') },
  })
  const stream = response()
  routes.get('/plugins/dsh-plugin-internet-meme/events')({}, stream)
  return { routes, listeners, response, stream, cleanup, pulses: () => stream.chunks.filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6))) }
}

test('preview correlates requests, validates identifiers and rejects non-POST', () => {
  const h = host()
  try {
    const route = h.routes.get('/plugins/dsh-plugin-internet-meme/preview')
    for (const [method, id, status] of [['GET', 'valid', 405], ['POST', 'bad id', 400], ['POST', 'x'.repeat(65), 400], ['POST', 'request-1', 204]]) {
      const response = h.response()
      route({ method, headers: { 'x-meme-preview-id': id } }, response)
      assert.equal(response.status, status)
    }
    assert.equal(h.pulses().length, 1)
    assert.equal(h.pulses()[0].previewId, 'request-1')
  } finally { h.cleanup() }
  assert.equal(h.routes.size, 0)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.stream.writableEnded, true)
})

test('host preserves failed, successful and unknown outcomes without body leakage', () => {
  const h = host()
  try {
    for (const isError of [true, false, undefined]) {
      h.listeners.get('session/event')({}, { type: 'tool/result', time: 123, seq: 1, data: {
        message: { source: { callId: 'call-1' }, content: [{ isError, text: 'SECRET_RESULT' }] }, arguments: 'SECRET_ARGUMENT',
      } })
    }
    const pulses = h.pulses()
    assert.equal(pulses[0].failed, true)
    assert.equal(pulses[1].failed, false)
    assert.equal('failed' in pulses[2], false)
    assert.equal(JSON.stringify(pulses).includes('SECRET'), false)
    const count = pulses.length
    h.listeners.get('session/event')({}, { type: 'assistant/text', data: { text: 'SECRET' } })
    assert.equal(h.pulses().length, count)
  } finally { h.cleanup() }
})
