import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const DPAPI_SUFFIX = ".dpapi"

function getDpapiPath(credentialsPath: string): string {
  return `${credentialsPath}${DPAPI_SUFFIX}`
}

function isWindows(): boolean {
  return process.platform === "win32"
}

async function runPowerShell(script: string): Promise<string> {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
  const psExe = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  const { stdout } = await execFileAsync(psExe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

export async function protectCredentialsJson(credentialsPath: string, json: string): Promise<void> {
  if (!isWindows()) {
    fs.writeFileSync(credentialsPath, json, "utf8")
    return
  }
  const b64 = Buffer.from(json, "utf8").toString("base64")
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$bytes = [Convert]::FromBase64String('${b64}')`,
    "$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')",
    "[Convert]::ToBase64String($protected)",
  ].join("; ")
  const protectedB64 = await runPowerShell(script)
  fs.writeFileSync(getDpapiPath(credentialsPath), `${protectedB64}\n`, "utf8")
  try {
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath)
  } catch {
    /* ignore */
  }
}

export async function unprotectCredentialsJson(credentialsPath: string): Promise<string | null> {
  const dpapiPath = getDpapiPath(credentialsPath)
  if (isWindows() && fs.existsSync(dpapiPath)) {
    const protectedB64 = fs.readFileSync(dpapiPath, "utf8").trim()
    const script = [
      "Add-Type -AssemblyName System.Security",
      `$protected = [Convert]::FromBase64String('${protectedB64}')`,
      "$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, 'CurrentUser')",
      "[Text.Encoding]::UTF8.GetString($bytes)",
    ].join("; ")
    return await runPowerShell(script)
  }
  if (fs.existsSync(credentialsPath)) {
    return fs.readFileSync(credentialsPath, "utf8")
  }
  return null
}

export function readProtectedCredentialsSync(credentialsPath: string): string | null {
  const dpapiPath = getDpapiPath(credentialsPath)
  if (isWindows() && fs.existsSync(dpapiPath)) {
    const protectedB64 = fs.readFileSync(dpapiPath, "utf8").trim()
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
    const psExe = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const script = [
      "Add-Type -AssemblyName System.Security",
      `$protected = [Convert]::FromBase64String('${protectedB64}')`,
      "$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, 'CurrentUser')",
      "[Text.Encoding]::UTF8.GetString($bytes)",
    ].join("; ")
    return execFileSync(psExe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
    }).trim()
  }
  if (fs.existsSync(credentialsPath)) {
    return fs.readFileSync(credentialsPath, "utf8")
  }
  return null
}

export async function migratePlainCredentialsToDpapi(credentialsPath: string): Promise<boolean> {
  if (!isWindows()) return false
  if (!fs.existsSync(credentialsPath)) return false
  if (fs.existsSync(getDpapiPath(credentialsPath))) return false
  const plain = fs.readFileSync(credentialsPath, "utf8")
  await protectCredentialsJson(credentialsPath, plain)
  return true
}
