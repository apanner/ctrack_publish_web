/**
 * Resolves the local engine HTTP base.
 * When the UI is served by the engine itself (same origin on :7777), use "" so
 * fetch("/health") stays same-origin and Chrome Private Network Access never applies.
 */

export const DEFAULT_ENGINE_ORIGIN = "http://127.0.0.1:7777"

export function isLocalEngineOrigin(): boolean {
  if (typeof window === "undefined") return false
  const { hostname, port } = window.location
  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost"
  return isLoopback && port === "7777"
}

export function resolveEngineBase(): string {
  // Never bake an absolute engine URL into builds served from the gateway —
  // VITE_ENGINE_URL would force cross-origin fetches and Chrome PNA.
  if (isLocalEngineOrigin()) return ""
  const fromEnv =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_ENGINE_URL === "string"
      ? import.meta.env.VITE_ENGINE_URL.trim()
      : ""
  if (fromEnv) return fromEnv.replace(/\/+$/, "")
  return DEFAULT_ENGINE_ORIGIN
}

/** Absolute URL for display / tray / hosted→local handoff. */
export function displayEngineBase(): string {
  if (isLocalEngineOrigin() && typeof window !== "undefined") {
    return window.location.origin
  }
  return resolveEngineBase() || DEFAULT_ENGINE_ORIGIN
}

/** Join engine base with a path (`""` + `/health` → `/health`). */
export function engineUrl(path: string): string {
  const base = resolveEngineBase().replace(/\/+$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${base}${p}`
}

export const ENGINE_BASE = resolveEngineBase()
