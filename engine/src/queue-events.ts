import { engineBus } from "./event-bus.js"
import { type DBJob, QueueManager } from "./queue-manager.js"

/** Broadcast job row changes over SSE so the hosted web UI stays in sync. */
export function emitJobAdded(job: DBJob): void {
  engineBus.emit("queue:job-added", job)
}

export function emitJobUpdated(job: DBJob): void {
  engineBus.emit("queue:job-updated", job)
}

export function emitJobRemoved(id: string): void {
  engineBus.emit("queue:job-removed", { id })
}

export function addJobAndEmit(queueManager: QueueManager, job: DBJob): void {
  queueManager.addJob(job)
  emitJobAdded(job)
}

export function updateJobAndEmit(queueManager: QueueManager, id: string, updates: Partial<DBJob>): DBJob | null {
  queueManager.updateJob(id, updates)
  const job = queueManager.getJob(id)
  if (job) emitJobUpdated(job)
  return job
}

export function deleteJobAndEmit(queueManager: QueueManager, id: string): void {
  queueManager.deleteJob(id)
  emitJobRemoved(id)
}
