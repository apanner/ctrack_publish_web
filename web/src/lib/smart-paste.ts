/**
 * Smart Paste for project creation wizard — ported from ctrack_v0.
 * Detects columns from Excel/CSV paste (shot, task, notes, frame range).
 */

export const COL_AUTO = -1

export const MAPPING_LABELS: Record<keyof ColumnMapping, string> = {
  shot: 'Shot name',
  task: 'Task',
  notes: 'Notes / Work description',
  frameStart: 'Frame start',
  frameEnd: 'Frame end',
}

export interface ColumnMapping {
  shot: number
  task: number
  notes: number
  frameStart: number
  frameEnd: number
}

export interface ParsedShotRow {
  shotName: string
  frameRange: string
  notes: string
  taskCode: string
}

/** Parse structured Work Description from Excel (Scope: ... Shot Description: ...). */
export function parseStructuredWorkDescription(cell: string): string {
  const raw = cell.trim()
  if (!raw) return ''
  const scopeMatch = raw.match(/\bScope:\s*([^\n]+?)(?=\s*Shot\s+Description:|\s*$)/i)
  const shotDescMatch = raw.match(/\bShot\s+Description:\s*([\s\S]*)/i)
  const scope = scopeMatch ? scopeMatch[1].trim() : ''
  const shotDesc = shotDescMatch ? shotDescMatch[1].trim() : ''
  if (scope && shotDesc) return `Scope: ${scope}\n${shotDesc}`
  if (shotDesc) return shotDesc
  if (scope) return `Scope: ${scope}`
  return raw
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build loose regex from example shot name (e.g. STU102_010_0020). */
export function buildLooseShotRegexFromExample(example: string): RegExp | null {
  const raw = example.trim().toUpperCase()
  if (!raw) return null
  const tokens: string[] = []
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < raw.length && /[0-9]/.test(raw[j])) j++
      tokens.push('\\d+')
      i = j
      continue
    }
    if (/[A-Z]/.test(ch)) {
      let j = i
      while (j < raw.length && /[A-Z]/.test(raw[j])) j++
      tokens.push('[A-Z]+')
      i = j
      continue
    }
    if (ch === '_' || ch === '-' || ch === '.') {
      tokens.push(escapeRegex(ch))
      i += 1
      continue
    }
    tokens.push(escapeRegex(ch))
    i += 1
  }
  try {
    return new RegExp(`^${tokens.join('')}$`, 'i')
  } catch {
    return null
  }
}

export function computeWizardShotCode(sequence: string, shotName: string): string {
  const seq = sequence.trim().toUpperCase()
  const sh = shotName.trim().toUpperCase()
  if (!seq) return sh
  if (!sh) return `${seq}_`
  const tokens = sh.split(/[_\-\.\s]+/)
  if (tokens.includes(seq)) return sh
  if (/^\d+$/.test(seq)) {
    const seqNumStr = seq.replace(/^0+/, '') || '0'
    const hasMatch = tokens.some((t) => (t.replace(/^0+/, '') || '0') === seqNumStr)
    if (hasMatch) return sh
  }
  if (sh.split('_').length >= 3) return sh
  if (sh.startsWith(`${seq}_`)) return sh
  return `${seq}_${sh}`
}

/** Split pasted text into rows. Supports tab, pipe, comma, or 2+ spaces. */
export function parseLinesToRows(pastedText: string): string[][] {
  const lines = pastedText
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return []
  return lines.map((line) => {
    if (line.includes('\t')) return line.split('\t').map((c) => c.trim())
    if (line.includes('|')) return line.split('|').map((c) => c.trim())
    if (line.includes(',')) return line.split(',').map((c) => c.trim())
    return line.split(/\s{2,}/).map((c) => c.trim())
  })
}

/** Parse HTML table from clipboard (Excel copies as table). */
export function parseHtmlTableToRows(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return []
  const rows: string[][] = []
  const trs = table.querySelectorAll('tr')
  trs.forEach((tr) => {
    const cells: string[] = []
    tr.querySelectorAll('td, th').forEach((cell) => {
      cells.push(String((cell as HTMLElement).textContent ?? '').trim())
    })
    if (cells.length > 0) rows.push(cells)
  })
  return rows
}

export function parsePlainTextToRows(plain: string): string[][] {
  return parseLinesToRows(plain)
}

export function rowsToPastedString(rows: string[][]): string {
  return rows.map((r) => r.join('\t')).join('\n')
}

