"use client"

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, Profile } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const queryKeys = {
    auth: {
        session: ['auth', 'session'] as const,
        user: ['auth', 'user'] as const,
    },
}

export function useAuth() {
    const queryClient = useQueryClient()
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [loading, setLoading] = useState(false)

    // Session from cache only (no initial fetch) – set by callback after exchangeCodeForSession
    const { data: session } = useQuery({
        queryKey: queryKeys.auth.session,
        queryFn: async () => null,
        enabled: false,
        initialData: null,
    })

    // Get user profile when session exists
    const { data: profileData, isLoading: profileLoading } = useQuery({
        queryKey: queryKeys.auth.user,
        queryFn: async () => {
            if (!session?.user) return null
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single()
            if (error && error.code === 'PGRST116') {
                await supabase.auth.signOut()
                throw new Error('USER_NOT_AUTHORIZED: No profile found')
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

    // Session is driven by OAuth callback (set in App) and onAuthStateChange only.
    // Do NOT call signOut() on mount – it runs async and wipes the session right after
    // exchangeCodeForSession succeeds, so the app would stay on the login screen.

    useEffect(() => {
        setUser(session?.user ?? null)
        setProfile(profileData ?? null)
        if (session?.user) setLoading(profileLoading)
    }, [session, profileData, profileLoading])

    // Listen to auth changes
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
            queryClient.setQueryData(queryKeys.auth.session, session)
            if (session?.user) {
                queryClient.invalidateQueries({ queryKey: queryKeys.auth.user })
            } else {
                queryClient.setQueryData(queryKeys.auth.user, null)
            }
        })

        return () => subscription.unsubscribe()
    }, [queryClient])

    const signInWithGoogle = useMutation({
        mutationFn: async () => {
            const redirectTo =
                import.meta.env.VITE_AUTH_CALLBACK_URL?.trim() ||
                `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'}/`
            if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
                throw new Error('Missing Supabase config (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Check .env.')
            }
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo,
                    skipBrowserRedirect: true,
                },
            })
            if (error) throw error
            if (!data?.url) {
                throw new Error(
                    'No OAuth URL returned. In Supabase Dashboard: Auth → Providers → enable Google, and Auth → URL Configuration → add Redirect URL: ' + redirectTo
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
        },
    })

    return {
        user,
        profile,
        session,
        loading,
        hasSession: !!session?.user,
        hasProfile: !!profile,
        signInWithGoogle: signInWithGoogle.mutateAsync,
        signOut: signOut.mutateAsync,
        isAuthenticated: !!(user && profile && profile.is_active),
        isAdmin: profile?.role === 'admin' || profile?.role === 'manager',
        isArtist: profile?.role === 'artist',
    }
}
