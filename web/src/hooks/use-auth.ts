"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase, Profile } from "@/lib/supabase"
import { resolveActiveStudio, type ActiveStudio } from "@/lib/studio"
import { useContextStore } from "@/hooks/use-context-store"
import type { Session, User } from "@supabase/supabase-js"

const queryKeys = {
  auth: {
    session: ["auth", "session"] as const,
    user: ["auth", "user"] as const,
    studio: ["auth", "studio"] as const,
  },
}

/**
 * OAuth redirect must be a URL the browser can open that serves this SPA and receives `?code=`.
 * A wrong `VITE_AUTH_CALLBACK_URL` (e.g. 127.0.0.1:3847) while the app runs on :5173 or Vercel
 * causes ERR_CONNECTION_REFUSED after Google — ignore env when it doesn't match this page's origin.
 */
function resolveOAuthRedirectTo(): string {
  const fromEnv = import.meta.env.VITE_AUTH_CALLBACK_URL?.trim()
  if (typeof window !== "undefined") {
    const fallback = `${window.location.origin}/`
    if (!fromEnv) {
      return fallback
    }
    try {
      const envOrigin = new URL(fromEnv).origin
      if (envOrigin === window.location.origin) {
        return fromEnv
      }
    } catch {
      // malformed env URL — use current origin
    }
    console.warn(
      "[useAuth] VITE_AUTH_CALLBACK_URL does not match this page — using",
      fallback,
      "Update web/.env, Vercel env, or engine setup so OAuth redirect matches where you open the app."
    )
    return fallback
  }
  return fromEnv || "http://localhost:5173/"
}

export function useAuth() {
  const queryClient = useQueryClient()
  const setStudio = useContextStore((s) => s.setStudio)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: session } = useQuery<Session | null>({
    queryKey: queryKeys.auth.session,
    queryFn: async (): Promise<Session | null> => null,
    enabled: false,
    initialData: null,
  })

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: queryKeys.auth.user,
    queryFn: async () => {
      if (!session?.user) return null
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single()
      if (error && error.code === "PGRST116") {
        await supabase.auth.signOut()
        throw new Error("USER_NOT_AUTHORIZED: No profile found")
      }
      if (error) throw error
      if (!data || !data.is_active) {
        await supabase.auth.signOut()
        return null
      }
      return data as Profile
    },
    enabled: !!session?.user,
    retry: false,
  })

  const {
    data: studioData,
    isLoading: studioLoading,
    error: studioError,
  } = useQuery({
    queryKey: queryKeys.auth.studio,
    queryFn: async () => {
      if (!session?.user || !profileData) return null
      return resolveActiveStudio(session.user.id)
    },
    enabled: !!session?.user && !!profileData,
    retry: false,
  })

  useEffect(() => {
    setUser(session?.user ?? null)
    setProfile(profileData ?? null)
    if (session?.user) setLoading(profileLoading || studioLoading)
  }, [session, profileData, profileLoading, studioLoading])

  useEffect(() => {
    if (studioData?.studioId) {
      setStudio(studioData.studioId, studioData.studio)
    } else if (!session?.user) {
      setStudio(null, null)
    }
  }, [studioData, session?.user, setStudio])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session: stored } }) => {
      if (stored) {
        queryClient.setQueryData(queryKeys.auth.session, stored)
      }
    })
  }, [queryClient])

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      queryClient.setQueryData(queryKeys.auth.session, nextSession)
      if (nextSession?.user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.user })
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.studio })
      } else {
        queryClient.setQueryData(queryKeys.auth.user, null)
        queryClient.setQueryData(queryKeys.auth.studio, null)
        setStudio(null, null)
      }
    })

    return () => subscription.unsubscribe()
  }, [queryClient, setStudio])

  const signInWithGoogle = useMutation({
    mutationFn: async () => {
      const { initializeSupabase } = await import("@/lib/supabase")
      const ok = await initializeSupabase()
      if (!ok) {
        throw new Error(
          "Missing Supabase config (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Same project as ctrack_v0."
        )
      }
      const redirectTo = resolveOAuthRedirectTo()
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      })
      if (error) throw error
      if (!data?.url) {
        throw new Error(
          "No OAuth URL returned. In Supabase Dashboard: Auth → Providers → enable Google, and Auth → URL Configuration → add Redirect URL: " +
            redirectTo
        )
      }
      return data
    },
  })

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.session, null)
      queryClient.setQueryData(queryKeys.auth.user, null)
      queryClient.setQueryData(queryKeys.auth.studio, null)
      setStudio(null, null)
    },
  })

  return {
    user,
    profile,
    session,
    loading,
    hasSession: !!session?.user,
    hasProfile: !!profile,
    studioId: studioData?.studioId ?? null,
    studio: (studioData?.studio as ActiveStudio | undefined) ?? null,
    studioRole: studioData?.membershipRole ?? null,
    studioError: studioError instanceof Error ? studioError.message : null,
    hasStudio: !!studioData?.studioId,
    signInWithGoogle: signInWithGoogle.mutateAsync,
    signOut: signOut.mutateAsync,
    isAuthenticated: !!(user && profile && profile.is_active && studioData?.studioId),
    isAdmin: profile?.role === "admin" || profile?.role === "manager",
    isArtist: profile?.role === "artist",
  }
}
