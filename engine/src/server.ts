import "./env.js"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import http from "node:http"
import { fileURLToPath } from "node:url"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import express, { type Request, type Response, type NextFunction } from "express"
import cors from "cors"
import multer from "multer"
import { loadEnv } from "./env.js"
import { getEngineRoot, getUserDataDir } from "./paths.js"
import {
  SETUP_ENV_KEYS,
  getUserEnvPath,
  isSetupComplete,
  mergeUserEnvFile,
} from "./setup-config.js"
import { QueueManager, type DBJob, type DBJobEventInput } from "./queue-manager.js"
import { S3Manager } from "./s3-manager.js"
import { PythonManager } from "./python-manager.js"
import { getVideoMetadata } from "./video-metadata.js"
import { processPathsOrFolders, processFilePathsOnly } from "./staging.js"
import { engineBus } from "./event-bus.js"

const execAsync = promisify(exec)

const PORT = Number(process.env.CTRACK_ENGINE_PORT || 7777)
const HOST = process.env.CTRACK_ENGINE_HOST || "127.0.0.1"

const SETTINGS_PATH = path.join(getUserDataDir(), "settings.json")
const STAGING_PATH = path.join(getUserDataDir(), "staging.json")

const queueManager = new QueueManager()
let s3Manager = new S3Manager()
const pythonManager = new PythonManager()

function refreshManagersAfterEnvSave(): void {
  for (const key of SETUP_ENV_KEYS) {
    delete process.env[key]
  }
  loadEnv()
  s3Manager = new S3Manager()
}

pythonManager.on("python-log", (msg: string) => {
  engineBus.emit("python-log", msg)
})

function wrapAddJobEvent(payload: DBJobEventInput) {
  const row = queueManager.addJobEvent(payload)
  engineBus.emit("queue:log-appended", row)
  return row
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CTRACK_WEB_ORIGINS
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean)
  }
  return ["http://localhost:5173", "http://localhost:3001", "http://127.0.0.1:5173", "http://127.0.0.1:3001"]
}

const app = express()
app.use(
  cors({
    origin: parseCorsOrigins(),
    credentials: true,
  })
)
app.use(express.json({ limit: "50mb" }))

function localhostSetupOnly(req: Request, res: Response, next: NextFunction): void {
  const raw = req.socket.remoteAddress ?? ""
  const ok =
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("127.0.0.1")
  if (!ok) {
    res.status(403).json({ error: "Setup routes are only allowed from localhost" })
    return
  }
  next()
}

app.get("/api/setup/status", (_req, res) => {
  res.json({
    complete: isSetupComplete(),
    userEnvPath: getUserEnvPath(),
  })
})

app.get("/api/setup/runtime-config", (_req, res) => {
  res.json({
    supabaseUrl: process.env.VITE_SUPABASE_URL?.trim() ?? "",
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
  })
})

app.post("/api/setup/save", localhostSetupOnly, (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Invalid JSON body" })
      return
    }
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(body)) {
      flat[k] = typeof v === "string" ? v : String(v ?? "")
    }
    mergeUserEnvFile(flat)
    refreshManagersAfterEnvSave()
    res.json({ ok: true, complete: isSetupComplete() })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: message })
  }
})

app.get("/health", (_req, res) => {
  const engineRoot = getEngineRoot()
  const py = path.join(engineRoot, "python", "engine.py")
  res.json({
    status: "ok",
    service: "ctrack-engine",
    version: "0.1.0",
    pythonReady: fs.existsSync(py),
    platform: process.platform,
    engineRoot,
    setupComplete: isSetupComplete(),
  })
})

app.post("/api/stage/files", (req, res) => {
  const stagingBase = path.join(os.tmpdir(), `ctrack-stage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
  fs.mkdirSync(stagingBase, { recursive: true })
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, stagingBase),
      filename: (_r, file, cb) => cb(null, file.originalname.replace(/[/\\]/g, "_")),
    }),
    limits: { files: 5000 },
  })
  upload.array("files", 5000)(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: String(err) })
      return
    }
    const files = req.files as Express.Multer.File[] | undefined
    if (!files?.length) {
      res.status(400).json({ error: "No files" })
      return
    }
    const result = processPathsOrFolders([stagingBase])
    res.json(result)
  })
})

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`)
  }

  const onPy = (msg: string) => send("python-log", msg)
  const onUp = (d: unknown) => send("upload-progress", d)
  const onQueue = (d: unknown) => send("queue-log", d)

  engineBus.on("python-log", onPy)
  engineBus.on("upload-progress", onUp)
  engineBus.on("queue:log-appended", onQueue)

  send("connected", {})
  const ping = setInterval(() => send("ping", {}), 25000)

  req.on("close", () => {
    clearInterval(ping)
    engineBus.off("python-log", onPy)
    engineBus.off("upload-progress", onUp)
    engineBus.off("queue:log-appended", onQueue)
  })
})

app.post("/api/ipc", async (req, res) => {
  const channel = req.body?.channel as string
  const payload = req.body?.payload as unknown

  try {
    const out = await dispatchIpc(channel, payload)
    res.json(out)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ipc]", channel, message)
    res.status(500).json({ error: message })
  }
})

