import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface EngineCredentials {
  version: number
  deviceId: string
  refreshToken: string
  userId: string
  email: string | null
  pairedAt: string
  lastRefreshAt: string
}

export interface AuthStatus {
  paired: boolean
  userId: string | null
  email: string | null
  deviceId: string | null
  pairedAt: string | null
  lastRefreshAt: string | null
}

export interface AuthStoreSnapshot {
  paired: boolean
  deviceId: string | null
  userId: string | null
  email: string | null
  deviceToken: string | null
}

interface PairCompleteResponse {
  deviceId: string
  refreshToken: string
  userId: string
}

interface RefreshResponse {
  refreshToken: string
}

const CREDENTIALS_VERSION = 1

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getEdgeBaseUrl(): string {
  const direct = String(process.env.CTRACK_EDGE_BASE ?? "").trim().replace(/\/+$/, "")
  if (direct) {
    return direct
  }
  const supabaseUrl = String(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "")
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1`
  }
  return ""
}

function getRefreshPath(): string {
  return String(process.env.CTRACK_EDGE_AUTH_REFRESH_PATH ?? "/engine-auth-refresh").trim()
}

function getPairCompletePath(): string {
  return String(process.env.CTRACK_EDGE_PAIR_COMPLETE_PATH ?? "/engine-pair-complete").trim()
}

export function getCredentialsDir(): string {
  const directoryPath = path.join(os.homedir(), ".ctrack-engine")
  fs.mkdirSync(directoryPath, { recursive: true })
  return directoryPath
}

export function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), "credentials.json")
}

export function getAuthStorePath(): string {
  return getCredentialsPath()
}

function readCredentials(): EngineCredentials | null {
  const filePath = getCredentialsPath()
  if (!fs.existsSync(filePath)) {
    return null
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<EngineCredentials> & {
    deviceToken?: unknown
    refreshToken?: unknown
    deviceRefreshToken?: unknown
  }
  const deviceId = toStringOrNull(parsed.deviceId)
  const userId = toStringOrNull(parsed.userId)
  const refreshToken =
    toStringOrNull(parsed.refreshToken) ?? toStringOrNull(parsed.deviceToken) ?? toStringOrNull(parsed.deviceRefreshToken)
  const pairedAt = toStringOrNull(parsed.pairedAt)
  if (!deviceId || !userId || !refreshToken || !pairedAt) {
    return null
  }
  return {
    version: Number(parsed.version ?? CREDENTIALS_VERSION),
    deviceId,
    userId,
    refreshToken,
    email: toStringOrNull(parsed.email),
    pairedAt,
    lastRefreshAt: toStringOrNull(parsed.lastRefreshAt) ?? pairedAt,
  }
}

function getSupabaseAnonKey(): string {
  return String(process.env.VITE_SUPABASE_ANON_KEY ?? "").trim()
}

function getSupabaseProjectUrl(): string {
  return String(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "")
}

export function readEmailFromAccessToken(accessToken: string): string | null {
  return emailFromAccessToken(accessToken)
}

function emailFromAccessToken(accessToken: string): string | null {
  const parts = accessToken.split(".")
  if (parts.length < 2) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      email?: unknown
      user_metadata?: { full_name?: unknown; name?: unknown }
    }
    return (
      toStringOrNull(payload.email) ??
      toStringOrNull(payload.user_metadata?.full_name) ??
      toStringOrNull(payload.user_metadata?.name)
    )
  } catch {
    return null
  }
}

async function fetchProfileEmail(userId: string): Promise<string | null> {
  const supabaseUrl = getSupabaseProjectUrl()
  const anonKey = getSupabaseAnonKey()
  if (!supabaseUrl || !anonKey || !userId) {
    return null
  }
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=full_name`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    }
  )
  if (!response.ok) {
    return null
  }
  const rows = (await response.json()) as Array<{ full_name?: unknown }>
  if (!Array.isArray(rows) || rows.length === 0) {
    return null
  }
  const row = rows[0]
  return toStringOrNull(row.full_name)
}

function patchCredentialEmail(email: string): AuthStatus {
  const credentials = readCredentials()
  if (!credentials) {
    return buildStatus(null)
  }
  const updated: EngineCredentials = {
    ...credentials,
    email,
    lastRefreshAt: new Date().toISOString(),
  }
  fs.writeFileSync(getCredentialsPath(), `${JSON.stringify(updated, null, 2)}\n`, "utf8")
  return buildStatus(updated)
}

function writeCredentials(credentials: EngineCredentials): void {
  const wasPaired = readCredentials() !== null
  fs.writeFileSync(getCredentialsPath(), `${JSON.stringify(credentials, null, 2)}\n`, "utf8")
  if (!wasPaired) {
    signalPairingComplete()
  }
}

