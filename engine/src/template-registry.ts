import fs from "node:fs"
import path from "node:path"
import { getEngineRoot, getUserDataDir } from "./paths.js"

const REGISTRY_VERSION = 1

export interface TemplateRecord {
  id: string
  name: string
  category: string
  relativePath: string
  description: string | null
  createdAt: string
  updatedAt: string
}

interface TemplateRegistryFile {
  version: number
  templates: TemplateRecord[]
}

export interface TemplateUpsertInput {
  name?: string
  category?: string
  relativePath?: string
  description?: string | null
}

export interface TemplateImportInput {
  sourcePath?: string
  fileName?: string
  fileContentBase64?: string
  id?: string
  name?: string
  category?: string
  description?: string | null
}

export interface TemplateSyncResult {
  sourceDir: string
  targetDir: string
  copiedNkFiles: number
  mergedTemplates: number
}

function getTemplatesRoot(): string {
  const root = path.join(getUserDataDir(), "templates")
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function getUserTemplatesRoot(): string {
  return getTemplatesRoot()
}

function getRegistryPath(): string {
  return path.join(getTemplatesRoot(), "registry.json")
}

function sanitizeCategory(category: string | undefined): string {
  const raw = String(category ?? "review").trim().toLowerCase()
  const normalized = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-")
  return normalized.length > 0 ? normalized : "review"
}

function sanitizeTemplateId(value: string): string {
  const lowered = value.trim().toLowerCase()
  const normalized = lowered.replace(/[^a-z0-9_-]+/g, "_").replace(/_+/g, "_")
  return normalized.replace(/^_+|_+$/g, "")
}

function createTemplateIdFromName(fileName: string): string {
  const stem = path.parse(fileName).name
  const id = sanitizeTemplateId(stem)
  return id.length > 0 ? id : "template"
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "")
  if (normalized.includes("..")) {
    throw new Error("relativePath cannot include '..'")
  }
  return normalized
}

function readRegistryFile(): TemplateRegistryFile {
  const target = getRegistryPath()
  if (!fs.existsSync(target)) {
    return { version: REGISTRY_VERSION, templates: [] }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(target, "utf-8")) as Partial<TemplateRegistryFile>
    const templates = Array.isArray(raw.templates) ? raw.templates.filter((tpl) => !!tpl?.id && !!tpl?.relativePath) : []
    return {
      version: typeof raw.version === "number" ? raw.version : REGISTRY_VERSION,
      templates,
    }
  } catch {
    return { version: REGISTRY_VERSION, templates: [] }
  }
}

function writeRegistryFile(next: TemplateRegistryFile): void {
  const target = getRegistryPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ version: REGISTRY_VERSION, templates: next.templates }, null, 2) + "\n", "utf-8")
}

function readRegistryFileAt(templatesRoot: string): TemplateRegistryFile {
  const target = path.join(templatesRoot, "registry.json")
  if (!fs.existsSync(target)) {
    return { version: REGISTRY_VERSION, templates: [] }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(target, "utf-8")) as Partial<TemplateRegistryFile>
    const templates = Array.isArray(raw.templates) ? raw.templates.filter((tpl) => !!tpl?.id && !!tpl?.relativePath) : []
    return {
      version: typeof raw.version === "number" ? raw.version : REGISTRY_VERSION,
      templates,
    }
  } catch {
    return { version: REGISTRY_VERSION, templates: [] }
  }
}

function writeRegistryFileAt(templatesRoot: string, next: TemplateRegistryFile): void {
  const target = path.join(templatesRoot, "registry.json")
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ version: REGISTRY_VERSION, templates: next.templates }, null, 2) + "\n", "utf-8")
}

function absolutePathFromRelative(relativePath: string): string {
  return path.join(getTemplatesRoot(), normalizeRelativePath(relativePath))
}

