import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Toaster, toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { AuthGuard } from "@/components/auth/AuthGuard"
import { AppShell } from "@/components/layout/AppShell"
import { LoadingOverlay } from "@/components/ui/spinner"

const AUTH_QUERY_KEYS = { session: ["auth", "session"] as const, user: ["auth", "user"] as const }

function readOAuthCodeFromSearch(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("code")
}

function App() {
  const queryClient = useQueryClient()
  const codeHandledRef = useRef(false)
  const [oauthReturnBusy, setOauthReturnBusy] = useState(() => !!readOAuthCodeFromSearch())

  /** Handle OAuth code: from main push (auth-callback-code) or poll (auth:get-pending-code) */
  const handleAuthCode = useCallback(
    async (code: string | null) => {
      if (!code || typeof code !== "string" || codeHandledRef.current) return
      codeHandledRef.current = true
      toast.info("Completing sign in…", { duration: 5000 })
      try {
        const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) throw error
        queryClient.setQueryData(AUTH_QUERY_KEYS.session, session)
        if (session?.user) {
          await queryClient.refetchQueries({ queryKey: AUTH_QUERY_KEYS.user })
        }
        toast.success("Signed in successfully")
      } catch (err) {
        codeHandledRef.current = false
        toast.error(err instanceof Error ? err.message : "Sign in failed")
      }
    },
    [queryClient]
  )

  /** Browser OAuth return (Google → Supabase → this app): strip ?code= synchronously so StrictMode/double-mount does not reuse it */
  useLayoutEffect(() => {
    const code = readOAuthCodeFromSearch()
    if (!code) return
    const url = new URL(window.location.href)
    url.searchParams.delete("code")
    url.searchParams.delete("state")
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
    void handleAuthCode(code).finally(() => setOauthReturnBusy(false))
  }, [handleAuthCode])

  useEffect(() => {
    const w = window as Window & {
      ipcRenderer?: {
        invoke: (ch: string) => Promise<string | null>
        on: (ch: string, fn: (_: unknown, code: string) => void) => (() => void) | void
      }
    }
    if (!w.ipcRenderer) return
    const onCode = (_: unknown, code: string) => void handleAuthCode(code)
    const unsubscribe = w.ipcRenderer.on("auth-callback-code", onCode)
    const interval = setInterval(() => {
      if (codeHandledRef.current) return
      w.ipcRenderer!.invoke("auth:get-pending-code").then(handleAuthCode)
    }, 400)
    return () => {
      if (typeof unsubscribe === "function") unsubscribe()
      clearInterval(interval)
    }
  }, [handleAuthCode])

  if (oauthReturnBusy) {
    return (
      <>
        <LoadingOverlay message="Completing sign in…" />
        <Toaster position="bottom-right" richColors theme="dark" />
      </>
    )
  }

  return (
    <>
      <AuthGuard>
        <AppShell />
      </AuthGuard>
      <Toaster position="bottom-right" richColors theme="dark" />
    </>
  )
}

export default App