function signalPairingComplete(): void {
  try {
    const directoryPath = getCredentialsDir()
    fs.writeFileSync(path.join(directoryPath, "login-complete.touch"), `${new Date().toISOString()}\n`, "utf8")
    fs.writeFileSync(path.join(directoryPath, "tray-refresh.touch"), "paired\n", "utf8")
  } catch {
    // Best-effort notification for tray and sign-in popup.
  }
}

function buildStatus(credentials: EngineCredentials | null): AuthStatus {
  if (!credentials) {
    return {
      paired: false,
      userId: null,
      email: null,
      deviceId: null,
      pairedAt: null,
      lastRefreshAt: null,
    }
  }
  return {
    paired: true,
    userId: credentials.userId,
    email: credentials.email,
    deviceId: credentials.deviceId,
    pairedAt: credentials.pairedAt,
    lastRefreshAt: credentials.lastRefreshAt,
  }
}

async function postJson(url: string, body: Record<string, unknown>, bearerToken?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  if (!response.ok) {
    const errorMessage = typeof parsed.error === "string" ? parsed.error : `Request failed with ${response.status}`
    throw new Error(errorMessage)
  }
  return parsed
}

export function getAuthStatus(): AuthStatus {
  try {
    return buildStatus(readCredentials())
  } catch {
    return buildStatus(null)
  }
}

export function getAuthSnapshot(): AuthStoreSnapshot {
  const status = getAuthStatus()
  const credentials = readCredentials()
  return {
    paired: status.paired,
    deviceId: status.deviceId,
    userId: status.userId,
    email: status.email,
    deviceToken: credentials?.refreshToken ?? null,
  }
}

export async function pairDevice(pairToken: string, emailHint?: string | null): Promise<AuthStatus> {
  const trimmedPairToken = pairToken.trim()
  if (!trimmedPairToken) {
    throw new Error("pairToken is required")
  }
  const edgeBaseUrl = getEdgeBaseUrl()
  if (!edgeBaseUrl) {
    throw new Error("CTRACK_EDGE_BASE is not configured")
  }
  const machineId = `${os.hostname()}-${os.platform()}`
  const payload = (await postJson(`${edgeBaseUrl}${getPairCompletePath()}`, {
    pairToken: trimmedPairToken,
    machineId,
    machineLabel: os.hostname(),
    osPlatform: os.platform(),
    engineVersion: process.env.npm_package_version ?? "0.0.0",
  })) as Partial<PairCompleteResponse>
  if (!payload.deviceId || !payload.refreshToken || !payload.userId) {
    throw new Error("Invalid pair completion response")
  }
  const now = new Date().toISOString()
  const credentials: EngineCredentials = {
    version: CREDENTIALS_VERSION,
    deviceId: payload.deviceId,
    refreshToken: payload.refreshToken,
    userId: payload.userId,
    email: toStringOrNull(emailHint) ?? toStringOrNull((payload as { email?: unknown }).email),
    pairedAt: now,
    lastRefreshAt: now,
  }
  writeCredentials(credentials)
  return buildStatus(credentials)
}

export async function syncAccountEmail(): Promise<AuthStatus> {
  const credentials = readCredentials()
  if (!credentials) {
    return buildStatus(null)
  }
  if (credentials.email) {
    return buildStatus(credentials)
  }
  const profileEmail = await fetchProfileEmail(credentials.userId)
  if (profileEmail) {
    return patchCredentialEmail(profileEmail)
  }
  return buildStatus(credentials)
}

export function unpairDevice(): AuthStatus {
  const filePath = getCredentialsPath()
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
  return buildStatus(null)
}

export async function refreshDeviceToken(): Promise<AuthStatus> {
  const credentials = readCredentials()
  if (!credentials) {
    throw new Error("Engine is not paired")
  }
  const edgeBaseUrl = getEdgeBaseUrl()
  if (!edgeBaseUrl) {
    throw new Error("CTRACK_EDGE_BASE is not configured")
  }
  const payload = (await postJson(
    `${edgeBaseUrl}${getRefreshPath()}`,
    { deviceId: credentials.deviceId },
    credentials.refreshToken
  )) as Partial<RefreshResponse>
  const refreshedToken = toStringOrNull(payload.refreshToken) ?? credentials.refreshToken
  const updatedCredentials: EngineCredentials = {
    ...credentials,
    refreshToken: refreshedToken,
    lastRefreshAt: new Date().toISOString(),
  }
  writeCredentials(updatedCredentials)
  return buildStatus(updatedCredentials)
}
