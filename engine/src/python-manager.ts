import { PythonShell, type Options } from "python-shell"
import path from "node:path"
import fs from "node:fs"
import { execSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { getEngineRoot } from "./paths.js"

function resolvePythonPath(): string {
  if (process.platform === "win32") {
    const candidates = ["py", "python"]
    for (const name of candidates) {
      try {
        execSync(`${name} --version`, { stdio: "pipe" })
        return name
      } catch {
        continue
      }
    }
    return "python"
  }
  return "python3"
}

export class PythonManager extends EventEmitter {
  private shell: PythonShell | null = null
  private pythonPath: string
  private scriptPath: string
  private commandCounter = 0

  constructor() {
    super()
    this.pythonPath = resolvePythonPath()
    const engineRoot = getEngineRoot()
    const scriptDir = path.join(engineRoot, "python")
    this.scriptPath = path.join(scriptDir, "engine.py")
    if (!fs.existsSync(this.scriptPath)) {
      console.warn("[PythonManager] engine.py not found at:", this.scriptPath)
    }
  }

  start(): void {
    const scriptDir = path.dirname(this.scriptPath)
    const pythonOptions: string[] = ["-u"]
    const scriptArgs: string[] = []
    if (process.platform === "win32" && this.pythonPath === "py") {
      pythonOptions.unshift("-3")
    }
    const options: Options = {
      mode: "json",
      pythonPath: this.pythonPath,
      pythonOptions,
      scriptPath: scriptDir,
      args: scriptArgs,
    }

    this.shell = new PythonShell(path.basename(this.scriptPath), options)

    this.shell.on("message", (message: unknown) => {
      const m = message as { type?: string; message?: string }
      if (m && m.type === "log" && typeof m.message === "string") {
        this.emit("python-log", m.message)
      }
    })

    this.shell.on("error", (err: Error) => {
      console.error("Python error:", err)
    })

    this.shell.on("stderr", (stderr: string) => {
      console.error("Python stderr:", stderr)
    })

    console.log("Python sidecar started.")
  }

  async sendCommand(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.shell) {
        reject(new Error("Python shell not started"))
        return
      }

      const commandId = ++this.commandCounter
      this.shell.send({ id: commandId, command, params })

      const onMessage = (message: unknown) => {
        const m = message as { type?: string; id?: number }
        if (m && m.type === "log") return
        if (m && m.id === commandId) {
          clearTimeout(timeoutId)
          resolve(message)
          this.shell?.removeListener("message", onMessage)
        }
      }

      this.shell.on("message", onMessage)

      const timeoutMs = /transcode|webp|thumb/i.test(command) ? 3600000 : 300000
      const timeoutId = setTimeout(() => {
        this.shell?.removeListener("message", onMessage)
        reject(new Error(`Python command timeout (ID: ${commandId}, Command: ${command})`))
      }, timeoutMs)
    })
  }

  stop(): void {
    if (this.shell) {
      this.shell.end((err) => {
        if (err) console.error("Python stop error:", err)
      })
      this.shell = null
    }
  }
}
