import Database from "better-sqlite3"
import path from "path"
import { getUserDataDir } from "./paths.js"

export interface DBJob {
  id: string
  file_path: string
  status: string
  progress: number
  error?: string
  project_id?: string
  shot_id?: string
  shot_code?: string
  task_id?: string
  task_name?: string
  tracking_number?: string
  meta?: string
  created_at: string
}

export type JobLogLevel = "info" | "warn" | "error"
export type JobLogComponent = "renderer" | "main" | "python" | "s3" | "db" | "queue"
export type JobLogEventType = "log" | "started" | "progress" | "completed" | "failed" | "heartbeat"

export interface DBJobEvent {
  id: number
  event_id: string
  job_id: string
  run_id: string | null
  attempt: number
  level: JobLogLevel
  component: JobLogComponent
  stage: string | null
  event_type: JobLogEventType
  message: string
  payload_json: string | null
  created_at: string
}

export interface DBJobEventInput {
  job_id: string
  run_id?: string | null
  attempt?: number
  level?: JobLogLevel
  component?: JobLogComponent
  stage?: string | null
  event_type?: JobLogEventType
  message: string
  payload_json?: string | null
}

function inferLevelFromMessage(message: string): JobLogLevel {
  const upper = message.toUpperCase()
  if (upper.includes("ERROR") || upper.includes("FAILED")) return "error"
  if (upper.includes("WARN") || upper.includes("SKIP")) return "warn"
  return "info"
}

export class QueueManager {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(getUserDataDir(), "ctrack_queue.db")
    this.db = new Database(dbPath)
    this.db.pragma("foreign_keys = ON")
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        error TEXT,
        project_id TEXT,
        shot_id TEXT,
        task_id TEXT,
        meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        run_id TEXT,
        attempt INTEGER DEFAULT 1,
        level TEXT NOT NULL DEFAULT 'info',
        component TEXT NOT NULL DEFAULT 'renderer',
        stage TEXT,
        event_type TEXT NOT NULL DEFAULT 'log',
        message TEXT NOT NULL,
        payload_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_job_events_job_created
      ON job_events(job_id, created_at)
    `)
    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN shot_code TEXT")
    } catch {
      /* exists */
    }
    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN tracking_number TEXT")
    } catch {
      /* exists */
    }
    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN task_name TEXT")
    } catch {
      /* exists */
    }
    try {
      this.db.exec("ALTER TABLE jobs ADD COLUMN meta TEXT")
    } catch {
      /* exists */
    }
  }

  addJob(job: DBJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, file_path, status, progress, error, project_id, shot_id, shot_code, task_id, task_name, tracking_number, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      job.id,
      job.file_path,
      job.status,
      job.progress,
      job.error || null,
      job.project_id || null,
      job.shot_id || null,
      job.shot_code || null,
      job.task_id || null,
      job.task_name || null,
      job.tracking_number || null,
      job.meta ?? null
    )
  }

  addJobEvent(event: DBJobEventInput): DBJobEvent {
    const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const level = event.level ?? inferLevelFromMessage(event.message)
    const component = event.component ?? "renderer"
    const eventType = event.event_type ?? "log"
    const attempt = event.attempt ?? 1
    const stmt = this.db.prepare(`
      INSERT INTO job_events (event_id, job_id, run_id, attempt, level, component, stage, event_type, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      eventId,
      event.job_id,
      event.run_id ?? null,
      attempt,
      level,
      component,
      event.stage ?? null,
      eventType,
      event.message,
      event.payload_json ?? null
    )
    const inserted = this.db.prepare("SELECT * FROM job_events WHERE id = ?").get(result.lastInsertRowid) as DBJobEvent
    return inserted
  }

  addJobLog(jobId: string, message: string, extras?: Partial<Omit<DBJobEventInput, "job_id" | "message">>): DBJobEvent {
    const stmt = this.db.prepare("INSERT INTO job_logs (job_id, message) VALUES (?, ?)")
    stmt.run(jobId, message)
    return this.addJobEvent({
      job_id: jobId,
      message,
      level: extras?.level,
      component: extras?.component,
      stage: extras?.stage,
      event_type: extras?.event_type,
      run_id: extras?.run_id,
      attempt: extras?.attempt,
      payload_json: extras?.payload_json,
    })
  }

  getJobLogs(jobId: string): unknown[] {
    return this.db.prepare("SELECT id, job_id, message, created_at FROM job_events WHERE job_id = ? ORDER BY id ASC").all(jobId)
  }

  getJobEvents(jobId: string, limit = 1000): DBJobEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT ?")
      .all(jobId, limit) as DBJobEvent[]
    return rows.reverse()
  }

  getJobEventsAfter(jobId: string, afterId: number): DBJobEvent[] {
    return this.db
      .prepare("SELECT * FROM job_events WHERE job_id = ? AND id > ? ORDER BY id ASC")
      .all(jobId, afterId) as DBJobEvent[]
  }

  updateJob(id: string, updates: Partial<DBJob>): void {
    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(", ")
    const values = Object.values(updates)
    const stmt = this.db.prepare(`UPDATE jobs SET ${fields} WHERE id = ?`)
    stmt.run(...values, id)
  }

  getJobs(limit = 50): DBJob[] {
    return this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as DBJob[]
  }

  clearCompleted(): void {
    this.db.prepare('DELETE FROM jobs WHERE status = "completed"').run()
  }

  deleteJob(id: string): void {
    this.db.prepare("DELETE FROM jobs WHERE id = ?").run(id)
  }

  deleteAllJobs(): void {
    this.db.prepare("DELETE FROM jobs").run()
  }
}
