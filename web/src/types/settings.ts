/**
 * App settings for Thumbnail, GIF, MP4, and General (VFX studio–oriented).
 * Stored in Electron userData/settings.json and passed to Python/FFmpeg where applicable.
 */

export interface ThumbnailSettings {
  width: number
  height: number
  format: 'jpg' | 'png'
  quality: number
  frame: 'first' | 'middle' | 'last'
}

export interface GifSettings {
  width: number
  fps: number
  durationSeconds: number
  scaleFilter: 'lanczos' | 'bicubic'
  frameSkip: number
}

export interface Mp4Settings {
  codec: 'libx264' | 'libx265'
  crf: number
  preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow'
  maxWidth: number
  maxHeight: number
  burnin: boolean
  pixelFormat: string
}

export interface GeneralSettings {
  defaultBucket: string
  ffmpegPath: string
}

export interface AppSettings {
  thumbnail: ThumbnailSettings
  gif: GifSettings
  mp4: Mp4Settings
  general: GeneralSettings
}

export const DEFAULT_THUMBNAIL: ThumbnailSettings = {
  width: 320,
  height: 0,
  format: 'jpg',
  quality: 2,
  frame: 'middle',
}

export const DEFAULT_GIF: GifSettings = {
  width: 480,
  fps: 6,
  durationSeconds: 3,
  scaleFilter: 'lanczos',
  frameSkip: 2,
}

export const DEFAULT_MP4: Mp4Settings = {
  codec: 'libx265',
  crf: 24,
  preset: 'slow',
  maxWidth: 0,
  maxHeight: 0,
  burnin: true,
  pixelFormat: 'yuv420p',
}

export const DEFAULT_GENERAL: GeneralSettings = {
  defaultBucket: 'ctrack-storage',
  ffmpegPath: '',
}

export const DEFAULT_SETTINGS: AppSettings = {
  thumbnail: DEFAULT_THUMBNAIL,
  gif: DEFAULT_GIF,
  mp4: DEFAULT_MP4,
  general: DEFAULT_GENERAL,
}
