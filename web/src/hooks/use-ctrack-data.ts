"use client"

import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"

export interface DBProject {
    id: string
    name: string
    code: string
    status: string
    project_type: 'Film' | 'TV Episode'
}

export interface DBEpisode {
    id: string
    project_id: string
    episode_number: number
    name: string
    code: string
    status: string
}

export interface DBShot {
    id: string
    project_id: string
    shot_code: string
    sequence_name?: string
    episode_id?: string
    episodes?: {
        code: string
    } | { code: string }[]
    projects?: {
        code: string
    } | { code: string }[]
    status: string
}

export interface DBTask {
    id: string
    shot_id: string
    name: string
    status: string
}
// DB column is task_name; we map to name for UI

const queryKeys = {
    projects: ["projects"] as const,
    shots: (projectId: string) => ["shots", projectId] as const,
    tasks: (shotId: string) => ["tasks", shotId] as const,
}

// Fetch Projects
export function useProjects() {
    return useQuery({
        queryKey: queryKeys.projects,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("projects")
                .select("id, name, code, status, project_type")
                .order("name")

            if (error) throw error
            return data as DBProject[]
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    })
}

// Fetch Episodes for a Project
export function useEpisodes(projectId?: string) {
    return useQuery({
        queryKey: ["episodes", projectId],
        queryFn: async () => {
            if (!projectId) return []
            const { data, error } = await supabase
                .from("episodes")
                .select("*")
                .eq("project_id", projectId)
                .order("episode_number")

            if (error) throw error
            return data as DBEpisode[]
        },
        enabled: !!projectId,
        staleTime: 1000 * 60 * 5,
    })
}

// Fetch Shots for a Project (with optional Episode filter)
export function useShots(projectId?: string, episodeId?: string) {
    return useQuery({
        queryKey: ["shots", projectId, episodeId],
        queryFn: async () => {
            if (!projectId) return []
            let query = supabase
                .from("shots")
                .select("id, project_id, shot_code, sequence_name, status, episode_id, episodes(code), projects(code)")
                .eq("project_id", projectId)

            if (episodeId) {
                query = query.eq("episode_id", episodeId)
            }

            const { data, error } = await query.order("shot_code")

            if (error) throw error
            return (data ?? []) as unknown as DBShot[]
        },
        enabled: !!projectId,
        staleTime: 1000 * 60 * 5,
    })
}

// Fetch Tasks for a Shot
export function useTasks(shotId?: string) {
    return useQuery({
        queryKey: queryKeys.tasks(shotId || ""),
        queryFn: async () => {
            if (!shotId) return []
            const { data, error } = await supabase
                .from("shot_tasks")
                .select("id, shot_id, task_name, status")
                .eq("shot_id", shotId)
                .order("task_name")

            if (error) throw error
            return (data ?? []).map((row: { id: string; shot_id: string; task_name: string; status: string }) => ({
                id: row.id,
                shot_id: row.shot_id,
                name: row.task_name,
                status: row.status,
            })) as DBTask[]
        },
        enabled: !!shotId,
        staleTime: 1000 * 60 * 5,
    })
}

export interface DBProfile {
    id: string
    full_name: string
    role: string
    department?: string
}

const NOTIFICATION_ROLES = ['supervisor', 'manager', 'production', 'admin']

export function useNotificationRecipients() {
    return useQuery({
        queryKey: ['notification-recipients'] as const,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, role, department")
                .in("role", NOTIFICATION_ROLES)
                .order("full_name")
            if (error) throw error
            return (data ?? []) as DBProfile[]
        },
        staleTime: 1000 * 60 * 5,
    })
}

export function useNextVersionNumber(shotId: string | undefined) {
    return useQuery({
        queryKey: ['next-version', shotId] as const,
        queryFn: async () => {
            if (!shotId) return 1
            const { data, error } = await supabase
                .from("shot_versions")
                .select("version_number")
                .eq("shot_id", shotId)
                .order("version_number", { ascending: false })
                .limit(1)
            if (error) throw error
            const max = data?.[0]?.version_number ?? 0
            return max + 1
        },
        enabled: !!shotId,
        staleTime: 1000 * 30,
    })
}

