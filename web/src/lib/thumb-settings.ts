import type { AppSettings } from "@/types/settings"

export interface EngineThumbOptions {
  width: number
  height: number
  quality: number
  frame: "first" | "middle" | "last"
  frame_skip: number
  fps: number
  frame_start: number | null
  frame_end: number | null
  webp_width: number
  webp_quality: number
}

export function buildThumbOptions(
  appSettings: AppSettings,
  frameStart?: number | null,
  frameEnd?: number | null
): EngineThumbOptions {
  return {
    width: appSettings.thumbnail.width || 320,
    height: appSettings.thumbnail.height || 0,
    quality: appSettings.thumbnail.quality ?? 2,
    frame: appSettings.thumbnail.frame || "middle",
    frame_skip: appSettings.gif.frameSkip || 2,
    fps: appSettings.gif.fps || 6,
    frame_start: frameStart ?? null,
    frame_end: frameEnd ?? null,
    webp_width: appSettings.gif.width || 480,
    webp_quality: 75,
  }
}
