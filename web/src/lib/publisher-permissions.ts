/** Roles that may use Create Project in CTrack Publisher (matches intended RLS + matrix). */
export function canOpenProjectCreationWizard(role: string | undefined): boolean {
  return role === "admin" || role === "supervisor"
}
