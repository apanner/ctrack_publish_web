/**
 * Maps task codes from studio_dictionary_items to shot_tasks.department values.
 * shot_tasks.department constraint: 'Roto' | 'Prep' | 'Comp' | 'Camera'
 */

export type ShotTaskDepartment = 'Roto' | 'Prep' | 'Comp' | 'Camera'

export function mapTaskCodeToDepartment(
  taskCode: string,
  taskLabel?: string
): ShotTaskDepartment {
  const codeLower = (taskCode || '').toLowerCase()
  const labelLower = (taskLabel || '').toLowerCase()
  const combined = `${codeLower} ${labelLower}`.trim()

  if (codeLower === 'roto' || codeLower === 'rotoscop' || codeLower === 'rotopaint' || codeLower === 'roto_paint') return 'Roto'
  if (codeLower === 'prep' || codeLower === 'prepare' || codeLower === 'plate' || codeLower === 'ingest') return 'Prep'
  if (codeLower === 'comp' || codeLower === 'compositing' || codeLower === 'composite' || codeLower === 'qc') return 'Comp'
  if (codeLower === 'camera' || codeLower === 'cam' || codeLower === 'matchmove' || codeLower === 'track' || codeLower === 'tracking') return 'Camera'

  if (labelLower.includes('roto') || labelLower.includes('rotoscop') || labelLower.includes('paint')) return 'Roto'
  if (labelLower.includes('prep') || labelLower.includes('prepare') || labelLower.includes('plate') || labelLower.includes('ingest')) return 'Prep'
  if (labelLower.includes('comp') || labelLower.includes('composit') || labelLower.includes('qc') || labelLower.includes('lighting') || labelLower.includes('fx') || labelLower.includes('anim') || labelLower.includes('layout') || labelLower.includes('cfx')) return 'Comp'
  if (labelLower.includes('camera') || labelLower.includes('matchmove') || labelLower.includes('track') || labelLower.includes('tracking')) return 'Camera'

  if (combined.includes('roto') || combined.includes('paint')) return 'Roto'
  if (combined.includes('prep') || combined.includes('plate') || combined.includes('ingest')) return 'Prep'
  if (combined.includes('comp') || combined.includes('composit') || combined.includes('light') || combined.includes('effect') || combined.includes('anim')) return 'Comp'
  if (combined.includes('camera') || combined.includes('matchmove') || combined.includes('track')) return 'Camera'

  return 'Comp'
}
