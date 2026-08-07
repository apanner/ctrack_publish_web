import { HeadBucketCommand, ListBucketsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import fs from "node:fs"
import path from "node:path"
import {
  createStorageRequestHandler,
  normalizeEndpoint,
  readUploadBody,
  trimEnv,
} from "./storage-http.js"

const MULTIPART_THRESHOLD_BYTES = 200 * 1024 * 1024

function createS3Client(params: {
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string | null
  forcePathStyle?: boolean
}): S3Client {
  return new S3Client({
    region: params.region,
    endpoint: params.endpoint || undefined,
    forcePathStyle: params.forcePathStyle,
    credentials: {
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    },
    requestHandler: createStorageRequestHandler(),
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
}

function formatUploadError(provider: "s3" | "minio", error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.toLowerCase().includes("unable to verify the first certificate")) {
    return `${raw} — Windows TLS trust issue (restart engine after update; win-ca loads at startup)`
  }
  if (raw.includes("SignatureDoesNotMatch")) {
    if (provider === "minio") {
      return `${raw} — verify HYBRID_STORAGE_PRIMARY_SECRET_KEY is the MinIO S3 secret (Identity → Access Keys), not the console password`
    }
    return `${raw} — verify AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION match bucket ${trimEnv(process.env.AWS_S3_BUCKET_NAME) || "ctrack-storage"}`
  }
  if (raw.toLowerCase().includes("non-retryable streaming request")) {
    return `${raw} — update engine to latest build (buffered MinIO upload)`
  }
  return raw
}

type UploadOk = {
  status: "success"
  key: string
  size: number
  url?: string
  provider?: "s3" | "minio"
  targets?: {
    s3?: { status: "success"; url?: string } | { status: "error"; message: string }
    minio?: { status: "success"; url?: string } | { status: "error"; message: string }
  }
}

type UploadErr = {
  status: "error"
  message: string
  targets?: UploadOk["targets"]
}

export type UploadResult = UploadOk | UploadErr

export interface StorageTargetProbe {
  provider: "s3" | "minio"
  configured: boolean
  ok: boolean
  bucket: string | null
  endpoint: string | null
  region: string | null
  latencyMs: number | null
  message: string
}

export interface StorageProbeReport {
  testedAt: string
  storageProvider: string
  hybridEnabled: boolean
  targets: StorageTargetProbe[]
}

export class S3Manager {
  private awsClient: S3Client
  private awsRegion: string
  private minioClient: S3Client | null
  private minioBucket: string | null
  private minioEndpoint: string | null
  private minioRegion: string

  constructor() {
    this.awsRegion = trimEnv(process.env.AWS_REGION) || "ap-south-1"
    const awsAccessKey = trimEnv(process.env.AWS_ACCESS_KEY_ID)
    const awsSecretKey = trimEnv(process.env.AWS_SECRET_ACCESS_KEY)
    this.awsClient = createS3Client({
      region: this.awsRegion,
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
    })

    this.minioEndpoint = normalizeEndpoint(process.env.HYBRID_STORAGE_PRIMARY_ENDPOINT)
    this.minioBucket = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_BUCKET) || null
    this.minioRegion = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_REGION) || "us-east-1"

    const minioAccessKey = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY)
    const minioSecretKey = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_SECRET_KEY)

    if (this.minioEndpoint && this.minioBucket && minioAccessKey && minioSecretKey) {
      this.minioClient = createS3Client({
        region: this.minioRegion,
        accessKeyId: minioAccessKey,
        secretAccessKey: minioSecretKey,
        endpoint: this.minioEndpoint,
        forcePathStyle: true,
      })
      console.log("[MinIO] Hybrid storage enabled:", this.minioEndpoint, "bucket:", this.minioBucket)
    } else {
      this.minioClient = null
      console.log("[MinIO] Hybrid disabled (missing HYBRID_STORAGE_PRIMARY_* env)")
    }
  }

  getStorageProvider(): string {
    return trimEnv(process.env.STORAGE_PROVIDER).toLowerCase() || "s3"
  }

  isHybridEnabled(): boolean {
    return this.getStorageProvider() === "hybrid"
  }

  private async probeBucket(params: {
    client: S3Client
    provider: "s3" | "minio"
    bucket: string
    endpoint: string | null
    region: string
    configured: boolean
  }): Promise<StorageTargetProbe> {
    if (!params.configured) {
      return {
        provider: params.provider,
        configured: false,
        ok: false,
        bucket: params.bucket || null,
        endpoint: params.endpoint,
        region: params.region,
        latencyMs: null,
        message: "Not configured (missing credentials or bucket)",
      }
    }
    const started = Date.now()
    try {
      await params.client.send(new HeadBucketCommand({ Bucket: params.bucket }))
      return {
        provider: params.provider,
        configured: true,
        ok: true,
        bucket: params.bucket,
        endpoint: params.endpoint,
        region: params.region,
        latencyMs: Date.now() - started,
        message: "Bucket reachable",
      }
    } catch (headError) {
      try {
        const listed = await params.client.send(new ListBucketsCommand({}))
        const names = (listed.Buckets ?? []).map((entry) => entry.Name).filter(Boolean) as string[]
        const hasBucket = names.includes(params.bucket)
        const headMessage = headError instanceof Error ? headError.message : String(headError)
        return {
          provider: params.provider,
          configured: true,
          ok: hasBucket,
          bucket: params.bucket,
          endpoint: params.endpoint,
          region: params.region,
          latencyMs: Date.now() - started,
          message: hasBucket
            ? `Bucket listed (${headMessage})`
            : `Auth OK but bucket "${params.bucket}" not found. Available: ${names.join(", ") || "none"}`,
        }
      } catch (listError) {
        const message = formatUploadError(params.provider, listError)
        return {
          provider: params.provider,
          configured: true,
          ok: false,
          bucket: params.bucket,
          endpoint: params.endpoint,
          region: params.region,
          latencyMs: Date.now() - started,
          message,
        }
      }
    }
  }

  async testStorageConnections(): Promise<StorageProbeReport> {
    const awsBucket = trimEnv(process.env.AWS_S3_BUCKET_NAME)
    const awsAccessKey = trimEnv(process.env.AWS_ACCESS_KEY_ID)
    const awsSecretKey = trimEnv(process.env.AWS_SECRET_ACCESS_KEY)
    const awsConfigured = !!(awsBucket && awsAccessKey && awsSecretKey)

    const minioAccessKey = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY)
    const minioSecretKey = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_SECRET_KEY)
    const minioConfigured = !!(this.minioEndpoint && this.minioBucket && minioAccessKey && minioSecretKey)

    const s3Probe = await this.probeBucket({
      client: this.awsClient,
      provider: "s3",
      bucket: awsBucket,
      endpoint: null,
      region: this.awsRegion,
      configured: awsConfigured,
    })

    const minioProbe = this.minioClient
      ? await this.probeBucket({
          client: this.minioClient,
          provider: "minio",
          bucket: this.minioBucket!,
          endpoint: this.minioEndpoint,
          region: this.minioRegion,
          configured: minioConfigured,
        })
      : {
          provider: "minio" as const,
          configured: false,
          ok: false,
          bucket: this.minioBucket,
          endpoint: this.minioEndpoint,
          region: this.minioRegion,
          latencyMs: null,
          message: "Not configured (missing HYBRID_STORAGE_PRIMARY_* env)",
        }

    const storageProvider = this.getStorageProvider()
    return {
      testedAt: new Date().toISOString(),
      storageProvider: storageProvider || "s3",
      hybridEnabled: storageProvider === "hybrid",
      targets: storageProvider === "hybrid" ? [minioProbe, s3Probe] : [s3Probe],
    }
  }

  private async uploadWithClient(params: {
    client: S3Client
    provider: "s3" | "minio"
    filePath: string
    bucketName: string
    key: string
    onProgress?: (progress: number) => void
    urlBuilder?: (bucketName: string, key: string) => string
  }): Promise<UploadResult> {
    const key = params.key.replace(/\/+$/, "").replace(/^\/+/, "")
    const stats = fs.statSync(params.filePath)
    const contentType = this.getContentType(params.filePath)
    const useBufferedPut = params.provider === "minio" || stats.size <= MULTIPART_THRESHOLD_BYTES

    try {
      if (params.provider === "minio") {
        console.log("[MinIO] Uploading:", key, "->", params.bucketName, `(${stats.size} bytes, buffered=${useBufferedPut})`)
      }

      if (useBufferedPut) {
        const body = await readUploadBody(params.filePath)
        await params.client.send(
          new PutObjectCommand({
            Bucket: params.bucketName,
            Key: key,
            Body: body,
            ContentLength: body.length,
            ContentType: contentType,
          })
        )
        params.onProgress?.(100)
      } else {
        const upload = new Upload({
          client: params.client,
          params: {
            Bucket: params.bucketName,
            Key: key,
            Body: await readUploadBody(params.filePath),
            ContentLength: stats.size,
            ContentType: contentType,
          },
          queueSize: 4,
          partSize: 1024 * 1024 * 8,
          leavePartsOnError: false,
        })

        upload.on("httpUploadProgress", (progress) => {
          if (!params.onProgress || !progress.loaded || !progress.total) return
          params.onProgress(Math.round((progress.loaded / progress.total) * 100))
        })
        await upload.done()
      }

      const url = params.urlBuilder ? params.urlBuilder(params.bucketName, key) : undefined
      if (params.provider === "minio") {
        console.log("[MinIO] OK:", key, "size:", stats.size)
      }
      return { status: "success", url, key, size: stats.size, provider: params.provider }
    } catch (error) {
      const message = formatUploadError(params.provider, error)
      console.error(`[${params.provider}] Upload error:`, key, message)
      return { status: "error", message }
    }
  }

  async uploadFile(filePath: string, bucketName: string, key: string, onProgress?: (progress: number) => void): Promise<UploadResult> {
    return await this.uploadWithClient({
      client: this.awsClient,
      provider: "s3",
      filePath,
      bucketName,
      key,
      onProgress,
      urlBuilder: (b, k) => `https://${b}.s3.${this.awsRegion}.amazonaws.com/${k}`,
    })
  }

  async uploadFileHybrid(filePath: string, awsBucketName: string, key: string, onProgress?: (progress: number) => void): Promise<UploadResult> {
    console.log("[MinIO] Hybrid publish: key:", key, "- will try MinIO then S3; publish succeeds if either works.")
    let minioResult: UploadResult
    let s3Result: UploadResult

    if (this.minioClient && this.minioBucket && this.minioEndpoint) {
      minioResult = await this.uploadWithClient({
        client: this.minioClient,
        provider: "minio",
        filePath,
        bucketName: this.minioBucket,
        key,
        onProgress,
        urlBuilder: (b, k) => `${this.minioEndpoint}/${b}/${encodeURI(k)}`,
      })
      if (minioResult.status === "error") {
        console.warn("[MinIO] MinIO upload failed, trying S3 next:", minioResult.message)
      }
    } else {
      minioResult = { status: "error", message: "MinIO not configured (missing HYBRID_STORAGE_PRIMARY_*)" }
      console.log("[MinIO] MinIO skipped (not configured), trying S3.")
    }

    s3Result = await this.uploadWithClient({
      client: this.awsClient,
      provider: "s3",
      filePath,
      bucketName: awsBucketName,
      key,
      onProgress,
      urlBuilder: (b, k) => `https://${b}.s3.${this.awsRegion}.amazonaws.com/${k}`,
    })
    if (s3Result.status === "error") {
      console.warn("[MinIO] S3 upload failed:", s3Result.message, "- MinIO result:", minioResult.status === "success" ? "OK" : "FAIL")
    }

    const targets: UploadOk["targets"] = {
      s3:
        s3Result.status === "success"
          ? { status: "success", url: s3Result.url }
          : { status: "error", message: s3Result.message },
      minio:
        minioResult.status === "success"
          ? { status: "success", url: minioResult.url }
          : { status: "error", message: minioResult.message },
    }

    const okResult: UploadOk | null =
      minioResult.status === "success" ? minioResult : s3Result.status === "success" ? s3Result : null
    if (!okResult) {
      const s3Err = s3Result.status === "error" ? s3Result.message : "unknown error"
      const minioErr = minioResult.status === "error" ? minioResult.message : "unknown error"
      console.error("[MinIO] Hybrid publish failed (both tried):", key, "S3:", s3Err, "MinIO:", minioErr)
      return {
        status: "error",
        message: `Both uploads failed. S3: ${s3Err}; MinIO: ${minioErr}`,
        targets,
      }
    }

    const s3Ok = s3Result.status === "success"
    const minioOk = minioResult.status === "success"
    console.log("[MinIO] Hybrid publish done:", key, "MinIO:", minioOk ? "OK" : "FAIL", "S3:", s3Ok ? "OK" : "FAIL")
    return {
      status: "success",
      key,
      size: okResult.size,
      url: s3Result.status === "success" ? s3Result.url : okResult.url,
      provider: okResult.provider,
      targets,
    }
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case ".mp4":
        return "video/mp4"
      case ".jpg":
      case ".jpeg":
        return "image/jpeg"
      case ".png":
        return "image/png"
      case ".gif":
        return "image/gif"
      case ".webp":
        return "image/webp"
      case ".exr":
        return "image/x-exr"
      default:
        return "application/octet-stream"
    }
  }
}
