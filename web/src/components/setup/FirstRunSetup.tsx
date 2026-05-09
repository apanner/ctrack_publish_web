"use client"

import { useCallback, useState, type ChangeEvent, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

interface FirstRunSetupProps {
  engineBase: string
  onFinished: () => void
}

const DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

export function FirstRunSetup({ engineBase, onFinished }: FirstRunSetupProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
    VITE_AUTH_CALLBACK_URL: "",
    STORAGE_PROVIDER: "hybrid",
    AWS_REGION: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_S3_BUCKET_NAME: "",
    HYBRID_STORAGE_PRIMARY_ENDPOINT: "",
    HYBRID_STORAGE_PRIMARY_BUCKET: "",
    HYBRID_STORAGE_PRIMARY_ACCESS_KEY: "",
    HYBRID_STORAGE_PRIMARY_SECRET_KEY: "",
    HYBRID_STORAGE_PRIMARY_REGION: "us-east-1",
    CTRACK_ENGINE_PORT: "7777",
    CTRACK_ENGINE_HOST: "127.0.0.1",
    CTRACK_WEB_ORIGINS: DEFAULT_ORIGINS,
  })

  const set =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
    }

  const validate = useCallback((): string | null => {
    if (!form.VITE_SUPABASE_URL.trim() || !form.VITE_SUPABASE_ANON_KEY.trim()) {
      return "Supabase URL and anon key are required."
    }
    const awsOk =
      !!form.AWS_ACCESS_KEY_ID.trim() &&
      !!form.AWS_SECRET_ACCESS_KEY.trim() &&
      !!form.AWS_S3_BUCKET_NAME.trim()
    const hybridOk =
      !!form.HYBRID_STORAGE_PRIMARY_ENDPOINT.trim() &&
      !!form.HYBRID_STORAGE_PRIMARY_BUCKET.trim() &&
      !!form.HYBRID_STORAGE_PRIMARY_ACCESS_KEY.trim() &&
      !!form.HYBRID_STORAGE_PRIMARY_SECRET_KEY.trim()
    if (!awsOk && !hybridOk) {
      return "Provide either full AWS credentials + bucket, or full hybrid / MinIO fields."
    }
    return null
  }, [form])

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const v = validate()
      if (v) {
        setError(v)
        return
      }
      setSaving(true)
      setError("")
      try {
        const res = await fetch(`${engineBase}/api/setup/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
        const data = (await res.json()) as { ok?: boolean; complete?: boolean; error?: string }
        if (!res.ok) {
          throw new Error(data.error || `Save failed (${res.status})`)
        }
        if (!data.complete) {
          setError("Engine still reports incomplete configuration. Check required fields.")
          return
        }
        onFinished()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [engineBase, form, onFinished, validate]
  )

  const labelClass = "text-[10px] text-gray-400 font-semibold uppercase tracking-wider"
  const inputClass = "bg-[#1A1A1A] border-[#404040] text-white h-9 font-mono text-xs"

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1A1A1A] p-4 overflow-auto">
      <Card className="w-full max-w-2xl border-[#404040] bg-[#2A2A2A]">
        <CardHeader>
          <CardTitle className="text-2xl text-[#24E1B1]">Welcome — connect CTrack</CardTitle>
          <CardDescription className="text-gray-400">
            One-time setup. Values are saved to your profile folder (no manual file copy). The local engine must be running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive" className="border-red-800 bg-red-900/30 text-red-200">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Supabase</h3>
              <div className="space-y-2">
                <label className={labelClass}>Project URL</label>
                <Input className={inputClass} value={form.VITE_SUPABASE_URL} onChange={set("VITE_SUPABASE_URL")} placeholder="https://xxxx.supabase.co" />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Anon key</label>
                <Input className={inputClass} value={form.VITE_SUPABASE_ANON_KEY} onChange={set("VITE_SUPABASE_ANON_KEY")} placeholder="eyJ..." />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>OAuth redirect (optional)</label>
                <Input className={inputClass} value={form.VITE_AUTH_CALLBACK_URL} onChange={set("VITE_AUTH_CALLBACK_URL")} placeholder="http://localhost:5173/" />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-white">AWS S3 (direct uploads)</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClass}>Region</label>
                  <Input className={inputClass} value={form.AWS_REGION} onChange={set("AWS_REGION")} placeholder="ap-south-1" />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Bucket</label>
                  <Input className={inputClass} value={form.AWS_S3_BUCKET_NAME} onChange={set("AWS_S3_BUCKET_NAME")} />
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Access key ID</label>
                <Input className={inputClass} value={form.AWS_ACCESS_KEY_ID} onChange={set("AWS_ACCESS_KEY_ID")} />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Secret access key</label>
                <Input type="password" className={inputClass} value={form.AWS_SECRET_ACCESS_KEY} onChange={set("AWS_SECRET_ACCESS_KEY")} />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Hybrid / MinIO (optional if AWS above is complete)</h3>
              <div className="space-y-2">
                <label className={labelClass}>Storage provider</label>
                <Input className={inputClass} value={form.STORAGE_PROVIDER} onChange={set("STORAGE_PROVIDER")} placeholder="hybrid" />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Endpoint</label>
                <Input className={inputClass} value={form.HYBRID_STORAGE_PRIMARY_ENDPOINT} onChange={set("HYBRID_STORAGE_PRIMARY_ENDPOINT")} placeholder="http://host:9000" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClass}>Bucket</label>
                  <Input className={inputClass} value={form.HYBRID_STORAGE_PRIMARY_BUCKET} onChange={set("HYBRID_STORAGE_PRIMARY_BUCKET")} />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Region</label>
                  <Input className={inputClass} value={form.HYBRID_STORAGE_PRIMARY_REGION} onChange={set("HYBRID_STORAGE_PRIMARY_REGION")} />
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Access key</label>
                <Input className={inputClass} value={form.HYBRID_STORAGE_PRIMARY_ACCESS_KEY} onChange={set("HYBRID_STORAGE_PRIMARY_ACCESS_KEY")} />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Secret key</label>
                <Input type="password" className={inputClass} value={form.HYBRID_STORAGE_PRIMARY_SECRET_KEY} onChange={set("HYBRID_STORAGE_PRIMARY_SECRET_KEY")} />
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Engine (advanced)</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClass}>Port</label>
                  <Input className={inputClass} value={form.CTRACK_ENGINE_PORT} onChange={set("CTRACK_ENGINE_PORT")} />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Host</label>
                  <Input className={inputClass} value={form.CTRACK_ENGINE_HOST} onChange={set("CTRACK_ENGINE_HOST")} />
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Web origins (CORS)</label>
                <Input className={inputClass} value={form.CTRACK_WEB_ORIGINS} onChange={set("CTRACK_WEB_ORIGINS")} />
              </div>
            </section>

            <Button type="submit" disabled={saving} className="w-full bg-[#0096D6] hover:bg-[#0096D6]/90 h-11 text-white">
              {saving ? "Saving…" : "Save & continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
