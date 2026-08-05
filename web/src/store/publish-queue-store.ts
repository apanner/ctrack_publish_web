import { create } from "zustand"
import type { PublishJob, PublishStatus } from "@/hooks/usePublishQueue"
import { ensureEngineStream } from "@/lib/engine-ipc-shim"

function mapDbJob(j: Record<string, unknown>): PublishJob {
  let meta: PublishJob["meta"] = undefined
  try {
    if (j.meta && typeof j.meta === "string") meta = JSON.parse(j.meta) as PublishJob["meta"]
  } catch {
    /* ignore */
  }
  return {
    id: String(j.id),
    filePath: String(j.file_path ?? ""),
    status: String(j.status ?? "idle") as PublishStatus,
    progress: Number(j.progress ?? 0),
    error: j.error ? String(j.error) : undefined,
    context: {
      projectId: j.project_id ? String(j.project_id) : undefined,
      shotId: j.shot_id ? String(j.shot_id) : undefined,
      shotCode: j.shot_code ? String(j.shot_code) : undefined,
      taskId: j.task_id ? String(j.task_id) : undefined,
      taskName: j.task_name ? String(j.task_name) : "Task",
      trackingNumber: j.tracking_number ? String(j.tracking_number) : undefined,
    },
    meta,
    size: Number(j.size ?? 0),
  }
}

interface PublishQueueState {
  queue: PublishJob[]
  hydrated: boolean
  setQueue: (queue: PublishJob[]) => void
  patchJob: (id: string, updates: Partial<PublishJob>) => void
  upsertJob: (job: PublishJob) => void
  removeJob: (id: string) => void
  hydrateFromEngine: () => Promise<void>
  subscribeEngineEvents: () => () => void
}

export const usePublishQueueStore = create<PublishQueueState>((set, get) => ({
  queue: [],
  hydrated: false,

  setQueue: (queue) => set({ queue, hydrated: true }),

  patchJob: (id, updates) =>
    set((state) => ({
      queue: state.queue.map((job) => (job.id === id ? { ...job, ...updates } : job)),
    })),

  upsertJob: (job) =>
    set((state) => {
      const idx = state.queue.findIndex((j) => j.id === job.id)
      if (idx === -1) return { queue: [job, ...state.queue], hydrated: true }
      const next = [...state.queue]
      next[idx] = { ...next[idx], ...job }
      return { queue: next, hydrated: true }
    }),

  removeJob: (id) => set((state) => ({ queue: state.queue.filter((j) => j.id !== id) })),

  hydrateFromEngine: async () => {
    const ipc = (window as unknown as { ipcRenderer?: { invoke: (c: string, p?: unknown) => Promise<unknown> } })
      .ipcRenderer
    if (!ipc?.invoke) return
    try {
      const jobs = (await ipc.invoke("queue:get-jobs")) as Record<string, unknown>[]
      const mapped = jobs.map(mapDbJob)
      set({ queue: mapped, hydrated: true })
    } catch (e) {
      console.warn("[publish-queue] hydrate failed", e)
    }
  },

  subscribeEngineEvents: () => {
    ensureEngineStream()
    const ipc = (window as unknown as { ipcRenderer?: { on: (c: string, fn: (e: unknown, ...args: unknown[]) => void) => () => void } })
      .ipcRenderer
    if (!ipc?.on) return () => undefined

    const onAdded = (_e: unknown, row: Record<string, unknown>) => {
      get().upsertJob(mapDbJob(row))
    }
    const onUpdated = (_e: unknown, row: Record<string, unknown>) => {
      get().upsertJob(mapDbJob(row))
    }
    const onRemoved = (_e: unknown, payload: { id?: string }) => {
      if (payload?.id) get().removeJob(payload.id)
    }
    const onReconnect = () => {
      void get().hydrateFromEngine()
    }

    const unsubAdded = ipc.on("queue:job-added", onAdded)
    const unsubUpdated = ipc.on("queue:job-updated", onUpdated)
    const unsubRemoved = ipc.on("queue:job-removed", onRemoved)
    const unsubConnected = ipc.on("engine:stream-connected", onReconnect)

    return () => {
      unsubAdded?.()
      unsubUpdated?.()
      unsubRemoved?.()
      unsubConnected?.()
    }
  },
}))
