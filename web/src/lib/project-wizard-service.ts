import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/error-message'
import { mapTaskCodeToDepartment } from '@/lib/task-department-mapper'

function throwDb(err: unknown, context: string): never {
  throw new Error(`${context}: ${getErrorMessage(err)}`)
}

export interface WizardProjectData {
  project_type: 'Film' | 'TV Episode'
  name: string
  code: string
  description: string
  start_date: string | null
  delivery_date: string | null
  client_name: string
  status: 'Active' | 'On Hold' | 'Completed' | 'Cancelled'
  thumbnail_url?: string | null
}

export interface WizardEpisodeData {
  episode_number: number
  code: string
  name: string | null
  air_date: string | null
}

export interface WizardSequenceData {
  episode_id?: string
  name: string
  code: string
  description: string | null
}

export interface WizardShotData {
  episode_id?: string
  sequence_name: string
  shot_name: string
  shot_code: string
  description: string | null
  start_frame: number | null
  end_frame: number | null
  task_codes: string[]
  enabled: boolean
}

export interface WizardData {
  project: WizardProjectData
  episodes: WizardEpisodeData[]
  sequences: WizardSequenceData[]
  shots: WizardShotData[]
  creator_id?: string
}

export interface CreateProjectResult {
  projectId: string
  projectCode: string
  shots: Array<{
    id: string
    shot_code: string
    sequence_name: string
    episode_id?: string | null
    episode_code?: string | null
  }>
}

/**
 * Loads task options from studio_dictionaries + studio_dictionary_items.
 */