function ensureTemplateFileInCategory(
  sourcePath: string,
  category: string,
  fileName: string
): { absolutePath: string; relativePath: string } {
  const ext = path.extname(fileName).toLowerCase()
  if (ext !== ".nk") {
    throw new Error("Only .nk templates are supported")
  }
  const safeName = path.basename(fileName)
  const targetDir = path.join(getTemplatesRoot(), category)
  fs.mkdirSync(targetDir, { recursive: true })
  const absolutePath = path.join(targetDir, safeName)
  fs.copyFileSync(sourcePath, absolutePath)
  return {
    absolutePath,
    relativePath: normalizeRelativePath(path.relative(getTemplatesRoot(), absolutePath)),
  }
}

export function seedDefaultReviewTemplateIfEmpty(): void {
  const registry = readRegistryFile()
  if (registry.templates.length > 0) return
  const source = path.join(getEngineRoot(), "python", "templates", "review_mp4.nk")
  if (!fs.existsSync(source)) return
  const category = "review"
  const seeded = ensureTemplateFileInCategory(source, category, "review_mp4.nk")
  const now = new Date().toISOString()
  registry.templates.push({
    id: "review_mp4",
    name: "Review MP4",
    category,
    relativePath: seeded.relativePath,
    description: "Default review template",
    createdAt: now,
    updatedAt: now,
  })
  writeRegistryFile(registry)
}

export function listTemplates(): TemplateRecord[] {
  seedDefaultReviewTemplateIfEmpty()
  const registry = readRegistryFile()
  return [...registry.templates].sort((a, b) => a.name.localeCompare(b.name))
}

export function getTemplateById(id: string): TemplateRecord | null {
  const key = sanitizeTemplateId(id)
  if (!key) return null
  const template = listTemplates().find((item) => item.id === key)
  return template ?? null
}

export function getTemplateAbsolutePathById(id: string): string | null {
  const template = getTemplateById(id)
  if (!template) return null
  const absolutePath = absolutePathFromRelative(template.relativePath)
  return fs.existsSync(absolutePath) ? absolutePath : null
}

