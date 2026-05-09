import fs from "node:fs/promises"

const DEFAULT_FPS = 24
const DEFAULT_FRAME_START = 1001

export interface VideoMetadataResult {
  durationSeconds: number
  frameCount: number
  frameStart: number
  frameEnd: number
  width?: number
  height?: number
  timescale?: number
}

export async function getVideoMetadata(filePath: string): Promise<VideoMetadataResult | null> {
  let buffer: Buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (err) {
    console.warn("[video-metadata] readFile failed:", filePath, err)
    return null
  }
  if (!buffer?.length) return null

  const ab = new ArrayBuffer(buffer.length)
  new Uint8Array(ab).set(buffer)
  ;(ab as ArrayBuffer & { fileStart?: number }).fileStart = 0

  return new Promise((resolve) => {
    import("mp4box")
      .then((MP4BoxModule) => {
        const mod = MP4BoxModule as unknown as { createFile: () => unknown; default?: { createFile: () => unknown } }
        const MP4Box = mod.default ?? mod
        if (!MP4Box || typeof (MP4Box as { createFile: () => unknown }).createFile !== "function") {
          resolve(null)
          return
        }
        const file = (MP4Box as { createFile: () => unknown }).createFile() as {
          onReady: (info: unknown) => void
          onError: () => void
          appendBuffer: (data: ArrayBuffer) => void
          flush: () => void
        }
        file.onError = () => resolve(null)
        file.onReady = (info: unknown) => {
          const i = info as {
            duration?: number
            timescale?: number
            tracks?: Array<{ video?: { width: number; height: number } }>
          }
          const duration = i.duration ?? 0
          const timescale = i.timescale ?? 1
          const durationSeconds = timescale > 0 ? duration / timescale : 0
          const frameCount = Math.max(0, Math.round(durationSeconds * DEFAULT_FPS))
          const videoTrack = i.tracks?.find((t) => t.video)
          resolve({
            durationSeconds,
            frameCount,
            frameStart: DEFAULT_FRAME_START,
            frameEnd: DEFAULT_FRAME_START + frameCount - 1,
            width: videoTrack?.video?.width,
            height: videoTrack?.video?.height,
            timescale,
          })
        }
        file.appendBuffer(ab)
        file.flush()
      })
      .catch((err: unknown) => {
        console.warn("[video-metadata] mp4box import/parse failed:", err)
        resolve(null)
      })
  })
}
