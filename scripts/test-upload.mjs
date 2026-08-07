import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { NodeHttpHandler } from "@smithy/node-http-handler"
import { createRequire } from "node:module"
import https from "node:https"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
dotenv.config({ path: path.join(root, "engine", ".env") })
dotenv.config({ path: path.join(root, ".env") })

if (process.platform === "win32") {
  try {
    require("win-ca").inject("+")
  } catch (error) {
    console.warn("win-ca inject failed:", error)
  }
}

function trimEnv(value) {
  if (!value) return ""
  let trimmed = String(value).trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function client({ endpoint, forcePathStyle, region, accessKey, secret, bucket }) {
  return {
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: { accessKeyId: accessKey, secretAccessKey: secret },
      requestHandler: new NodeHttpHandler({
        requestTimeout: 600_000,
        httpsAgent: new https.Agent({ minVersion: "TLSv1.2", keepAlive: true }),
      }),
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
    bucket,
  }
}

const minioEndpoint = trimEnv(process.env.HYBRID_STORAGE_PRIMARY_ENDPOINT).replace(/\/+$/, "")
const minio = client({
  endpoint: minioEndpoint,
  forcePathStyle: true,
  region: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_REGION) || "us-east-1",
  accessKey: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_ACCESS_KEY),
  secret: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_SECRET_KEY),
  bucket: trimEnv(process.env.HYBRID_STORAGE_PRIMARY_BUCKET),
})

const s3 = client({
  endpoint: undefined,
  forcePathStyle: false,
  region: trimEnv(process.env.AWS_REGION) || "ap-south-1",
  accessKey: trimEnv(process.env.AWS_ACCESS_KEY_ID),
  secret: trimEnv(process.env.AWS_SECRET_ACCESS_KEY),
  bucket: trimEnv(process.env.AWS_S3_BUCKET_NAME),
})

const tmp = path.join(root, ".upload-test.bin")
const key = `test/engine-upload-${Date.now()}.bin`
await fs.promises.writeFile(tmp, Buffer.from(`ctrack upload test ${new Date().toISOString()}`))

async function upload(label, target) {
  const body = await fs.promises.readFile(tmp)
  await target.client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: "application/octet-stream",
    })
  )
  console.log(`${label}: OK uploaded ${key} (${body.length} bytes)`)
}

try {
  await upload("MinIO", minio)
} catch (error) {
  console.error("MinIO upload FAIL:", error?.message || error)
}

try {
  await upload("AWS S3", s3)
} catch (error) {
  console.error("AWS S3 upload FAIL:", error?.message || error)
}

await fs.promises.unlink(tmp).catch(() => {})
