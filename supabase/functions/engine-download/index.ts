import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.817.0"
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.817.0"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const PRESIGNED_TTL_SECONDS = 15 * 60
const GITHUB_API = "https://api.github.com"

type ArtifactName = "engineSetup" | "nukePluginSetup"
type ProductName = "engine" | "nuke"
type DownloadRequestBody = {
  version?: string
  channel?: string
  artifact?: ArtifactName
  product?: ProductName
}

interface GithubRepoRef {
  owner: string
  repo: string
}

interface GithubReleaseAsset {
  id: number
  name: string
  browser_download_url: string
  url: string
}

function normalizeProduct(value: string | null | undefined): ProductName {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === "nuke" || normalized === "ctrack-nuke") {
    return "nuke"
  }
  return "engine"
}

function resolveArtifact(product: ProductName, artifactValue: string | null | undefined): ArtifactName {
  const normalized = String(artifactValue ?? "").trim()
  if (normalized === "engineSetup" || normalized === "nukePluginSetup") {
    return normalized
  }
  return product === "nuke" ? "nukePluginSetup" : "engineSetup"
}

function getSupabaseUrl(req: Request): string {
  const direct = Deno.env.get("SUPABASE_URL")
  if (direct) {
    return direct
  }
  const requestUrl = new URL(req.url)
  const projectRef = requestUrl.hostname.split(".")[0]
  return `https://${projectRef}.supabase.co`
}

function getEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}

function getOptionalEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim()
  return value && value.length > 0 ? value : null
}

function resolveGithubToken(): string {
  const token = getOptionalEnv("GITHUB_RELEASE_TOKEN") ?? getOptionalEnv("GITHUB_TOKEN")
  if (!token) {
    throw new Error("Missing environment variable: GITHUB_RELEASE_TOKEN (or GITHUB_TOKEN)")
  }
  return token
}

function parseGithubStoragePrefix(s3Prefix: string): GithubRepoRef | null {
  const trimmed = s3Prefix.trim()
  if (!trimmed.toLowerCase().startsWith("github:")) {
    return null
  }
  const rest = trimmed.slice("github:".length).trim()
  const slash = rest.indexOf("/")
  if (slash <= 0 || slash >= rest.length - 1) {
    return null
  }
  return {
    owner: rest.slice(0, slash),
    repo: rest.slice(slash + 1),
  }
}

