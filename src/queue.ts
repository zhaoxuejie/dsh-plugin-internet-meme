export type PulseKind = 'turn-start' | 'step-start' | 'tool-call' | 'tool-result' | 'turn-end'
export type Pulse = { kind: PulseKind, toolName?: string, callId?: string, failed?: boolean, previewId?: string }
export type QueuedMeme = Pulse & { message: string, repeat: number }

export function enqueue(queue: QueuedMeme[], next: QueuedMeme) {
  const last = queue.at(-1)
  // Without session scoping, only combine notifications for the same known tool call.
  const sameToolCall = next.kind === 'tool-call' && !!next.callId && !!next.toolName && last?.callId === next.callId && last.toolName === next.toolName
  if (!next.previewId && !last?.previewId && last?.kind === next.kind && (next.kind === 'step-start' || sameToolCall)) last.repeat += next.repeat
  else if (next.previewId) queue.unshift(next)
  else queue.push(next)
  while (queue.length > 8) {
    const disposable = queue.findIndex((item) => !item.previewId && item.kind !== 'turn-end' && item.failed !== true)
    queue.splice(disposable >= 0 ? disposable : 0, 1)
  }
}
