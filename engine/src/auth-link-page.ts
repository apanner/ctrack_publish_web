import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pairDevice, readEmailFromAccessToken, syncAccountEmail } from "./auth-store.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function readEnv(key: string, fallback = ""): string {
  return String(process.env[key] ?? fallback).trim()
}

function enginePort(): number {
  const raw = Number(process.env.CTRACK_ENGINE_PORT ?? 7777)
  return Number.isFinite(raw) ? raw : 7777
}

function engineBaseUrl(): string {
  const override = readEnv("CTRACK_ENGINE_PUBLIC_URL")
  if (override) {
    return override.replace(/\/+$/, "")
  }
  return `http://127.0.0.1:${enginePort()}`
}

function authLinkUrl(): string {
  return `${engineBaseUrl()}/auth/link`
}

function supabaseUrl(): string {
  return readEnv("SUPABASE_URL") || readEnv("VITE_SUPABASE_URL")
}

function supabaseAnonKey(): string {
  return readEnv("SUPABASE_ANON_KEY") || readEnv("VITE_SUPABASE_ANON_KEY")
}

function missingSupabaseConfigMessage(): string {
  const userEnv = path.join(os.homedir(), ".ctrack-engine", ".env")
  const engineEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env")
  return (
    `<h1 class="err">Configuration error</h1>` +
    `<p>Supabase is not configured on the engine.</p>` +
    `<p class="muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> ` +
    `(same project as ctrack_v0) to <code>${escapeHtml(userEnv)}</code> ` +
    `or <code>${escapeHtml(path.resolve(engineEnv))}</code>, then restart CTrack Engine Tray.</p>`
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function jsonForScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

function pageShell(title: string, body: string, script = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0B1118; color: #E8EEF5; font-family: "Segoe UI", system-ui, sans-serif; }
    .card { width: min(420px, 92vw); padding: 32px; text-align: center; }
    h1 { color: #24E1B1; font-size: 1.4rem; margin: 0 0 12px; }
    p { color: #8FA0B3; line-height: 1.5; margin: 0 0 20px; }
    button, a.btn { display: block; width: 100%; box-sizing: border-box; border: 0; border-radius: 8px;
      padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; background: #24E1B1;
      color: #041812; text-decoration: none; text-align: center; }
    button:hover, a.btn:hover { background: #1FC99E; }
    button:disabled { opacity: 0.6; cursor: wait; }
    .err { color: #E85D5D; }
    .muted { color: #8FA0B3; font-size: 0.95rem; }
  </style>
</head>
<body><div class="card" id="card">${body}</div>${script}</body></html>`
}

export function resolveSupabaseJsPath(): string {
  const candidates = [
    path.resolve(moduleDir, "../../node_modules/@supabase/supabase-js/dist/umd/supabase.js"),
    path.resolve(moduleDir, "../../../node_modules/@supabase/supabase-js/dist/umd/supabase.js"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error("Supabase browser bundle not found")
}

export function renderAuthLinkPage(): string {
  const url = supabaseUrl()
  const key = supabaseAnonKey()
  const linkUrl = authLinkUrl()
  if (!url || !key) {
    return pageShell("CTrack Engine — Sign in", missingSupabaseConfigMessage())
  }
  return pageShell(
    "CTrack Engine — Sign in",
    `<h1 id="title">Link CTrack Engine</h1>
<p id="message">Sign in with Google to connect this workstation. Keep the engine tray running.</p>
<button id="sign-in" type="button">Sign in with Google</button>
<p class="muted">Stay in this browser tab until linking finishes.</p>`,
    `<script src="/auth/supabase.js"></script>
<script>
(function () {
  var card = document.getElementById("card");
  var title = document.getElementById("title");
  var message = document.getElementById("message");
  var button = document.getElementById("sign-in");
  var supabaseUrl = ${jsonForScript(url)};
  var supabaseKey = ${jsonForScript(key)};
  var redirectTo = ${jsonForScript(linkUrl)};
  var client = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: false },
  });

  function showError(text) {
    title.textContent = "Sign in failed";
    title.className = "err";
    message.textContent = text;
    message.className = "";
    button.style.display = "none";
    var retry = document.createElement("a");
    retry.href = redirectTo;
    retry.className = "btn";
    retry.textContent = "Try again";
    card.appendChild(retry);
  }

  function showSuccess(email) {
    title.textContent = "Engine linked";
    title.className = "";
    message.textContent = email
      ? "Signed in as " + email + ". Close this tab — the sign-in window will finish automatically."
      : "This workstation is connected. Close this tab — the sign-in window will finish automatically.";
    message.className = "muted";
    button.style.display = "none";
  }

  async function completePairing(accessToken, email) {
    title.textContent = "Linking engine…";
    message.textContent = "Completing sign-in…";
    button.disabled = true;
    button.style.display = "none";
    var pairResponse = await fetch("/api/auth/pair-from-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: accessToken, email: email || "" }),
    });
    var payload = {};
    try { payload = await pairResponse.json(); } catch (e) {}
    if (!pairResponse.ok || !payload.ok) {
      showError(payload.error || "Engine pairing failed");
      return;
    }
    var provision = payload.provision || null;
    if (provision && provision.noStudio) {
      title.textContent = "Signed in — studio needed";
      title.className = "err";
      message.textContent = provision.error || "Ask your TD to add you to a CTrack studio, then sign in again.";
      message.className = "";
      button.style.display = "none";
      return;
    }
    if (provision && !provision.ok && !payload.setupComplete) {
      title.textContent = "Signed in — config pending";
      title.className = "err";
      message.textContent = (provision.error || "Studio storage is not configured yet.") +
        " Ask your TD to set studio engine config, then open CTrack again.";
      message.className = "";
      button.style.display = "none";
      return;
    }
    var studioBit = provision && provision.studioName ? (" · " + provision.studioName) : "";
    showSuccess((payload.email || "") + studioBit);
  }

  async function finishOAuthReturn() {
    var params = new URLSearchParams(window.location.search);
    var oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      showError(oauthError);
      return;
    }
    var code = params.get("code");
    if (!code) {
      return;
    }
    title.textContent = "Linking engine…";
    message.textContent = "Completing sign-in…";
    button.style.display = "none";
    var result = await client.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.session || !result.data.session.access_token) {
      showError(
        (result.error && result.error.message) ||
        "Sign-in session expired. Close this tab, then click Sign in on the engine card again."
      );
      return;
    }
    history.replaceState({}, document.title, redirectTo);
    var user = result.data.session.user || {};
    var email = user.email || user.user_metadata?.full_name || user.user_metadata?.name || "";
    await completePairing(result.data.session.access_token, email);
  }

  button.addEventListener("click", async function () {
    button.disabled = true;
    button.textContent = "Opening Google…";
    var result = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo },
    });
    if (result.error || !result.data.url) {
      button.disabled = false;
      button.textContent = "Sign in with Google";
      showError(result.error ? result.error.message : "Could not start Google sign-in");
      return;
    }
    window.location.assign(result.data.url);
  });

  finishOAuthReturn();
})();
</script>`
  )
}

export function renderAuthCallbackPage(): string {
  return renderAuthLinkPage()
}

export async function initializePairing(accessToken: string): Promise<string> {
  const url = supabaseUrl()
  const response = await fetch(`${url}/functions/v1/engine-pair-init`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Pair init failed (${response.status})`)
  }
  const payload = (await response.json()) as { pairToken?: string; pair_token?: string }
  const pairToken = payload.pairToken ?? payload.pair_token
  if (!pairToken) {
    throw new Error("Pair init did not return a token")
  }
  return pairToken
}

export async function pairFromAccessToken(accessToken: string, emailHint?: string | null): Promise<{ email: string | null }> {
  const trimmed = accessToken.trim()
  if (!trimmed) {
    throw new Error("accessToken is required")
  }
  const pairToken = await initializePairing(trimmed)
  const resolvedEmail = toStringOrNull(emailHint) ?? readEmailFromAccessToken(trimmed)
  const status = await pairDevice(pairToken, resolvedEmail)
  if (!status.email && status.userId) {
    const synced = await syncAccountEmail()
    return { email: synced.email }
  }
  return { email: status.email }
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getLocalAuthLinkUrl(): string {
  return authLinkUrl()
}
