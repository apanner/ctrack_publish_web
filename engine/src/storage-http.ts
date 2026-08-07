import fs from "node:fs"
import https from "node:https"
import path from "node:path"
import { createRequire } from "node:module"
import { NodeHttpHandler } from "@smithy/node-http-handler"

const require = createRequire(import.meta.url)

export function bootstrapWindowsTls(): void {
  if (process.platform !== "win32") return
  try {
    require("win-ca").inject("+")
  } catch (error) {
    console.warn("[ctrack] win-ca inject skipped:", error instanceof Error ? error.message : error)
  }
}

export function createStorageRequestHandler(): NodeHttpHandler {
  return new NodeHttpHandler({
    requestTimeout: 600_000,
    connectionTimeout: 30_000,
    socketTimeout: 600_000,
    httpsAgent: new https.Agent({
      minVersion: "TLSv1.2",
      keepAlive: true,
    }),
  })
}

export function trimEnv(value: string | undefined | null): string {
  if (!value) return ""
  let trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function normalizeEndpoint(endpoint: string | null | undefined): string | null {
  const trimmed = trimEnv(endpoint)
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, "")
}

export async function readUploadBody(filePath: string): Promise<Buffer> {
  return await fs.promises.readFile(filePath)
}