export async function loadTaskOptions(): Promise<Array<{ code: string; label: string }>> {
  const { data: dict, error: dictError } = await supabase
    .from('studio_dictionaries')
    .select('id')
    .eq('key', 'tasks')
    .maybeSingle()

  if (dictError || !dict) return []

  const { data: items, error: itemsError } = await supabase
    .from('studio_dictionary_items')
    .select('code, label')
    .eq('dictionary_id', dict.id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('label', { ascending: true })

  if (itemsError || !items) return []
  return items.map((i: { code: string; label: string }) => ({ code: i.code, label: i.label }))
}

/**
 * Creates a project with episodes (TV), sequences, shots, and shot_tasks via Supabase.
 * Uses anon client; RLS must allow the user (e.g. admin, or supervisor with PROJECT_CREATE / SHOT_CREATE per matrix + policies).
 * Returns projectId and created shots for bulk ingest mapping.
 */
export async function createProjectFromWizard(data: WizardData): Promise<CreateProjectResult> {
  const projectCode = data.project.code.trim().toUpperCase()

  // 1. Create project
  const { data: projectData, error: projectError } = await supabase
    .from('projects')
    .insert({
      name: data.project.name,
      code: projectCode,
      description: data.project.description?.trim() || null,
      start_date: data.project.start_date?.trim() || null,
      delivery_date: data.project.delivery_date?.trim() || null,
      client_name: data.project.client_name || null,
      status: data.project.status,
      project_type: data.project.project_type || 'Film',
      thumbnail_url: data.project.thumbnail_url ?? null,
    })
    .select('id, folder_id')
    .single()

  if (projectError) throwDb(projectError, 'Could not create project')
  const projectId = projectData.id

  // 2. Create episodes (TV only)
  const episodeIdByCode = new Map<string, string>()
  if (data.project.project_type === 'TV Episode' && data.episodes.length > 0) {
    const episodesPayload = data.episodes.map((ep) => ({
      project_id: projectId,
      episode_number: ep.episode_number,
      code: ep.code.trim().toUpperCase(),
      name: ep.name?.trim() || null,
      air_date: ep.air_date?.trim() || null,
      status: 'Active' as const,
    }))

    const { data: episodesData, error: episodesError } = await supabase
      .from('episodes')
      .insert(episodesPayload)
      .select('id, code')

    if (episodesError) throwDb(episodesError, 'Could not create episodes')
    if (episodesData) {
      episodesData.forEach((ep: { id: string; code: string }) =>
        episodeIdByCode.set(String(ep.code).toUpperCase(), String(ep.id))
      )
    }
  }

  // 3. Create sequences
  const sequenceFolderIdMap = new Map<string, number>()
  if (data.sequences.length > 0) {
    const sequencesPayload = data.sequences.map((seq) => {
      const payload: Record<string, unknown> = {
        project_id: projectId,
        name: seq.name.trim(),
        code: seq.code.trim().toUpperCase(),
        description: seq.description?.trim() || null,
        status: 'Active' as const,
      }
      if (data.project.project_type === 'TV Episode' && seq.episode_id) {
        const episodeId = episodeIdByCode.get(seq.episode_id.toUpperCase())
        if (episodeId) payload.episode_id = episodeId
      }
      return payload
    })

    const { data: sequencesData, error: sequencesError } = await supabase
      .from('sequences')
      .insert(sequencesPayload)
      .select('id, code, folder_id')

    if (sequencesError) throwDb(sequencesError, 'Could not create sequences')
    if (sequencesData) {
      sequencesData.forEach((seq: { code: string; folder_id?: number }) => {
        if (seq.code && seq.folder_id != null) {
          sequenceFolderIdMap.set(String(seq.code).toUpperCase(), seq.folder_id)
        }
      })
    }
  }

  // 4. Create shots
  const episodeCodeById = new Map<string, string>()
  episodeIdByCode.forEach((id, code) => episodeCodeById.set(id, code))

  const enabledShots = data.shots.filter((s) => s.enabled)
  const shotsResult: CreateProjectResult['shots'] = []

  for (const shot of enabledShots) {
    const duration_frames =
      shot.start_frame != null &&
      shot.end_frame != null &&
      shot.end_frame >= shot.start_frame
        ? shot.end_frame - shot.start_frame + 1
        : null

    const shotPayload: Record<string, unknown> = {
      project_id: projectId,
      shot_code: shot.shot_code.trim().toUpperCase(),
      sequence_name: shot.sequence_name.trim().toUpperCase(),
      description: shot.description?.trim() || null,
      department: 'Comp' as const,
      due_date: data.project.delivery_date || new Date().toISOString().split('T')[0],
      start_frame: shot.start_frame,
      end_frame: shot.end_frame,
      duration_frames,
      status: 'Waiting to Start' as const,
      priority: 'Medium' as const,
      estimated_hours: 8.0,
      actual_hours: 0.0,
      fps: 24.0,
    }
    if (data.project.project_type === 'TV Episode' && shot.episode_id) {
      const episodeId = episodeIdByCode.get(shot.episode_id.toUpperCase())
      if (episodeId) shotPayload.episode_id = episodeId
    }

    const { data: insertedShot, error: shotError } = await supabase
      .from('shots')
      .insert(shotPayload)
      .select('id, shot_code, sequence_name, episode_id')
      .single()

    if (shotError) throwDb(shotError, `Could not create shot ${shot.shot_code}`)
    if (insertedShot) {
      shotsResult.push({
        id: insertedShot.id,
        shot_code: insertedShot.shot_code,
        sequence_name: insertedShot.sequence_name ?? '',
        episode_id: insertedShot.episode_id ?? null,
        episode_code: insertedShot.episode_id
          ? episodeCodeById.get(insertedShot.episode_id) ?? null
          : null,
      })
    }
  }

  // 5. Create shot_tasks
  if (shotsResult.length > 0) {
    const { data: dictData, error: dictError } = await supabase
      .from('studio_dictionaries')
      .select('id')
      .eq('key', 'tasks')
      .maybeSingle()

    if (!dictError && dictData) {
      const { data: taskItems, error: itemsError } = await supabase
        .from('studio_dictionary_items')
        .select('code, label')
        .eq('dictionary_id', dictData.id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('label', { ascending: true })

      if (!itemsError && taskItems && taskItems.length > 0) {
        const shotIdByCode = new Map<string, string>()
        shotsResult.forEach((s) => shotIdByCode.set(String(s.shot_code).toUpperCase(), String(s.id)))

        const tasksToInsert: Record<string, unknown>[] = []

        for (const shot of enabledShots) {
          const shotId = shotIdByCode.get(shot.shot_code.toUpperCase())
          if (!shotId) continue

          for (const taskCode of shot.task_codes) {
            const taskItem = taskItems.find((t: { code: string }) => t.code === taskCode)
            if (!taskItem) continue

            const department = mapTaskCodeToDepartment(taskCode, taskItem.label)

            tasksToInsert.push({
              project_id: projectId,
              shot_id: shotId,
              task_name: taskItem.label,
              department,
              status: 'Waiting to Start',
              priority: 'Medium',
              estimated_hours: 8.0,
              actual_hours: 0.0,
            })
          }
        }

        if (tasksToInsert.length > 0) {
          const { error: tasksError } = await supabase.from('shot_tasks').insert(tasksToInsert)
          if (tasksError) throwDb(tasksError, 'Could not create shot tasks')
        }
      }
    }
  }

  return { projectId, projectCode, shots: shotsResult }
}
