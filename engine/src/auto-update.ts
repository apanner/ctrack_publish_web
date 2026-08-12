/**
 * Background update loop: check manifest -> download -> silent Inno apply.
 * Requires workstation pairing (device credential for engine-download).
 * Toggle: tray-settings.autoDownloadAndUpdate (default on) or CTRACK_AUTO_UPDATE=0 to force off.
 */

import { getAuthSnapshot } from "./auth-store.js"
import { ENGINE_VERSION } from "./generated/engine-version.js"
import type { QueueManager } from "./queue-manager.js"
import { loadTraySettings } from "./tray-settings.js"
import { applyDownloadedUpdate, checkForUpdate, downloadUpdate } from "./update-service.js"

const BUSY = new Set(["transcoding", "uploading", "submitting", "processing"])

export interface AutoUpdateDeps {
  queueManager: QueueManager
}

let loopStarted = false
let applying = false

function isAutoUpdateEnabled(): boolean {
  const raw = (process.env.CTRACK_AUTO_UPDATE || "1").trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false
  try {
    return loadTraySettings().autoDownloadAndUpdate !== false
  } catch {
    return true
  }
}

function hasBusyJobs(queueManager: QueueManager): boolean {
  try {
    return queueManager.getJobs(200).some((job) => BUSY.has(String(job.status || "").toLowerCase()))
  } catch {
    return false
  }
}

export async function runAutoUpdateOnce(deps: AutoUpdateDeps): Promise<void> {
  if (!isAutoUpdateEnabled()) return
  if (applying) return
  if (!getAuthSnapshot().paired) {
    console.log("[ctrack-engine] auto-update skipped: workstation not paired (Sign in once)")
    return
  }
  if (hasBusyJobs(deps.queueManager)) {
    console.log("[ctrack-engine] auto-update deferred: publish job in progress")
    return
  }

  const check = await checkForUpdate(ENGINE_VERSION, { product: "engine" })
  if (!check.updateAvailable || !check.remoteVersion) {
    console.log(`[ctrack-engine] auto-update: up to date (local ${ENGINE_VERSION})`)
    return
  }

  console.log(
    `[ctrack-engine] auto-update: ${ENGINE_VERSION} -> ${check.remoteVersion} - downloading...`
  )
  applying = true
  try {
    const downloaded = await downloadUpdate(ENGINE_VERSION)
    if (!downloaded.updateAvailable || !downloaded.pendingUpdate) {
      console.warn("[ctrack-engine] auto-update: download returned no package")
      return
    }
    const applied = await applyDownloadedUpdate()
    if (applied.launched) {
      console.log(
        `[ctrack-engine] auto-update: silent installer launched for v${downloaded.remoteVersion}`
      )
    } else {
      console.warn(`[ctrack-engine] auto-update: ${applied.message}`)
    }
  } finally {
    applying = false
  }
}

/** Start delayed first check + periodic polls (default every 4 hours). */
export function startAutoUpdateLoop(deps: AutoUpdateDeps): void {
  if (loopStarted) return
  loopStarted = true
  if (!isAutoUpdateEnabled()) {
    console.log("[ctrack-engine] auto-update disabled (CTRACK_AUTO_UPDATE=0 or settings)")
    return
  }

  const pollMs = Math.max(
    15 * 60 * 1000,
    Number(process.env.CTRACK_AUTO_UPDATE_INTERVAL_MS || 4 * 60 * 60 * 1000) || 4 * 60 * 60 * 1000
  )
  const firstDelayMs = Math.max(10_000, Number(process.env.CTRACK_AUTO_UPDATE_START_DELAY_MS || 45_000) || 45_000)

  console.log(
    `[ctrack-engine] auto-update armed (first check in ${Math.round(firstDelayMs / 1000)}s, then every ${Math.round(pollMs / 3600000)}h)`
  )

  const tick = () => {
    void runAutoUpdateOnce(deps).catch((err) => {
      console.warn("[ctrack-engine] auto-update failed:", err instanceof Error ? err.message : err)
    })
  }

  setTimeout(tick, firstDelayMs)
  setInterval(tick, pollMs)
}
