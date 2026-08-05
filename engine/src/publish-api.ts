import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { type DBJob, type DBJobEvent, type DBJobEventInput, QueueManager } from "./queue-manager.js"
import { PythonManager } from "./python-manager.js"
import { addJobAndEmit, updateJobAndEmit } from "./queue-events.js"
import { ensureMediaRuntime } from "./runtime-ensure.js"
import { getInstallRoot } from "./paths.js"

export interface PublishEnqueueBody {
  file_path: string
  project_id?: string
  shot_id?: string
  shot_code?: string
  task_id?: string
  task_name?: string
  tracking_number?: string
  meta?: Record<string, unknown> | string | null
  auto_process?: boolean
}

export interface PublishApiDeps {
  queueManager: QueueManager
  pythonManager: PythonManager
  onQueueEvent?: (event: DBJobEvent) => void
}

export interface PublishProcessResult {
  job: DBJob
  output_path: string
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function encodeMeta(meta: PublishEnqueueBody["meta"]): string | null {
  if (meta == null) return null
  if (typeof meta === "string") {
    const trimmed = meta.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof meta === "object") {
    return JSON.stringify(meta)
  }
  return null
}

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

function addQueueEvent(deps: PublishApiDeps, payload: DBJobEventInput): DBJobEvent {
  const row = deps.queueManager.addJobEvent(payload)
  deps.onQueueEvent?.(row)
  return row
}

function toSequencePatternIfNeeded(filePath: string): string {
  if (!/\.exr$/i.test(filePath)) return filePath
  if (/%\d+d/i.test(filePath)) return filePath
  return filePath.replace(/(\d+)(\.[^./\\]+)$/i, (_match: string, digits: string, ext: string) => {
    return `%0${digits.length}d${ext}`
  })
}

export function validateEnqueueBody(body: unknown): PublishEnqueueBody {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid JSON body")
  }
  const payload = body as Record<string, unknown>
  const filePath = asTrimmedString(payload.file_path)
  if (!filePath) {
    throw new Error("file_path is required")
  }
  return {
    file_path: filePath,
    project_id: asTrimmedString(payload.project_id) ?? undefined,
    shot_id: asTrimmedString(payload.shot_id) ?? undefined,
    shot_code: asTrimmedString(payload.shot_code) ?? undefined,
    task_id: asTrimmedString(payload.task_id) ?? undefined,
    task_name: asTrimmedString(payload.task_name) ?? undefined,
    tracking_number: asTrimmedString(payload.tracking_number) ?? undefined,
    meta:
      payload.meta === null || payload.meta === undefined || typeof payload.meta === "string" || typeof payload.meta === "object"
        ? (payload.meta as PublishEnqueueBody["meta"])
        : undefined,
    auto_process: payload.auto_process === true,
  }
}

export function enqueuePublishJob(body: PublishEnqueueBody, deps: PublishApiDeps): DBJob {
  const now = new Date().toISOString()
  const job: DBJob = {
    id: `pub_${randomBytes(6).toString("hex")}`,
    file_path: body.file_path,
    status: "idle",
    progress: 0,
    project_id: body.project_id,
    shot_id: body.shot_id,
    shot_code: body.shot_code,
    task_id: body.task_id,
    task_name: body.task_name,
    tracking_number: body.tracking_number,
    meta: encodeMeta(body.meta) ?? undefined,
    created_at: now,
  }
  addJobAndEmit(deps.queueManager, job)
  addQueueEvent(deps, {
    job_id: job.id,
    run_id: null,
    attempt: 1,
    level: "info",
    component: "queue",
    stage: "queued",
    event_type: "started",
    message: "Job queued",
    payload_json: JSON.stringify({
      filePath: job.file_path,
      shotCode: job.shot_code ?? null,
      trackingNumber: job.tracking_number ?? null,
    }),
  })
  return job
}

export async function headlessProcessJob(
  jobId: string,
  deps: PublishApiDeps,
  options?: { finalize?: boolean }
): Promise<PublishProcessResult> {
  const finalize = options?.finalize !== false
  const job = deps.queueManager.getJob(jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)
  if (job.status === "transcoding" || job.status === "uploading" || job.status === "submitting") {
    throw new Error(`Job is already processing: ${jobId}`)
  }
  if (!fs.existsSync(job.file_path)) {
    updateJobAndEmit(deps.queueManager, jobId, { status: "error", error: `Input file not found: ${job.file_path}` })
    addQueueEvent(deps, {
      job_id: jobId,
      component: "python",
      stage: "transcode",
      event_type: "failed",
      level: "error",
      message: `Input file not found: ${job.file_path}`,
    })
    throw new Error(`Input file not found: ${job.file_path}`)
  }
  const runId = `${jobId}-${Date.now()}`
  updateJobAndEmit(deps.queueManager, jobId, { status: "transcoding", progress: 10 })
  addQueueEvent(deps, {
    job_id: jobId,
    run_id: runId,
    component: "python",
    stage: "transcode",
    event_type: "started",
    level: "info",
    message: "Headless transcode started",
  })
  try {
    await ensureMediaRuntime(getInstallRoot())
    const outputDir = path.join(os.tmpdir(), "ctrack-publish-review")
    fs.mkdirSync(outputDir, { recursive: true })
    const inputPath = toSequencePatternIfNeeded(job.file_path)
    const outputPath = path.join(
      outputDir,
      `${path.basename(job.file_path, path.extname(job.file_path)).replace(/[^a-zA-Z0-9_-]+/g, "_")}_${job.id}.mp4`
    )
    const result = (await deps.pythonManager.sendCommand("transcode", {
      input_path: inputPath,
      output_path: outputPath,
      options: { fps: 24, burnin: false },
    })) as { status?: string; message?: string; output?: string }
    if (!result || result.status !== "success") {
      throw new Error(result?.message ?? "Transcode failed")
    }
    const normalizedOutputPath = asTrimmedString(result.output) ?? outputPath
    const nextMeta = decodeMeta(job.meta)
    nextMeta.headless = {
      output_path: normalizedOutputPath,
      processed_at: new Date().toISOString(),
    }
    updateJobAndEmit(deps.queueManager, jobId, finalize
      ? {
          status: "completed",
          progress: 100,
          meta: JSON.stringify(nextMeta),
        }
      : {
          status: "uploading",
          progress: 40,
          meta: JSON.stringify(nextMeta),
        })
    addQueueEvent(deps, {
      job_id: jobId,
      run_id: runId,
      component: "python",
      stage: "transcode",
      event_type: "completed",
      level: "info",
      message: "Headless transcode completed",
      payload_json: JSON.stringify({ output_path: normalizedOutputPath }),
    })
    const updated = deps.queueManager.getJob(jobId)
    if (!updated) throw new Error(`Job disappeared after processing: ${jobId}`)
    return { job: updated, output_path: normalizedOutputPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateJobAndEmit(deps.queueManager, jobId, { status: "error", error: message })
    addQueueEvent(deps, {
      job_id: jobId,
      run_id: runId,
      component: "python",
      stage: "transcode",
      event_type: "failed",
      level: "error",
      message,
    })
    throw error
  }
}

export async function headlessProcessNextIdleJob(deps: PublishApiDeps): Promise<PublishProcessResult | null> {
  const jobs = deps.queueManager.getJobs(1000)
  const nextIdle = [...jobs].reverse().find((item) => item.status === "idle")
  if (!nextIdle) return null
  return headlessProcessJob(nextIdle.id, deps)
}