function releaseTagForVersion(version: string): string {
  const trimmed = version.trim()
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`
}

interface MinioBackupConfig {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

function getMinioBackupConfig(): MinioBackupConfig | null {
  const endpoint = getOptionalEnv("HYBRID_STORAGE_PRIMARY_ENDPOINT")
  const bucket = getOptionalEnv("HYBRID_STORAGE_PRIMARY_BUCKET")
  const accessKeyId = getOptionalEnv("HYBRID_STORAGE_PRIMARY_ACCESS_KEY")
  const secretAccessKey = getOptionalEnv("HYBRID_STORAGE_PRIMARY_SECRET_KEY")
  const region = getOptionalEnv("HYBRID_STORAGE_PRIMARY_REGION") ?? "us-east-1"
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null
  }
  return { endpoint, bucket, region, accessKeyId, secretAccessKey }
}

async function presignObjectDownload(params: {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  objectKey: string
  endpoint?: string | null
}): Promise<string> {
  const s3Client = new S3Client({
    region: params.region,
    endpoint: params.endpoint || undefined,
    credentials: {
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    },
    forcePathStyle: Boolean(params.endpoint),
  })
  const command = new GetObjectCommand({ Bucket: params.bucket, Key: params.objectKey })
  return await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_TTL_SECONDS })
}

async function fetchGithubReleaseAssets(params: {
  owner: string
  repo: string
  tag: string
  token: string
}): Promise<GithubReleaseAsset[]> {
  const response = await fetch(
    `${GITHUB_API}/repos/${params.owner}/${params.repo}/releases/tags/${encodeURIComponent(params.tag)}`,
    {
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  )
  if (!response.ok) {
    throw new Error(`GitHub release not found for tag ${params.tag} (${response.status})`)
  }
  const payload = await response.json() as { assets?: GithubReleaseAsset[] }
  return Array.isArray(payload.assets) ? payload.assets : []
}

async function resolveGithubAssetDownloadUrl(params: {
  owner: string
  repo: string
  tag: string
  assetName: string
  token: string
}): Promise<string> {
  const assets = await fetchGithubReleaseAssets({
    owner: params.owner,
    repo: params.repo,
    tag: params.tag,
    token: params.token,
  })
  const asset = assets.find((entry) => entry.name === params.assetName)
  if (!asset) {
    throw new Error(`GitHub release asset not found: ${params.assetName}`)
  }

  const assetResponse = await fetch(asset.url, {
    headers: {
      Authorization: `Bearer ${params.token}`,
      Accept: "application/octet-stream",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "manual",
  })

  const redirectUrl = assetResponse.headers.get("location")
  if (redirectUrl) {
    return redirectUrl
  }

  if (assetResponse.ok) {
    return asset.browser_download_url
  }

  throw new Error(`Failed to resolve GitHub asset download URL (${assetResponse.status})`)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return toHex(digest)
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Max-Age": "86400",
      },
      status: 200,
    })
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405,
    })
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization")
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      })
    }
    const token = authHeader.slice(7).trim()

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    const supabaseAdmin = createClient(getSupabaseUrl(req), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    let userId: string | null = null
    let deviceId: string | null = null

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (!userError && userData.user) {
      userId = userData.user.id
    } else {
      const tokenHash = await sha256Hex(token)
      const { data: deviceCredential, error: credentialError } = await supabaseAdmin
        .from("engine_device_credentials")
        .select("device_id,expires_at,engine_devices(user_id,revoked_at)")
        .eq("refresh_token_hash", tokenHash)
        .maybeSingle()

      if (credentialError || !deviceCredential) {
        return new Response(JSON.stringify({ error: "Unauthorized token" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        })
      }
      if (new Date(deviceCredential.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: "Device token expired" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        })
      }
      const relatedDevice = Array.isArray(deviceCredential.engine_devices)
        ? deviceCredential.engine_devices[0]
        : deviceCredential.engine_devices
      if (!relatedDevice || relatedDevice.revoked_at) {
        return new Response(JSON.stringify({ error: "Device revoked or missing" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        })
      }
      userId = relatedDevice.user_id
      deviceId = deviceCredential.device_id
    }

    const requestUrl = new URL(req.url)
    const requestBody = req.method === "POST" ? ((await req.json().catch(() => ({}))) as DownloadRequestBody) : {}
    const requestedVersion =
      String(requestBody.version ?? requestUrl.searchParams.get("version") ?? "latest").trim() || "latest"
    const channel = String(requestBody.channel ?? requestUrl.searchParams.get("channel") ?? "stable").trim() || "stable"
    const product = normalizeProduct(requestBody.product ?? requestUrl.searchParams.get("product"))
    const artifact = resolveArtifact(product, requestBody.artifact ?? requestUrl.searchParams.get("artifact"))

    let releaseQuery = supabaseAdmin
      .from("engine_releases")
      .select("*")
      .eq("channel", channel)
      .order("published_at", { ascending: false })
      .limit(1)

    if (requestedVersion !== "latest") {
      releaseQuery = supabaseAdmin.from("engine_releases").select("*").eq("version", requestedVersion).limit(1)
    }

    const { data: releaseRows, error: releaseError } = await releaseQuery
    const release = releaseRows?.[0]

    if (releaseError || !release) {
      return new Response(JSON.stringify({ error: "Release not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      })
    }

    const assetKey = artifact === "engineSetup" ? release.engine_s3_key : release.nuke_s3_key
    if (!assetKey) {
      return new Response(JSON.stringify({ error: "Artifact key missing on release" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      })
    }

    const githubRepo = parseGithubStoragePrefix(String(release.s3_prefix ?? ""))
    let downloadUrl: string
    let backupUrl: string | null = null
    let storageSource: "github" | "aws" = "github"

    if (githubRepo) {
      const githubToken = resolveGithubToken()
      const releaseTag = releaseTagForVersion(String(release.version))
      downloadUrl = await resolveGithubAssetDownloadUrl({
        owner: githubRepo.owner,
        repo: githubRepo.repo,
        tag: releaseTag,
        assetName: String(assetKey),
        token: githubToken,
      })
      storageSource = "github"
    } else {
      const bucket = getEnv("AWS_S3_BUCKET")
      const region = getEnv("AWS_REGION")
      const accessKeyId = getEnv("AWS_ACCESS_KEY_ID")
      const secretAccessKey = getEnv("AWS_SECRET_ACCESS_KEY")
      const endpoint = Deno.env.get("AWS_S3_ENDPOINT")?.trim()

      try {
        downloadUrl = await presignObjectDownload({
          bucket,
          region,
          accessKeyId,
          secretAccessKey,
          objectKey: String(assetKey),
          endpoint: endpoint || null,
        })
      } catch (primaryError: unknown) {
        const minioConfig = getMinioBackupConfig()
        if (!minioConfig) {
          throw primaryError
        }
        downloadUrl = await presignObjectDownload({
          bucket: minioConfig.bucket,
          region: minioConfig.region,
          accessKeyId: minioConfig.accessKeyId,
          secretAccessKey: minioConfig.secretAccessKey,
          objectKey: String(assetKey),
          endpoint: minioConfig.endpoint,
        })
      }

      storageSource = "aws"
      const minioConfig = getMinioBackupConfig()
      if (minioConfig) {
        try {
          backupUrl = await presignObjectDownload({
            bucket: minioConfig.bucket,
            region: minioConfig.region,
            accessKeyId: minioConfig.accessKeyId,
            secretAccessKey: minioConfig.secretAccessKey,
            objectKey: String(assetKey),
            endpoint: minioConfig.endpoint,
          })
        } catch {
          backupUrl = null
        }
      }
    }

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("cf-connecting-ip") ??
      null
    const userAgent = req.headers.get("user-agent")

    const { error: auditError } = await supabaseAdmin.from("engine_download_audit").insert({
      user_id: userId,
      device_id: deviceId,
      release_version: release.version,
      artifact,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

    if (auditError) {
      return new Response(JSON.stringify({ error: auditError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      })
    }

    return new Response(
      JSON.stringify({
        url: downloadUrl,
        backupUrl,
        storageSource,
        expiresIn: storageSource === "github" ? null : PRESIGNED_TTL_SECONDS,
        product,
        version: release.version,
        artifact,
        sha256: artifact === "engineSetup" ? release.engine_sha256 : release.nuke_sha256,
        sizeBytes: artifact === "engineSetup" ? release.engine_size_bytes : release.nuke_size_bytes,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})
