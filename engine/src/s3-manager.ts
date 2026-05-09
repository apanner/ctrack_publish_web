import { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import fs from "node:fs"
import path from "node:path"

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

export class S3Manager {
  private awsClient: S3Client
  private awsRegion: string
  private minioClient: S3Client | null
  private minioBucket: string | null
  private minioEndpoint: string | null
  private minioRegion: string

  constructor() {
    this.awsRegion = process.env.AWS_REGION || "ap-south-1"
    this.awsClient = new S3Client({
      region: this.awsRegion,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    })

    this.minioEndpoint = process.env.HYBRID_STORAGE_PRIMARY_ENDPOINT || null
    this.minioBucket = process.env.HYBRID_STORAGE_PRIMARY_BUCKET || null
    this.minioRegion = process.env.HYBRID_STORAGE_PRIMARY_REGION || "us-east-1"

    const minioAccessKey = process.env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY
    const minioSecretKey = process.env.HYBRID_STORAGE_PRIMARY_SECRET_KEY

    if (this.minioEndpoint && this.minioBucket && minioAccessKey && minioSecretKey) {
      this.minioClient = new S3Client({
        endpoint: this.minioEndpoint,
        region: this.minioRegion,
        credentials: {
          accessKeyId: minioAccessKey,
          secretAccessKey: minioSecretKey,
        },
        forcePathStyle: true,
      })
      console.log("[MinIO] Hybrid storage enabled:", this.minioEndpoint, "bucket:", this.minioBucket)
    } else {
      this.minioClient = null
      console.log("[MinIO] Hybrid disabled (missing HYBRID_STORAGE_PRIMARY_* env)")
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
    const key = params.key.replace(/\/+$/, "")
    const fileStream = fs.createReadStream(params.filePath)

    const upload = new Upload({
      client: params.client,
      params: {
        Bucket: params.bucketName,
        Key: key,
        Body: fileStream,
        ContentType: this.getContentType(params.filePath),
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 5,
      leavePartsOnError: false,
    })

    upload.on("httpUploadProgress", (progress) => {
      if (!params.onProgress || !progress.loaded || !progress.total) return
      params.onProgress(Math.round((progress.loaded / progress.total) * 100))
    })

    try {
      if (params.provider === "minio") {
        console.log("[MinIO] Uploading:", params.key, "->", params.bucketName)
      }
      await upload.done()
      const stats = fs.statSync(params.filePath)
      const url = params.urlBuilder ? params.urlBuilder(params.bucketName, key) : undefined
      if (params.provider === "minio") {
        console.log("[MinIO] OK:", key, "size:", stats.size)
      }
      return { status: "success", url, key, size: stats.size, provider: params.provider }
    } catch (error) {
      console.error(`[${params.provider}] Upload error:`, key, error)
      return { status: "error", message: String(error) }
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
    console.log("[MinIO] Hybrid publish: key:", key, "- will try MinIO then S3; if one fails, other must upload.")
    let minioResult: UploadResult
    let s3Result: UploadResult

    if (this.minioClient && this.minioBucket && this.minioEndpoint) {
      minioResult = await this.uploadWithClient({
        client: this.minioClient,
        provider: "minio",
        filePath,
        bucketName: this.minioBucket,
        key,
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
