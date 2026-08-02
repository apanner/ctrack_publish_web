export interface StagingItem {
  filePath: string
  fileName: string
  size: number
  /** For EXR/sequence: first frame number */
  frameStart?: number
  /** For EXR/sequence: last frame number */
  frameEnd?: number
  /**
   * Absolute path for the local engine / FFmpeg (set after engine folder confirm or native pick).
   * Persisted in `staging.json` (unlike `browserBundle`). UI can keep showing `fileName` / virtual `filePath`.
   */
  engineInputPath?: string
  /**
   * In-memory only: original File objects from folder picker / drag-drop (for detection + gap QC).
   * Stripped before `staging:write`. Publish uses real disk paths only (e.g. File.path in Electron); EXRs are not copied to the engine.
   */
  browserBundle?: { files: File[] }
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
