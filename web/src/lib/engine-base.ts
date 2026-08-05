/**
 * Resolves the local engine HTTP base.
 * When the UI is served by the engine itself (same origin on :7777), use "" so
 * fetch("/health") stays same-origin and Chrome Private Network Access never applies.
 */

export function isLocalEngineOrigin(): boolean {
  if (typeof window === "undefined") return false
  const { hostname, port } = window.location
  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost"
  return isLoopback && port === "7777"
}

export function resolveEngineBase(): string {
  const fromEnv =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_ENGINE_URL === "string"
      ? import.meta.env.VITE_ENGINE_URL.trim()
      : ""
  if (fromEnv) return fromEnv.replace(/\/+$/, "")
  if (isLocalEngineOrigin()) return ""
  return "http://127.0.0.1:7777"
}

export const ENGINE_BASE = resolveEngineBase()