async function dispatchIpc(channel: string, payload: unknown): Promise<unknown> {
  switch (channel) {
    case "python-command": {
      const body = payload as { command: string; params?: Record<string, unknown> }
      return await pythonManager.sendCommand(body.command, body.params ?? {})
    }
    case "python:install-deps": {
      const body = payload as { modules: string[] }
      const pythonExe = process.platform === "win32" ? "python" : "python3"
      const { stdout, stderr } = await execAsync(`${pythonExe} -m pip install ${body.modules.join(" ")}`)
      return stdout || stderr
    }
    case "upload-s3": {
      const body = payload as { filePath: string; bucketName: string; key: string }
      const provider = String(process.env.STORAGE_PROVIDER || "").toLowerCase()
      const onProgress = (progress: number) => {
        engineBus.emit("upload-progress", { key: body.key, progress })
      }
      if (provider === "hybrid") {
        return await s3Manager.uploadFileHybrid(body.filePath, body.bucketName, body.key, onProgress)
      }
      return await s3Manager.uploadFile(body.filePath, body.bucketName, body.key, onProgress)
    }
    case "select-directory":
      return null
    case "dialog:open-files":
      return []
    case "dialog:open-folder-files":
      return { items: [], unsupported: [] }
    case "queue:get-jobs":
      return queueManager.getJobs()
    case "queue:add-job": {
      queueManager.addJob(payload as DBJob)
      return true
    }
    case "queue:update-job": {
      const body = payload as { id: string; updates: Partial<DBJob> }
      queueManager.updateJob(body.id, body.updates)
      return true
    }
    case "queue:remove-job":
      queueManager.deleteJob(String(payload))
      return true
    case "queue:clear":
      queueManager.clearCompleted()
      return true
    case "queue:purge":
      queueManager.deleteAllJobs()
      return true
    case "queue:add-log": {
      const body = payload as { jobId: string; message: string }
      return wrapAddJobEvent({
        job_id: body.jobId,
        message: body.message,
        component: "renderer",
        event_type: "log",
      })
    }
    case "queue:add-event":
      return wrapAddJobEvent(payload as DBJobEventInput)
    case "queue:get-logs":
      return queueManager.getJobLogs(String(payload))
    case "queue:get-events": {
      const body = payload as { jobId: string; limit?: number }
      return queueManager.getJobEvents(body.jobId, body.limit ?? 1000)
    }
    case "staging:read": {
      try {
        const raw = fs.readFileSync(STAGING_PATH, "utf-8")
        return JSON.parse(raw)
      } catch {
        return { items: [], formData: null }
      }
    }
    case "staging:write": {
      fs.writeFileSync(STAGING_PATH, JSON.stringify(payload, null, 2), "utf-8")
      return true
    }
    case "staging:clear": {
      try {
        fs.unlinkSync(STAGING_PATH)
      } catch {
        /* ignore */
      }
      return true
    }
    case "staging:process-files": {
      const body = payload as { filePaths: string[] }
      return processFilePathsOnly(body.filePaths).items
    }
    case "staging:process-paths-or-folders": {
      const body = payload as { paths: string[] }
      return processPathsOrFolders(body.paths)
    }
    case "settings:read": {
      try {
        const raw = fs.readFileSync(SETTINGS_PATH, "utf-8")
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    case "settings:write": {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2), "utf-8")
      return true
    }
    case "app:get-temp-path":
      return os.tmpdir()
    case "app:ensure-dir": {
      fs.mkdirSync(String(payload), { recursive: true })
      return payload
    }
    case "video-metadata":
      return await getVideoMetadata(String(payload))
    case "fs:delete-file": {
      try {
        const fp = String(payload)
        if (fs.existsSync(fp)) fs.unlinkSync(fp)
        return true
      } catch {
        return false
      }
    }
    case "notify":
      console.log("[notify]", payload)
      return true
    case "auth:get-pending-code":
      return null
    case "open-external-url":
      return { delegateToBrowser: true, url: String(payload) }
    default:
      throw new Error(`Unknown IPC channel: ${channel}`)
  }
}

let httpServer: http.Server | null = null

function isRunAsNodeMainScript(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    const selfPath = path.resolve(fileURLToPath(import.meta.url))
    const entryPath = path.resolve(entry)
    return selfPath === entryPath
  } catch {
    return false
  }
}

export function startEngine(): Promise<http.Server> {
  pythonManager.start()
  return new Promise((resolve, reject) => {
    try {
      httpServer = app.listen(PORT, HOST, () => {
        console.log(`[ctrack-engine] http://${HOST}:${PORT}`)
        console.log(`[ctrack-engine] CORS origins:`, parseCorsOrigins().join(", "))
        resolve(httpServer!)
      })
      httpServer.on("error", reject)
    } catch (e) {
      reject(e)
    }
  })
}

export function stopEngine(): Promise<void> {
  pythonManager.stop()
  return new Promise((resolve, reject) => {
    if (!httpServer) {
      resolve()
      return
    }
    httpServer.close((err) => {
      httpServer = null
      if (err) reject(err)
      else resolve()
    })
  })
}

if (isRunAsNodeMainScript()) {
  startEngine().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
