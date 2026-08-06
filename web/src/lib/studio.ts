import { supabase } from "@/lib/supabase"

export interface ActiveStudio {
  id: string
  slug: string
  name: string
  display_name: string
  status: "active" | "suspended" | "trial"
  plan?: string | null
}

export interface StudioMembership {
  studio_id: string
  role: "studio_admin" | "member"
  studio: ActiveStudio
}

export interface ResolvedStudio {
  studioId: string
  membershipRole: "studio_admin" | "member"
  studio: ActiveStudio
}

export function resolveSingleStudioMembership(
  memberships: StudioMembership[]
): ResolvedStudio | { error: string } {
  if (memberships.length === 0) {
    return { error: "No studio membership — contact your studio admin" }
  }
  if (memberships.length > 1) {
    return { error: "Multi-studio accounts are not supported yet" }
  }
  const m = memberships[0]
  if (!m.studio) {
    return { error: "Studio membership is missing studio details" }
  }
  if (m.studio.status === "suspended") {
    return { error: "Studio is suspended" }
  }
  return {
    studioId: m.studio_id,
    membershipRole: m.role,
    studio: m.studio,
  }
}

/** Load studio memberships for the signed-in user (exactly one required in v1). */
export async function fetchStudioMemberships(userId: string): Promise<StudioMembership[]> {
  const { data, error } = await supabase
    .from("studio_members")
    .select(
      "studio_id, role, studio:studios(id, slug, name, display_name, status, plan)"
    )
    .eq("user_id", userId)

  if (error) throw error

  const memberships: StudioMembership[] = []
  for (const row of data ?? []) {
    const studioRaw = row.studio as ActiveStudio | ActiveStudio[] | null
    const studio = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw
    if (!studio?.id) continue
    memberships.push({
      studio_id: String(row.studio_id),
      role: row.role === "studio_admin" ? "studio_admin" : "member",
      studio: {
        id: String(studio.id),
        slug: String(studio.slug ?? ""),
        name: String(studio.name ?? ""),
        display_name: String(studio.display_name ?? studio.name ?? ""),
        status: (studio.status as ActiveStudio["status"]) || "active",
        plan: studio.plan ?? null,
      },
    })
  }
  return memberships
}

export async function resolveActiveStudio(userId: string): Promise<ResolvedStudio> {
  const memberships = await fetchStudioMemberships(userId)
  const resolved = resolveSingleStudioMembership(memberships)
  if ("error" in resolved) {
    throw new Error(resolved.error)
  }
  return resolved
}
