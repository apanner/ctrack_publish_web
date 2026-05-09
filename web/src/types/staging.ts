export interface StagingItem {
  filePath: string
  fileName: string
  size: number
  /** For EXR/sequence: first frame number */
  frameStart?: number
  /** For EXR/sequence: last frame number */
  frameEnd?: number
}

export interface StagingFormData {
  projectId: string | null
  shotId: string | null
  taskId: string | null
  tab: 'element' | 'version'
  elementLabel?: string
  elementNotes?: string
  elementCategory?: string
  elementType?: string
  deliveryType?: string
  submissionNotes?: string
  versionOverride?: boolean
  versionName?: string
}

export interface StagingData {
  items: StagingItem[]
  formData: StagingFormData | null
}
