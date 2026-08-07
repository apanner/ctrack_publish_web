import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { HeadBucketCommand, ListBucketsCommand, S3Client } from "@aws-sdk/client-s3"
import { NodeHttpHandler } from "@smithy/node-http-handler"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
dotenv.config({ path: path.join(root, "engine", ".env") })
dotenv.config({ path: path.join(root, ".env") })

function trimEnv(value) {
  if (!value) return ""
  let trimmed = String(value).trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function createClient(config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secret,
    },
    forcePathStyle: config.forcePathStyle,
    requestHandler: new NodeHttpHandler({
      requestTimeout: 600_000,
      connectionTimeout: 30_000,
      socketTimeout: 600_000,
    }),
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
}

async function probe(label, config) {
  if (!config.bucket || !config.accessKey || !config.secret) {
    console.log(`${label}: SKIP (missing credentials or bucket)`)
    return { label, ok: false, configured: false, message: "Not configured" }
  }
  const client = createClient(config)
  const started = Date.now()
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
    const latencyMs = Date.now() - started
    console.log(`${label}: OK bucket=${config.bucket} latencyMs=${latencyMs}`)
    return { label, ok: true, configured: true, bucket: config.bucket, latencyMs, message: "OK" }
  } catch (headError) {
    try {
      const listed = await client.send(new ListBucketsCommand({}))
      const names = (listed.Buckets ?? []).map((b) => b.Name).filter(Boolean)
      const latencyMs = Date.now() - started
      const hasBucket = names.includes(config.bucket)
      console.log(
        `${label}: HeadBucket failed (${headError.name}: ${headError.message}); ListBuckets=${names.join(",") || "(none)"}`
      )
      return {
        label,
        ok: hasBucket,
        configured: true,
        bucket: config.bucket,
        latencyMs,
        message: hasBucket ? "Bucket visible via ListBuckets" : `Bucket missing. Available: ${names.join(", ") || "none"}`,
      }
    } catch (listError) {
      const meta = listError.$metadata ?? headError.$metadata
      console.log(`${label}: FAIL bucket=${config.bucket}`)
      console.log(`  head: ${headError.name} ${headError.message}`)
      console.log(`  list: ${listError.name} ${listError.message}`)
      if (meta) console.log(`  httpStatus: ${meta.httpStatusCode ?? "?"}`)
      return {
        label,
        ok: false,
        configured: true,
        bucket: config.bucket,
        message: listError.message || headError.message || "Connection failed",
      }
    }
  }
}

const minioEndpoint = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_ENDPOINT).replace(/\/+$/, "")

const minio = await probe("MinIO", {
  bucket: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_BUCKET),
  accessKey: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY),
  secret: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_SECRET_KEY),
  region: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_REGION) || "us-east-1",
  endpoint: minioEndpoint || undefined,
  forcePathStyle: true,
})

const s3 = await probe("AWS S3", {
  bucket: trimEnv(process.env.AWS_S3_BUCKET_NAME),
  accessKey: trimEnv(process.env.AWS_ACCESS_KEY_ID),
  secret: trimEnv(process.env.AWS_SECRET_ACCESS_KEY),
  region: trimEnv(process.env.AWS_REGION) || "ap-south-1",
  endpoint: undefined,
  forcePathStyle: false,
})

console.log("STORAGE_PROVIDER=", trimEnv(process.env.STORAGE_PROVIDER))
console.log("summary", JSON.stringify({ minio, s3 }, null, 2))