/** Infer column mapping from header row. */
export function inferMappingFromHeader(headerRow: string[]): ColumnMapping {
  const lower = headerRow.map((c) => String(c).trim().toLowerCase())
  const shot = lower.findIndex((c) => /^shot(\s*name)?$|^code$/.test(c) || c === 'shot name')
  const task = lower.findIndex((c) => /^task$|^department$|^step$/.test(c))
  const notes = lower.findIndex((c) =>
    /^notes?$|^work\s*description$|^description$|^notes?\s*\/\s*desc/.test(c) || c === 'work description'
  )
  const frame = lower.findIndex((c) => /^frame|^range|^frames$|^start\s*-\s*end$/.test(c) || c.includes('frame'))
  return {
    shot: shot >= 0 ? shot : COL_AUTO,
    task: task >= 0 ? task : COL_AUTO,
    notes: notes >= 0 ? notes : COL_AUTO,
    frameStart: frame >= 0 ? frame : COL_AUTO,
    frameEnd: frame >= 0 ? frame : COL_AUTO,
  }
}

/** Build ParsedShotRow[] from raw rows using column mapping. */
export function applyColumnMapping(rows: string[][], mapping: ColumnMapping): ParsedShotRow[] {
  return rows.map((row) => {
    const get = (col: number) => (col >= 0 && col < row.length ? String(row[col] ?? '').trim() : '')
    const shotName = get(mapping.shot)
    const notes = get(mapping.notes)
    const taskCode = get(mapping.task)
    let frameRange = ''
    if (mapping.frameStart >= 0 && mapping.frameEnd >= 0) {
      if (mapping.frameStart === mapping.frameEnd) {
        frameRange = get(mapping.frameStart)
      } else {
        frameRange = `${get(mapping.frameStart)}-${get(mapping.frameEnd)}`
      }
    }
    return { shotName, frameRange, notes, taskCode }
  })
}

/**
 * Detect shot patterns from an already-parsed table (e.g. Excel HTML paste).
 * Prefer this over {@link detectShotPatterns} when you have `string[][]` so cells
 * with embedded newlines are not split into extra rows (TSV round-trip bug).
 */
