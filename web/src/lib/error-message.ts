/** Human-readable message from thrown values (PostgrestError is not an Error instance). */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "object" && err !== null && "message" in err) {
    const o = err as { message?: string; details?: string; hint?: string; code?: string }
    const parts = [o.message, o.details, o.hint ? `Hint: ${o.hint}` : "", o.code ? `[${o.code}]` : ""].filter(
      Boolean
    )
    return parts.join(" — ") || "Request failed"
  }
  if (typeof err === "string") return err
  return "Something went wrong"
}
