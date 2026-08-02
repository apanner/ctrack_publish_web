import { create } from 'zustand'

export type ElementCategory = 'media' | 'document'
export type ElementType = 'plate' | 'edit_ref' | 'other'

interface ContextState {
    projectId: string | null
    projectCode: string | null
    episodeId: string | null
    episodeCode: string | null
    shotId: string | null
    shotCode: string | null
    sequenceName: string | null
    taskId: string | null
    elementCategory: ElementCategory | null
    elementType: ElementType | null
    setProjectId: (id: string | null, code: string | null) => void
    setEpisodeId: (id: string | null, code: string | null) => void
    setShotId: (id: string | null, code: string | null, sequence: string | null, episodeCode?: string | null, episodeId?: string | null) => void
    setTaskId: (id: string | null) => void
    setElementCategory: (v: ElementCategory | null) => void
    setElementType: (v: ElementType | null) => void
    clearContext: () => void
}

export const useContextStore = create<ContextState>((set) => ({
    projectId: null,
    projectCode: null,
    episodeId: null,
    episodeCode: null,
    shotId: null,
    shotCode: null,
    sequenceName: null,
    taskId: null,
    elementCategory: null,
    elementType: null,
    setProjectId: (id, code) => set({
        projectId: id,
        projectCode: code,
        episodeId: null,
        episodeCode: null,
        shotId: null,
        shotCode: null,
        sequenceName: null,
        taskId: null
    }),
    setEpisodeId: (id, code) => set({
        episodeId: id,
        episodeCode: code,
        shotId: null,
        shotCode: null,
        sequenceName: null,
        taskId: null
    }),
    setShotId: (id, code, sequence, epCode, epId) => set({
        shotId: id,
        shotCode: code,
        sequenceName: sequence,
        episodeCode: epCode || null,
        episodeId: epId || null,
        taskId: null
    }),
    setTaskId: (id) => set({ taskId: id }),
    setElementCategory: (v) => set({ elementCategory: v }),
    setElementType: (v) => set({ elementType: v }),
    clearContext: () => set({
        projectId: null,
        projectCode: null,
        episodeId: null,
        episodeCode: null,
        shotId: null,
        shotCode: null,
        sequenceName: null,
        taskId: null,
        elementCategory: null,
        elementType: null
    }),
}))
