/**
 * Walk a directory chosen via File System Access API and build File[] with stable multipart names
 * (path segments joined with "__") for engine temp staging.
 */
export async function collectFilesFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
  out: File[]
): Promise<void> {
  for await (const [name, handle] of dirHandle.entries()) {
    const rel: string = basePath ? `${basePath}/${name}` : name
    if (handle.kind === "directory") {
      await collectFilesFromDirectoryHandle(handle as FileSystemDirectoryHandle, rel, out)
    } else if (handle.kind === "file") {
      const fh = handle as FileSystemFileHandle
      const blob: File = await fh.getFile()
      const multipartName: string = rel.replace(/\\/g, "/").split("/").join("__")
      out.push(new File([blob], multipartName, { type: blob.type, lastModified: blob.lastModified }))
    }
  }
}
