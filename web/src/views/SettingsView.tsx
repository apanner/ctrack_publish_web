"use client"

import { useState, useEffect, useCallback } from "react"
import { Settings, Image, Film, Video, Globe } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAppLogStore } from "@/store/app-log-store"
import type {
  AppSettings,
  ThumbnailSettings,
  GifSettings,
  Mp4Settings,
  GeneralSettings,
} from "@/types/settings"
import {
  DEFAULT_SETTINGS,
  DEFAULT_THUMBNAIL,
  DEFAULT_GIF,
  DEFAULT_MP4,
  DEFAULT_GENERAL,
} from "@/types/settings"

function mergeSettings(loaded: Partial<AppSettings> | null): AppSettings {
  return {
    thumbnail: { ...DEFAULT_THUMBNAIL, ...loaded?.thumbnail },
    gif: { ...DEFAULT_GIF, ...loaded?.gif },
    mp4: { ...DEFAULT_MP4, ...loaded?.mp4 },
    general: { ...DEFAULT_GENERAL, ...loaded?.general },
  }
}

export function SettingsView() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const addLog = useAppLogStore((s) => s.addLog)

  useEffect(() => {
    ; (window as any).ipcRenderer?.invoke("settings:read").then((data: Partial<AppSettings> | null) => {
      setSettings(mergeSettings(data))
      setLoaded(true)
    })
  }, [])

  const updateThumbnail = useCallback((patch: Partial<ThumbnailSettings>) => {
    setSettings((prev) => ({ ...prev, thumbnail: { ...prev.thumbnail, ...patch } }))
  }, [])

  const updateGif = useCallback((patch: Partial<GifSettings>) => {
    setSettings((prev) => ({ ...prev, gif: { ...prev.gif, ...patch } }))
  }, [])

  const updateMp4 = useCallback((patch: Partial<Mp4Settings>) => {
    setSettings((prev) => ({ ...prev, mp4: { ...prev.mp4, ...patch } }))
  }, [])

  const updateGeneral = useCallback((patch: Partial<GeneralSettings>) => {
    setSettings((prev) => ({ ...prev, general: { ...prev.general, ...patch } }))
  }, [])

  const handleSave = useCallback(async () => {
    await (window as any).ipcRenderer?.invoke("settings:write", settings)
    addLog("info", "Settings saved.")
  }, [settings, addLog])

  const handleReset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    addLog("info", "Settings reset to defaults.")
  }, [addLog])

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading settings…
      </div>
    )
  }

  const sectionClass = "bg-[#2A2A2A] border border-[#404040] rounded-xl p-6 space-y-5"
  const labelClass = "text-[10px] text-gray-400 font-semibold uppercase tracking-wider"
  const inputClass = "bg-[#1A1A1A] border-[#404040] text-white h-9"

  return (
    <div className="p-8 h-full overflow-auto space-y-8">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase flex items-center gap-3">
            <Settings className="w-8 h-8 text-[#24E1B1]" />
            Settings
          </h1>
          <p className="text-muted-foreground font-medium uppercase tracking-widest text-xs">
            Thumbnail • GIF • MP4 • General (VFX studio)
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="bg-[#1A1A1A] border-[#404040] text-gray-300 hover:bg-red-500/10 hover:border-red-500/40"
          >
            Reset to defaults
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="bg-[#24E1B1] text-[#121212] hover:bg-[#24E1B1]/90"
          >
            Save settings
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Thumbnail */}
        <section className={sectionClass}>
          <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <Image className="w-4 h-4 text-[#24E1B1]" />
            Thumbnail
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className={labelClass}>Width (px)</label>
              <Input
                type="number"
                min={1}
                value={settings.thumbnail.width}
                onChange={(e) => updateThumbnail({ width: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Height (0 = auto)</label>
              <Input
                type="number"
                min={0}
                value={settings.thumbnail.height}
                onChange={(e) => updateThumbnail({ height: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Format</label>
              <Select
                value={settings.thumbnail.format}
                onValueChange={(v) => updateThumbnail({ format: v as 'jpg' | 'png' })}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#404040]">
                  <SelectItem value="jpg" className="text-white focus:bg-[#0096D6]">JPG</SelectItem>
                  <SelectItem value="png" className="text-white focus:bg-[#0096D6]">PNG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Quality (1–31, lower = better)</label>
              <Input
                type="number"
                min={1}
                max={31}
                value={settings.thumbnail.quality}
                onChange={(e) => updateThumbnail({ quality: parseInt(e.target.value, 10) || 2 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <label className={labelClass}>Frame</label>
              <Select
                value={settings.thumbnail.frame}
                onValueChange={(v) => updateThumbnail({ frame: v as 'first' | 'middle' | 'last' })}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#404040]">
                  <SelectItem value="first" className="text-white focus:bg-[#0096D6]">First</SelectItem>
                  <SelectItem value="middle" className="text-white focus:bg-[#0096D6]">Middle</SelectItem>
                  <SelectItem value="last" className="text-white focus:bg-[#0096D6]">Last</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* WebP / GIF */}
        <section className={sectionClass}>
          <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <Film className="w-4 h-4 text-[#24E1B1]" />
            Animated Preview (WebP)
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className={labelClass}>Width (px)</label>
              <Input
                type="number"
                min={1}
                value={settings.gif.width}
                onChange={(e) => updateGif({ width: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>FPS</label>
              <Input
                type="number"
                min={1}
                max={30}
                value={settings.gif.fps}
                onChange={(e) => updateGif({ fps: parseInt(e.target.value, 10) || 5 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Duration (sec)</label>
              <Input
                type="number"
                min={1}
                max={30}
                value={settings.gif.durationSeconds}
                onChange={(e) => updateGif({ durationSeconds: parseInt(e.target.value, 10) || 3 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Frame Skip (1 = none)</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.gif.frameSkip}
                onChange={(e) => updateGif({ frameSkip: parseInt(e.target.value, 10) || 1 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Scale filter</label>
              <Select
                value={settings.gif.scaleFilter}
                onValueChange={(v) => updateGif({ scaleFilter: v as 'lanczos' | 'bicubic' })}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#404040]">
                  <SelectItem value="lanczos" className="text-white focus:bg-[#0096D6]">Lanczos</SelectItem>
                  <SelectItem value="bicubic" className="text-white focus:bg-[#0096D6]">Bicubic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 italic">
            * Frame Skip of 2 means taking every 2nd frame (1, 3, 5...). This significantly reduces file size.
          </p>
        </section>

        {/* MP4 */}
        <section className={cn(sectionClass, "lg:col-span-2")}>
          <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <Video className="w-4 h-4 text-[#24E1B1]" />
            MP4 transcode (delivery)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className={labelClass}>Codec</label>
              <Select
                value={settings.mp4.codec}
                onValueChange={(v) => updateMp4({ codec: v as 'libx264' | 'libx265' })}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#404040]">
                  <SelectItem value="libx264" className="text-white focus:bg-[#0096D6]">H.264 (libx264)</SelectItem>
                  <SelectItem value="libx265" className="text-white focus:bg-[#0096D6]">H.265 (libx265)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className={labelClass}>CRF (18–28)</label>
              <Input
                type="number"
                min={0}
                max={51}
                value={settings.mp4.crf}
                onChange={(e) => updateMp4({ crf: parseInt(e.target.value, 10) || 20 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Preset</label>
              <Select
                value={settings.mp4.preset}
                onValueChange={(v) => updateMp4({ preset: v as Mp4Settings['preset'] })}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2A2A2A] border-[#404040]">
                  {(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'] as const).map((p) => (
                    <SelectItem key={p} value={p} className="text-white focus:bg-[#0096D6]">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Pixel format</label>
              <Input
                value={settings.mp4.pixelFormat}
                onChange={(e) => updateMp4({ pixelFormat: e.target.value })}
                className={inputClass}
                placeholder="yuv420p"
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Max width (0 = source)</label>
              <Input
                type="number"
                min={0}
                value={settings.mp4.maxWidth}
                onChange={(e) => updateMp4({ maxWidth: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>Max height (0 = source)</label>
              <Input
                type="number"
                min={0}
                value={settings.mp4.maxHeight}
                onChange={(e) => updateMp4({ maxHeight: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <Checkbox
                  checked={settings.mp4.burnin}
                  onCheckedChange={(c) => updateMp4({ burnin: !!c })}
                  className="border-[#404040] data-[state=checked]:bg-[#0096D6]"
                />
                Burn-in (shot / version / frame)
              </label>
            </div>
          </div>
        </section>

        {/* General */}
        <section className={sectionClass}>
          <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#24E1B1]" />
            General
          </h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className={labelClass}>Default S3 bucket</label>
              <Input
                value={settings.general.defaultBucket}
                onChange={(e) => updateGeneral({ defaultBucket: e.target.value })}
                className={inputClass}
                placeholder="ctrack-storage"
              />
            </div>
            <div className="space-y-2">
              <label className={labelClass}>FFmpeg path (empty = system)</label>
              <Input
                value={settings.general.ffmpegPath}
                onChange={(e) => updateGeneral({ ffmpegPath: e.target.value })}
                className={inputClass}
                placeholder="Leave empty to use system ffmpeg"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
