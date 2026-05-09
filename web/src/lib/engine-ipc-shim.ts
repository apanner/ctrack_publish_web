/**
 * Bridges the desktop `window.ipcRenderer` API to the local CTrack engine HTTP server.
 * Loaded first from `main.tsx` so existing hooks keep working in the web + hybrid setup.
 */

const ENGINE_BASE: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ENGINE_URL) ||
  "http://127.0.0.1:7777"

const bus = new EventTarget()

let stream: EventSource | null = null

function ensureEngineStream(): void {
  if (stream && stream.readyState !== EventSource.CLOSED) return
  try {
    const es = new EventSource(`${ENGINE_BASE}/api/stream`)
    stream = es
    es.addEventListener("python-log", (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data as string) as string
      bus.dispatchEvent(new CustomEvent("python-log", { detail: { args: [msg] as unknown[] } }))
    })
    es.addEventListener("upload-progress", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data as string) as { key: string; progress: number }
      bus.dispatchEvent(new CustomEvent("upload-progress", { detail: { args: [data] as unknown[] } }))
    })
    es.addEventListener("queue-log", (ev) => {
      const row = JSON.parse((ev as MessageEvent).data as string) as unknown
      bus.dispatchEvent(new CustomEvent("queue:log-appended", { detail: { args: [row] as unknown[] } }))
    })
    es.onerror = () => {
      es.close()
      stream = null
      window.setTimeout(ensureEngineStream, 2000)
    }
  } catch {
    window.setTimeout(ensureEngineStream, 2000)
  }
}

function emitLocal(channel: string, ...args: unknown[]): void {
  bus.dispatchEvent(new CustomEvent(channel, { detail: { args } }))
}

async function invokeIpc(channel: string, payload?: unknown): Promise<unknown> {
  if (channel === "open-external-url") {
    const url = String(payload ?? "")
    if (url) window.open(url, "_blank", "noopener,noreferrer")
    return true
  }

  ensureEngineStream()

  const res = await fetch(`${ENGINE_BASE}/api/ipc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, payload }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Engine error ${res.status}`)
  }
  return res.json() as Promise<unknown>
}

const ipcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const payload = args.length > 0 ? args[0] : undefined
    return invokeIpc(channel, payload)
  },

  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void {
    ensureEngineStream()
    const h = ((e: Event) => {
      const ce = e as CustomEvent<{ args: unknown[] }>
      listener(null, ...ce.detail.args)
    }) as EventListener
    bus.addEventListener(channel, h)
    return () => bus.removeEventListener(channel, h)
  },

  off(channel: string, listener?: (...args: unknown[]) => void): void {
    if (!listener) return
    bus.removeEventListener(channel, listener as EventListener)
  },

  removeListener(channel: string, listener?: (...args: unknown[]) => void): void {
    ipcRenderer.off(channel, listener)
  },

  send(..._args: unknown[]): void {
    /* no-op: renderer rarely uses send in this app */
  },
}

;(window as unknown as { ipcRenderer: typeof ipcRenderer }).ipcRenderer = ipcRenderer

export { ENGINE_BASE, ipcRenderer, emitLocal, ensureEngineStream }
