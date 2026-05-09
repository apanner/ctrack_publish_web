import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import { getEngineRoot, getUserDataDir } from "./paths.js"

/**
 * Loads `.env` before any code reads process.env (S3Manager, etc.).
 * Order:
 * 1. engine/.env — primary for dev + installed layout ({install}\engine\.env)
 * 2. parent/.env — optional single file next to the install folder ({install}\.env)
 * 3. ~/.ctrack-engine/.env — overrides (facility machines)
 * dotenv default: later files only fill vars not already set; user profile uses override.
 */
export function loadEnv(): void {
  const root = getEngineRoot()
  const pathsToTry = [
    path.join(root, ".env"),
    path.join(root, "..", ".env"),
  ]
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p })
    }
  }
  const userEnv = path.join(getUserDataDir(), ".env")
  if (fs.existsSync(userEnv)) {
    dotenv.config({ path: userEnv, override: true })
  }
  dotenv.config()
}

loadEnv()
