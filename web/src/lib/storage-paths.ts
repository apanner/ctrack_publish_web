/**
 * Studio-scoped S3/MinIO object key builders.
 * Layout: Studios/{studio_slug}/Projects/{project_code}/...
 */

function sanitizeSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "")
}

export function buildStudioRootPath(studioSlug: string): string {
  const slug = sanitizeSegment(studioSlug)
  if (!slug) throw new Error("studio slug is required for storage paths")
  return `Studios/${slug}`
}

export function buildProjectRootPath(studioSlug: string, projectCode: string): string {
  const code = sanitizeSegment(projectCode)
  if (!code) throw new Error("project code is required for storage paths")
  return `${buildStudioRootPath(studioSlug)}/Projects/${code}`
}

/** Matches bulk ingest / publish: no Episodes/Sequences/Shots folder segments. */
export function buildShotRootPath(
  studioSlug: string,
  projectCode: string,
  sequenceName: string,
  shotCode: string,
  episodeCode?: string | null
): string {
  const episodePart = episodeCode ? `/${sanitizeSegment(episodeCode)}` : ""
  return `${buildProjectRootPath(studioSlug, projectCode)}${episodePart}/${sanitizeSegment(sequenceName)}/${sanitizeSegment(shotCode)}`
}

/** Builds S3/MinIO object key segment (no trailing slash on file keys). */
export function joinPathSegment(basePath: string, segment: string): string {
  const normalizedBase = basePath.replace(/\/+$/, "")
  const normalizedSegment = segment.replace(/^\/+/, "").replace(/\/+$/, "")
  if (!normalizedSegment) return normalizedBase
  return `${normalizedBase}/${normalizedSegment}`
}

export function buildProjectThumbnailPath(studioSlug: string, projectCode: string, fileName = "project_thumbnail.jpg"): string {
  return joinPathSegment(buildProjectRootPath(studioSlug, projectCode), fileName)
}

export function buildVersionThumbnailPath(
  studioSlug: string,
  projectCode: string,
  sequenceName: string,
  shotCode: string,
  versionFolderName: string,
  fileName: string,
  episodeCode?: string | null
): string {
  const shotRoot = buildShotRootPath(studioSlug, projectCode, sequenceName, shotCode, episodeCode)
  return joinPathSegment(`${shotRoot}/Versions/${versionFolderName}/thumbnails`, fileName)
}