/** Next element label: plate always v000 (base input plate); others v001, v002, ... */
export function useNextElementLabel(shotId: string | undefined, elementType?: 'plate' | 'edit_ref' | 'other') {
    return useQuery({
        queryKey: ['next-element-label', shotId, elementType] as const,
        queryFn: async () => {
            if (elementType === 'plate') return 'v000'
            if (!shotId) return 'v001'
            const { data, error } = await supabase
                .from('shot_elements')
                .select('version_number')
                .eq('shot_id', shotId)
            if (error) throw error
            const nums = (data ?? [])
                .map((r: { version_number: number | null }) => r.version_number ?? -1)
                .filter((n) => n >= 0)
            const max = nums.length > 0 ? Math.max(...nums) : 0
            const next = max + 1
            return `v${String(next).padStart(3, '0')}`
        },
        enabled: !!shotId || elementType === 'plate',
        staleTime: 1000 * 30,
    })
}

/** 
 * Predicts the next Tracking Number (CTS) for a project.
 * Checks both shot_versions and shot_elements.
 */
export function useNextTrackingNumber(projectId: string | undefined) {
    return useQuery({
        queryKey: ['next-tracking-number', projectId] as const,
        queryFn: async () => {
            if (!projectId) return '—'

            // 1. Get project code
            const { data: projectData, error: pError } = await supabase
                .from('projects')
                .select('code')
                .eq('id', projectId)
                .single()

            if (pError || !projectData?.code) return '—'
            const code = projectData.code

            // 2. Query versions and elements for max tracking number
            const [versionsRes, elementsRes] = await Promise.all([
                supabase
                    .from('shot_versions')
                    .select('tracking_number')
                    .eq('project_id', projectId)
                    .not('tracking_number', 'is', null)
                    .like('tracking_number', `${code}-%`),
                supabase
                    .from('shot_elements')
                    .select('tracking_number')
                    .eq('project_id', projectId)
                    .not('tracking_number', 'is', null)
                    .like('tracking_number', `${code}-%`)
            ])

            const vNums = (versionsRes.data ?? []).map(r => {
                const match = r.tracking_number?.match(new RegExp(`^${code}-(\\d+)$`))
                return match ? parseInt(match[1], 10) : 0
            })
            const eNums = (elementsRes.data ?? []).map(r => {
                const match = r.tracking_number?.match(new RegExp(`^${code}-(\\d+)$`))
                return match ? parseInt(match[1], 10) : 0
            })

            const max = Math.max(0, ...vNums, ...eNums)
            const nextVal = max + 1
            return `${code}-${String(nextVal).padStart(4, '0')}`
        },
        enabled: !!projectId,
        staleTime: 1000 * 30,
    })
}

/** Result of looking up a shot by its code across all projects (for Smart-Fill). */
export interface ShotByCodeResult {
    projectId: string
    projectCode: string | null
    shotId: string
    shotCode: string
    sequenceName: string | null
    episodeId: string | null
    episodeCode: string | null
}

/**
 * Finds a shot by shot_code across all projects. Used when Smart-Fill parses
 * a path and wants to pre-fill Project + Shot. Returns first match if multiple.
 */
export async function findShotByCode(shotCode: string): Promise<ShotByCodeResult | null> {
    if (!shotCode.trim()) return null
    const normalized = shotCode.trim().toUpperCase()
    const { data, error } = await supabase
        .from("shots")
        .select("id, project_id, shot_code, sequence_name, episode_id, episodes(code)")
        .ilike("shot_code", normalized)
        .limit(1)
    if (error || !data?.length) return null
    const row = data[0] as {
        id: string
        project_id: string
        shot_code: string
        sequence_name?: string | null
        episode_id?: string | null
        episodes?: { code?: string | null } | { code?: string | null }[]
    }
    const episodeResult = row.episodes
    const joinedEpisodeCode = Array.isArray(episodeResult) ? episodeResult[0]?.code ?? null : episodeResult?.code ?? null
    const { data: projectData } = await supabase
        .from("projects")
        .select("code")
        .eq("id", row.project_id)
        .single()
    const projectCode = projectData?.code ?? null

    return {
        projectId: row.project_id,
        projectCode,
        shotId: row.id,
        shotCode: row.shot_code,
        sequenceName: row.sequence_name ?? null,
        episodeId: row.episode_id ?? null,
        episodeCode: joinedEpisodeCode
    }
}
