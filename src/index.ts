import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const BASE = '/plugins/dsh-plugin-internet-meme'
const BRIDGE_PATH = `${BASE}/bridge.js`
const EVENTS_PATH = `${BASE}/events`
const PREVIEW_PATH = `${BASE}/preview`

type PulseKind = 'turn-start' | 'step-start' | 'tool-call' | 'tool-result' | 'turn-end'

interface Pulse {
  kind: PulseKind
  time: number
  seq?: number
  toolName?: string
  callId?: string
  failed?: boolean
}

interface ContextLike {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void
    }): () => void
  }
  on(name: string, listener: (...args: any[]) => void, options?: { global?: boolean }): () => void
  effect(callback: () => (() => void) | void, label?: string): () => void
}

/**
 * This Bundle deliberately has no provider, model hook, tool, or session
 * writer. It projects a small allow-list of lifecycle metadata to the browser:
 * event type, timestamp, tool name, call id and an error flag. Assistant text,
 * reasoning, tool arguments and tool-result content never leave the host.
 */
export const inject = ['webServer']

export function apply(ctx: ContextLike): void {
  const bridge = readFileSync(new URL('./bridge.js', import.meta.url))
  const subscribers = new Set<ServerResponse>()

  const publish = (pulse: Pulse) => {
    const line = `data: ${JSON.stringify(pulse)}\n\n`
    for (const res of subscribers) {
      if (!res.writableEnded) res.write(line)
    }
  }

  ctx.effect(() => {
    const disposeScript = ctx.on('webserver/index-inject', (table: unknown[]) => {
      table.push({ kind: 'script-src', placement: 'head', src: BRIDGE_PATH })
    }, { global: true })

    const disposeBridge = ctx.webServer.register({
      kind: 'exact',
      path: BRIDGE_PATH,
      handler: (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(bridge)
      },
    })

    const disposeEvents = ctx.webServer.register({
      kind: 'exact',
      path: EVENTS_PATH,
      handler: (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        res.write('retry: 3000\n\n')
        subscribers.add(res)
        res.once('close', () => subscribers.delete(res))
      },
    })

    const disposePreview = ctx.webServer.register({
      kind: 'exact',
      path: PREVIEW_PATH,
      handler: (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }
        publish({ kind: 'tool-call', time: Date.now(), toolName: '预览模式' })
        res.writeHead(204)
        res.end()
      },
    })

    const disposeEventsObserver = ctx.on('session/event', (_session: unknown, event: any) => {
      const data = event?.data
      switch (event?.type) {
        case 'turn/start':
          publish({ kind: 'turn-start', time: event.time, seq: event.seq })
          break
        case 'step/start':
          publish({ kind: 'step-start', time: event.time, seq: event.seq })
          break
        case 'tool/call':
          publish({
            kind: 'tool-call', time: event.time, seq: event.seq,
            toolName: typeof data?.name === 'string' ? data.name : undefined,
            callId: typeof data?.callId === 'string' ? data.callId : undefined,
          })
          break
        case 'tool/result': {
          const firstPart = data?.message?.content?.[0]
          publish({
            kind: 'tool-result', time: event.time, seq: event.seq,
            callId: typeof data?.message?.source?.callId === 'string'
              ? data.message.source.callId : undefined,
            failed: firstPart?.isError === true,
          })
          break
        }
        case 'turn/end':
          publish({ kind: 'turn-end', time: event.time, seq: event.seq })
          break
      }
    }, { global: true })

    return () => {
      disposeEventsObserver()
      disposePreview()
      disposeEvents()
      disposeBridge()
      disposeScript()
      for (const res of subscribers) res.end()
      subscribers.clear()
    }
  }, 'internet-meme: UI event bridge')
}
