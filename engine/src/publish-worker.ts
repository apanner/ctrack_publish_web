import fs from "node:fs"
import { type DBJobEventInput, QueueManager } from "./queue-manager.js"
import { PythonManager } from "./python-manager.js"
import { S3Manager } from "./s3-manager.js"
import { engineBus } from "./event-bus.js"
import { updateJobAndEmit } from "./queue-events.js"
import { headlessProcessJob, type PublishApiDeps } from "./publish-api.js"

interface PublishWorkerDeps {
  queueManager: QueueManager
  pythonManager: PythonManager
  s3Manager: S3Manager
  onQueueEvent?: (event: unknown) => void
}

let workerRunning = false
let workerWanted = false

function decodeMeta(meta: string | undefined): Record<string, unknown> {
  if (!meta) return {}
  try {
    const parsed = JSON.parse(meta) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { raw: meta }
  }
}

function addQueueEvent(deps: PublishWorkerDeps, payload: DBJobEventInput): void {
  const row = deps.queueManager.addJobEvent(payload)
  deps.onQueueEvent?.(row)
}

function toPublishApiDeps(deps: PublishWorkerDeps): PublishApiDeps {
  return {
    queueManager: deps.queueManager,
    pythonManager: deps.pythonManager,
    onQueueEvent: deps.onQueueEvent,
  }
}

async function uploadReviewFile(
  deps: PublishWorkerDeps,
  jobId: string,
  localPath: string,
  bucket: string,
  key: string,
  runId: string
): Promise<void> {
  const provider = deps.s3Manager.getStorageProvider()
  const onProgress = (progress: number) => {
    engineBus.emit("upload-progress", { jobId, key, progress })
    if (progress >= 100 || progress % 20 < 1) {
      updateJobAndEmit(deps.queueManager, jobId, {
        progress: Math.min(95, 50 + Math.floor(progress / 2)),
      })
    }
  }
  if (provider === "hybrid") {
    await deps.s3Manager.uploadFileHybrid(localPath, bucket, key, onProgress)
  } else {
    await deps.s3Manager.uploadFile(localPath, bucket, key, onProgress)
  }
  addQueueEvent(deps, {
    job_id: jobId,
    run_id: runId,
    component: "s3",
    stage: "upload",
    event_type: "completed",
    level: "info",
    message: `Uploaded ${key}`,
    payload_json: JSON.stringify({ key, bucket }),
  })
}

async function processJobFull(jobId: string, deps: PublishWorkerDeps): Promise<void> {
  const job = deps.queueManager.getJob(jobId)
  if (!job || job.status !== "idle") return

  const meta = decodeMeta(job.meta)
  const processMode = String(meta.processMode ?? "full")
  if (processMode === "browser") {
    return
  }

  const runId = `${jobId}-${Date.now()}`
  const uploadPlan = meta.uploadPlan as
    | { bucket?: string; reviewKey?: string; plateKey?: string; thumbKey?: string }
    | undefined

  try {
    if (!uploadPlan?.bucket || !uploadPlan.reviewKey) {
      await headlessProcessJob(jobId, toPublishApiDeps(deps), { finalize: true })
      return
    }

    const transcodeResult = await headlessProcessJob(jobId, toPublishApiDeps(deps), { finalize: false })
    const outputPath = transcodeResult.output_path

    updateJobAndEmit(deps.queueManager, jobId, { status: "uploading", progress: 50 })
    addQueueEvent(deps, {
      job_id: jobId,
      run_id: runId,
      component: "s3",
      stage: "upload",
      event_type: "started",
      level: "info",
      message: "Uploading review media",
    })

    if (fs.existsSync(outputPath)) {
      await uploadReviewFile(deps, jobId, outputPath, uploadPlan.bucket, uploadPlan.reviewKey, runId)
    }

    if (uploadPlan.plateKey) {
      const platePath = String(meta.platePath ?? job.file_path)
      if (fs.existsSync(platePath)) {
        await uploadReviewFile(deps, jobId, platePath, uploadPlan.bucket, uploadPlan.plateKey, runId)
      }
    }

    if (uploadPlan.thumbKey && meta.thumbPath && fs.existsSync(String(meta.thumbPath))) {
      await uploadReviewFile(deps, jobId, String(meta.thumbPath), uploadPlan.bucket, uploadPlan.thumbKey, runId)
    }

    updateJobAndEmit(deps.queueManager, jobId, { status: "completed", progress: 100 })
    addQueueEvent(deps, {
      job_id: jobId,
      run_id: runId,
      component: "queue",
      stage: "complete",
      event_type: "completed",
      level: "info",
      message: "Engine publish pipeline completed",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateJobAndEmit(deps.queueManager, jobId, { status: "error", error: message })
    addQueueEvent(deps, {
      job_id: jobId,
      run_id: runId,
      component: "queue",
      stage: "error",
      event_type: "failed",
      level: "error",
      message,
    })
  }
}

export function dispatchJobAsync(jobId: string, deps: PublishWorkerDeps): void {
  workerWanted = true
  void processJobFull(jobId, deps).finally(() => {
    void drainWorkerQueue(deps)
  })
}

async function drainWorkerQueue(deps: PublishWorkerDeps): Promise<void> {
  if (workerRunning) return
  workerRunning = true
  try {
    while (workerWanted) {
      const jobs = deps.queueManager.getJobs(200)
      const nextIdle = [...jobs].reverse().find((j) => j.status === "idle" && decodeMeta(j.meta).processMode !== "browser")
      if (!nextIdle) break
      await processJobFull(nextIdle.id, deps)
    }
  } finally {
    workerRunning = false
    workerWanted = false
  }
}

export function startWorkerLoop(deps: PublishWorkerDeps): void {
  void drainWorkerQueue(deps)
}

export function listIdleJobIds(queueManager: QueueManager): string[] {
  return queueManager
    .getJobs(200)
    .filter((j) => j.status === "idle")
    .map((j) => j.id)
}
