/**
 * Get directory path from a full file path (cross-platform).
 * Use in renderer where Node path is not available.
 */
export function getDirectoryFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const parts = normalized.split("/")
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}
