"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function LoginPage() {
    const { signInWithGoogle, loading: authLoading, isAuthenticated } = useAuth()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        if (isAuthenticated) return
        const onFocus = () => setLoading((prev) => (prev ? false : prev))
        window.addEventListener("focus", onFocus)
        return () => window.removeEventListener("focus", onFocus)
    }, [isAuthenticated])

    const handleGoogleSignIn = async () => {
        try {
            setLoading(true)
            setError("")
            const result = await signInWithGoogle()
            const url = result?.url
            if (!url || typeof url !== "string") {
                setError("No login URL received. Check Supabase: Google provider enabled and Redirect URL added.")
                setLoading(false)
                return
            }
            // Always use IPC to open in system browser (not Electron window)
            const w = window as Window & { ipcRenderer?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } }
            if (w.ipcRenderer) {
                console.log("[LoginPage] Opening OAuth URL in system browser via IPC:", url)
                await w.ipcRenderer.invoke("open-external-url", url)
            } else {
                // Fallback: if IPC not available (dev mode), try window.open but warn
                console.warn("[LoginPage] IPC not available, using window.open fallback")
                window.open(url, "_blank", "noopener,noreferrer")
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setError(message || "Authentication failed. Please try again.")
            console.error("Login error:", err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#1A1A1A] p-4">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-[#24E1B1]">CTrack Publisher</h1>
                    <p className="mt-2 text-gray-400">Production Tracking System</p>
                </div>

                <Card className="border-[#404040] bg-[#2A2A2A]">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl text-white">Sign in</CardTitle>
                        <CardDescription className="text-gray-400">
                            Enter your credentials to access your account
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {error && (
                            <Alert variant="destructive" className="mb-4 border-red-800 bg-red-900/30 text-red-300">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Error</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <div className="space-y-4">
                            <Button
                                type="button"
                                className="w-full bg-[#0096D6] hover:bg-[#0096D6]/90 text-white h-12 text-base"
                                onClick={handleGoogleSignIn}
                                disabled={loading || authLoading}
                            >
                                {loading || authLoading ? (
                                    <span className="flex items-center">
                                        <Spinner size="sm" className="-ml-1 mr-3" />
                                        Signing in...
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center">
                                        <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                                            <path
                                                fill="currentColor"
                                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                            />
                                        </svg>
                                        Sign in with Google
                                    </span>
                                )}
                            </Button>

                            <p className="text-xs text-center text-gray-400">
                                Only authorized users can access this system
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