export function upsertTemplateMetadata(id: string, patch: TemplateUpsertInput): TemplateRecord {
  const key = sanitizeTemplateId(id)
  if (!key) throw new Error("Template id is required")
  const registry = readRegistryFile()
  const now = new Date().toISOString()
  const existing = registry.templates.find((item) => item.id === key) ?? null
  const next: TemplateRecord = {
    id: key,
    name: (patch.name ?? existing?.name ?? key).trim() || key,
    category: sanitizeCategory(patch.category ?? existing?.category),
    relativePath: normalizeRelativePath(patch.relativePath ?? existing?.relativePath ?? ""),
    description: patch.description === undefined ? (existing?.description ?? null) : (patch.description ?? null),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (!next.relativePath) {
    throw new Error("Template relativePath is required")
  }
  if (existing) {
    const index = registry.templates.findIndex((item) => item.id === key)
    registry.templates[index] = next
  } else {
    registry.templates.push(next)
  }
  writeRegistryFile(registry)
  return next
}

export function importTemplate(input: TemplateImportInput): TemplateRecord {
  const category = sanitizeCategory(input.category)
  const incomingName = input.fileName ?? (input.sourcePath ? path.basename(input.sourcePath) : "template.nk")
  const fileName = path.basename(incomingName)
  if (path.extname(fileName).toLowerCase() !== ".nk") {
    throw new Error("Imported file must have .nk extension")
  }
  const templateId = sanitizeTemplateId(input.id ?? createTemplateIdFromName(fileName))
  if (!templateId) throw new Error("Could not derive template id")
  const templateName = (input.name ?? path.parse(fileName).name).trim() || templateId

  const templatesRoot = getTemplatesRoot()
  const targetDir = path.join(templatesRoot, category)
  fs.mkdirSync(targetDir, { recursive: true })
  const targetFileName = `${templateId}.nk`
  const targetPath = path.join(targetDir, targetFileName)
  if (input.sourcePath) {
    if (!fs.existsSync(input.sourcePath)) {
      throw new Error(`Source template not found: ${input.sourcePath}`)
    }
    fs.copyFileSync(input.sourcePath, targetPath)
  } else if (input.fileContentBase64) {
    const content = Buffer.from(input.fileContentBase64, "base64")
    fs.writeFileSync(targetPath, content)
  } else {
    throw new Error("Import requires sourcePath or fileContentBase64")
  }

  const relativePath = normalizeRelativePath(path.relative(templatesRoot, targetPath))
  return upsertTemplateMetadata(templateId, {
    name: templateName,
    category,
    relativePath,
    description: input.description ?? null,
  })
}

function parseIsoDate(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sanitizeIncomingTemplate(record: TemplateRecord): TemplateRecord | null {
  const id = sanitizeTemplateId(String(record.id ?? ""))
  let relativePath = ""
  try {
    relativePath = normalizeRelativePath(String(record.relativePath ?? ""))
  } catch {
    return null
  }
  if (!id || !relativePath || path.extname(relativePath).toLowerCase() !== ".nk") {
    return null
  }
  const now = new Date().toISOString()
  return {
    id,
    name: String(record.name ?? id).trim() || id,
    category: sanitizeCategory(record.category),
    relativePath,
    description: record.description ?? null,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  }
}

function mergeRegistryTemplates(source: TemplateRecord[], target: TemplateRecord[]): TemplateRecord[] {
  const mergedById = new Map<string, TemplateRecord>()
  for (const record of target) {
    const sanitized = sanitizeIncomingTemplate(record)
    if (!sanitized) continue
    mergedById.set(sanitized.id, sanitized)
  }
  for (const record of source) {
    const incoming = sanitizeIncomingTemplate(record)
    if (!incoming) continue
    const existing = mergedById.get(incoming.id)
    if (!existing) {
      mergedById.set(incoming.id, incoming)
      continue
    }
    const existingUpdated = parseIsoDate(existing.updatedAt)
    const incomingUpdated = parseIsoDate(incoming.updatedAt)
    if (incomingUpdated < existingUpdated) {
      continue
    }
    const existingCreated = parseIsoDate(existing.createdAt)
    const incomingCreated = parseIsoDate(incoming.createdAt)
    let mergedCreatedAt = existing.createdAt || incoming.createdAt
    if (existingCreated > 0 && incomingCreated > 0) {
      mergedCreatedAt = new Date(Math.min(existingCreated, incomingCreated)).toISOString()
    }
    mergedById.set(incoming.id, {
      ...incoming,
      createdAt: mergedCreatedAt,
    })
  }
  return Array.from(mergedById.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function copyNkTree(sourceDir: string, targetDir: string): number {
  fs.mkdirSync(targetDir, { recursive: true })
  let copiedFiles = 0
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourceEntryPath = path.join(sourceDir, entry.name)
    const targetEntryPath = path.join(targetDir, entry.name)
    fs.cpSync(sourceEntryPath, targetEntryPath, {
      recursive: true,
      force: true,
      filter: (candidatePath: string) => {
        const stat = fs.statSync(candidatePath)
        if (stat.isDirectory()) return true
        if (path.extname(candidatePath).toLowerCase() !== ".nk") return false
        copiedFiles += 1
        return true
      },
    })
  }
  return copiedFiles
}

export function syncTemplatesDirectories(sourceDir: string, targetDir: string): TemplateSyncResult {
  const sourceRoot = path.resolve(sourceDir)
  const targetRoot = path.resolve(targetDir)
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`Source templates directory not found: ${sourceRoot}`)
  }
  const copiedNkFiles = copyNkTree(sourceRoot, targetRoot)
  const sourceRegistry = readRegistryFileAt(sourceRoot)
  const targetRegistry = readRegistryFileAt(targetRoot)
  const mergedTemplates = mergeRegistryTemplates(sourceRegistry.templates, targetRegistry.templates)
  writeRegistryFileAt(targetRoot, { version: REGISTRY_VERSION, templates: mergedTemplates })
  return {
    sourceDir: sourceRoot,
    targetDir: targetRoot,
    copiedNkFiles,
    mergedTemplates: mergedTemplates.length,
  }
}