export function detectShotPatternsFromRows(
  allRows: string[][],
  example: string,
  firstRowIsHeader: boolean,
  overrideMapping: ColumnMapping | null
): { parsed: ParsedShotRow[]; mapping: ColumnMapping; dataRows: string[][] } {
  const emptyResult = {
    parsed: [] as ParsedShotRow[],
    mapping: {
      shot: COL_AUTO,
      task: COL_AUTO,
      notes: COL_AUTO,
      frameStart: COL_AUTO,
      frameEnd: COL_AUTO,
    } as ColumnMapping,
    dataRows: [] as string[][],
  }
  if (allRows.length === 0 || (allRows[0]?.length ?? 0) < 2) return emptyResult

  let dataRows = allRows
  let initialMapping = { ...emptyResult.mapping }
  if (firstRowIsHeader && allRows.length > 1) {
    initialMapping = inferMappingFromHeader(allRows[0])
    dataRows = allRows.slice(1)
  }
  if (overrideMapping) {
    initialMapping = { ...initialMapping, ...overrideMapping }
  }

  const rows = dataRows
  if (rows.length === 0) return { parsed: [], mapping: initialMapping, dataRows: [] }

  let shotColumnIndex = initialMapping.shot
  let frameStartIdx = initialMapping.frameStart
  let frameEndIdx = initialMapping.frameEnd
  let notesColumnIndex = initialMapping.notes
  let taskColumnIndex = initialMapping.task

  const examplePattern = example.trim().toUpperCase()
  const exampleRegex = buildLooseShotRegexFromExample(examplePattern)

  if (shotColumnIndex === COL_AUTO) {
    for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
      const hasExact = rows.some(
        (row) => String(row[colIdx] ?? '').trim().toUpperCase() === examplePattern
      )
      if (hasExact) {
        shotColumnIndex = colIdx
        break
      }
    }
    if (shotColumnIndex === COL_AUTO && exampleRegex) {
      let bestIdx = -1
      let bestScore = 0
      for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
        const score = rows.reduce((acc, row) => {
          const val = String(row[colIdx] ?? '').trim().toUpperCase()
          if (!val) return acc
          return acc + (exampleRegex.test(val) ? 1 : 0)
        }, 0)
        if (score > bestScore && score >= Math.max(1, Math.floor(rows.length / 2))) {
          bestScore = score
          bestIdx = colIdx
        }
      }
      if (bestIdx >= 0) shotColumnIndex = bestIdx
    }
    if (shotColumnIndex === COL_AUTO) {
      let bestIdx = -1
      let bestScore = -1
      for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
        const score = rows.reduce((acc, row) => {
          const val = String(row[colIdx] ?? '').trim().toUpperCase()
          if (!val) return acc
          return acc + (/\d/.test(val) ? 1 : 0) + (/_/.test(val) ? 1 : 0) + (/^[A-Z0-9_.-]+$/.test(val) ? 1 : 0)
        }, 0)
        if (score > bestScore) {
          bestScore = score
          bestIdx = colIdx
        }
      }
      shotColumnIndex = bestIdx >= 0 ? bestIdx : COL_AUTO
    }
  }

  if (frameStartIdx === COL_AUTO) {
    for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
      const val = String(rows[0]?.[colIdx] ?? '').trim()
      if (/\d+-\d+/.test(val)) {
        frameStartIdx = colIdx
        frameEndIdx = colIdx
        break
      }
    }
    if (frameStartIdx === COL_AUTO) {
      for (let colIdx = 0; colIdx < (rows[0]?.length ?? 1) - 1; colIdx++) {
        const v1 = String(rows[0]?.[colIdx] ?? '').trim()
        const v2 = String(rows[0]?.[colIdx + 1] ?? '').trim()
        if (/^\d+$/.test(v1) && /^\d+$/.test(v2)) {
          frameStartIdx = colIdx
          frameEndIdx = colIdx + 1
          break
        }
      }
    }
  }

  if (notesColumnIndex === COL_AUTO) {
    const keywords = ['shot', 'hero', 'background', 'roto', 'cleanup', 'character', 'explosion']
    let maxAvgLength = 0
    for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
      if (colIdx === shotColumnIndex || colIdx === frameStartIdx || colIdx === frameEndIdx) continue
      const avgLength =
        rows.reduce((sum, row) => sum + String(row[colIdx] ?? '').length, 0) / rows.length
      const hasKeywords = rows.some((row) =>
        keywords.some((kw) => String(row[colIdx] ?? '').toLowerCase().includes(kw))
      )
      if (avgLength > maxAvgLength || hasKeywords) {
        maxAvgLength = avgLength
        notesColumnIndex = colIdx
      }
    }
    if (notesColumnIndex === COL_AUTO) {
      for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
        if (
          colIdx === shotColumnIndex ||
          colIdx === frameStartIdx ||
          colIdx === frameEndIdx
        )
          continue
        const avgLength =
          rows.reduce((sum, row) => sum + String(row[colIdx] ?? '').length, 0) / rows.length
        if (avgLength > maxAvgLength) {
          maxAvgLength = avgLength
          notesColumnIndex = colIdx
        }
      }
    }
  }

  if (taskColumnIndex === COL_AUTO) {
    for (let colIdx = 0; colIdx < (rows[0]?.length ?? 0); colIdx++) {
      if (
        colIdx === shotColumnIndex ||
        colIdx === notesColumnIndex ||
        colIdx === frameStartIdx ||
        colIdx === frameEndIdx
      )
        continue
      const score = rows.reduce((acc, row) => {
        const val = String(row[colIdx] ?? '').trim().toLowerCase()
        if (!val || val.length > 12 || !/^[a-z0-9_-]+$/.test(val)) return acc
        return acc + 1
      }, 0)
      if (score >= Math.max(1, Math.floor(rows.length / 2))) {
        taskColumnIndex = colIdx
        break
      }
    }
  }

  const resolvedMapping: ColumnMapping = {
    shot: shotColumnIndex >= 0 ? shotColumnIndex : COL_AUTO,
    task: taskColumnIndex >= 0 ? taskColumnIndex : COL_AUTO,
    notes: notesColumnIndex >= 0 ? notesColumnIndex : COL_AUTO,
    frameStart: frameStartIdx >= 0 ? frameStartIdx : COL_AUTO,
    frameEnd: frameEndIdx >= 0 ? frameEndIdx : COL_AUTO,
  }

  const parsed = rows.map((row) => {
    const get = (col: number) => (col >= 0 && col < row.length ? String(row[col] ?? '').trim() : '')
    const shotName = get(shotColumnIndex)
    const notes = get(notesColumnIndex)
    const taskCode = get(taskColumnIndex)
    let frameRange = ''
    if (frameStartIdx >= 0 && frameEndIdx >= 0) {
      if (frameStartIdx === frameEndIdx) {
        frameRange = get(frameStartIdx)
      } else {
        frameRange = `${get(frameStartIdx)}-${get(frameEndIdx)}`
      }
    }
    return { shotName, frameRange, notes, taskCode }
  })

  return { parsed, mapping: resolvedMapping, dataRows: rows }
}

/** Detect shot patterns from plain pasted text (tab/CSV lines). */
export function detectShotPatterns(
  pastedText: string,
  example: string,
  firstRowIsHeader: boolean,
  overrideMapping: ColumnMapping | null
): { parsed: ParsedShotRow[]; mapping: ColumnMapping; dataRows: string[][] } {
  return detectShotPatternsFromRows(
    parseLinesToRows(pastedText),
    example,
    firstRowIsHeader,
    overrideMapping
  )
}

export const SHOT_HEADER_LIKE = new Set([
  'shot',
  'task',
  'work description',
  'notes',
  'scope',
  'shot description',
  'description',
  'frame',
  'frames',
  'code',
  'name',
])

export function getShotNameMatchedRows(parsed: ParsedShotRow[]): ParsedShotRow[] {
  if (!parsed.length) return []
  return parsed.filter((row) => {
    const shot = row.shotName.trim()
    if (!shot) return false
    if (SHOT_HEADER_LIKE.has(shot.toLowerCase())) return false
    return true
  })
}
