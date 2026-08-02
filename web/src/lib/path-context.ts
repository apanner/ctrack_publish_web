/**
 * Parses a file or folder path for VFX-style tokens (shot code, sequence code)
 * to support Smart-Fill of the context bar when user drops files.
 */

/** Matches shot codes like SH010, sh010, SH001 (case-insensitive) */
const SHOT_CODE_REGEX = /(?:^|[\/\\])(SH\d+)(?:[\/\\]|$)/i

/** Matches extended shot codes like STU101_006_0050 (folder or filename prefix) */
const EXTENDED_SHOT_REGEX = /(?:^|[\/\\])([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)(?=[\/\\]|$)/i

/** Matches sequence codes like SEQ01, seq_01 (optional) */
const SEQ_CODE_REGEX = /(?:^|[\/\\])(SEQ[\d_]*\d)(?:[\/\\]|$)/i

export interface ParsedPathContext {
  shotCode: string | null
  sequenceCode: string | null
}

/**
 * Extracts suggested shot code (and optionally sequence code) from a path.
 * Normalizes path separators and returns the first match for each pattern.
 * Supports SH001-style and STU101_006_0050-style codes.
 */
export function parsePathContext(fileOrFolderPath: string): ParsedPathContext {
  const normalized = fileOrFolderPath.replace(/\\/g, "/")
  const shotMatch = normalized.match(SHOT_CODE_REGEX) ?? normalized.match(EXTENDED_SHOT_REGEX)
  const seqMatch = normalized.match(SEQ_CODE_REGEX)
  return {
    shotCode: shotMatch ? shotMatch[1].toUpperCase() : null,
    sequenceCode: seqMatch ? seqMatch[1].toUpperCase().replace(/_/g, "") : null,
  }
}
