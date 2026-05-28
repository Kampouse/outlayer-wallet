import { Hono } from "hono@4"
import { cors } from "hono/cors"
import { OAuth2Client } from "google-auth-library"

const app = new Hono()

// ── Constants ──────────────────────────────────────────────────────────────

const OUTLAYER_API = "https://api.outlayer.fastnear.com"
const OUTLAYER_PROJECT = "outlayer.kampouse.near"
const OUTLAYER_WORKER = "wallet-auth"

// Google OAuth client — CLIENT_ID set via env var
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

// ── 1. Restricted CORS ────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://outlayer-wallet.pages.dev",
  process.env.WALLET_DOMAIN ? `https://${process.env.WALLET_DOMAIN}` : "https://wallet.outlayer.xyz",
  "http://localhost:5173",
].filter(Boolean)

app.use("/api/*", cors({
  origin: ALLOWED_ORIGINS,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
  credentials: true,
}))

// ── 2. Rate Limiting ──────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
const RATE_LIMIT_MAX = 30

// Cleanup expired entries every 2 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key)
  }
}, 120_000)

app.use("/api/*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("cf-connecting-ip")
    || "unknown"
  const now = Date.now()

  let entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW }
    rateLimitMap.set(ip, entry)
  }
  entry.count++

  if (entry.count > RATE_LIMIT_MAX) {
    return c.json({ error: "Rate limit exceeded" }, 429)
  }

  await next()
})

// ── 3. Input Sanitization ─────────────────────────────────────────────────

const API_KEY_RE = /^wk_[0-9a-f]{64}$/
const NEAR_ACCOUNT_RE = /^[a-zA-Z0-9._-]+$/
const HTML_TAG_RE = /<[^>]*>/g

const STRING_LIMITS: Record<string, number> = {
  label: 256,
  google_sub: 128,
  api_key: 200,
  near_account_id: 64,
}

function sanitize<T = any>(obj: any): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    return obj.replace(HTML_TAG_RE, "") as unknown as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item)) as unknown as T
  }
  if (typeof obj === "object") {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      let sanitized = sanitize(value)
      // Enforce string length limits
      if (typeof sanitized === "string" && key in STRING_LIMITS) {
        sanitized = (sanitized as string).slice(0, STRING_LIMITS[key])
      }
      result[key] = sanitized
    }
    // Validate api_key format when present (skip if encrypted — base64 blob)
    if (result.api_key && typeof result.api_key === "string" && result.api_key.startsWith("wk_") && !API_KEY_RE.test(result.api_key)) {
      throw new Error("Invalid api_key format")
    }
    // Validate near_account_id format when present
    if (result.near_account_id && typeof result.near_account_id === "string" && !NEAR_ACCOUNT_RE.test(result.near_account_id)) {
      throw new Error("Invalid near_account_id format")
    }
    return result as T
  }
  return obj
}

app.use("/api/*", async (c, next) => {
  // Only sanitize for methods that typically have bodies
  const method = c.req.method.toUpperCase()
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    try {
      const raw = await c.req.json()
      const cleaned = sanitize(raw)
      // Store sanitized body for route handlers
      c.set("sanitizedBody" as any, cleaned)
    } catch {
      // If body parsing fails, let the route handler deal with it
    }
  }
  await next()
})

// ── 4. Security Headers ───────────────────────────────────────────────────

app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("X-Frame-Options", "DENY")
  c.header("X-XSS-Protection", "1; mode=block")
  c.header("Referrer-Policy", "strict-origin-when-cross-origin")
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  )
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
})

// ── 5. Audit Logging ──────────────────────────────────────────────────────

// We'll wrap each route to capture timing + status. Use a helper.
function auditLog(c: any, googleSub: string | undefined, status: number, durationMs: number) {
  const entry = {
    timestamp: new Date().toISOString(),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      || c.req.header("cf-connecting-ip")
      || "unknown",
    google_sub: googleSub ? googleSub.slice(0, 8) + "…" : undefined,
    status,
    duration_ms: Math.round(durationMs),
  }
  console.log(JSON.stringify(entry))
}

// ── 6. API Key Encryption at Rest ─────────────────────────────────────────
// Encrypt at the API boundary:
//   - When WASM returns an api_key → encrypt before sending to client
//   - When client sends an api_key → decrypt before passing to WASM
// WASM always sees plaintext. Browser only sees encrypted blobs.

let _encryptionKey: CryptoKey | null = null

async function getEncryptionKey(): Promise<CryptoKey> {
  if (_encryptionKey) return _encryptionKey
  const hexKey = process.env.ENCRYPTION_KEY
  if (!hexKey || hexKey.length !== 64) {
    throw new Error("Server misconfigured: ENCRYPTION_KEY must be 32-byte hex string (64 chars)")
  }
  // Convert hex to raw bytes for HKDF salt material
  const keyBytes = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  // Import as raw key material for HKDF
  const baseKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HKDF" }, false, [
    "deriveKey",
  ])
  // Derive AES-256-GCM key via HKDF
  _encryptionKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("outlayer-wallet-api-key-encryption-v1"),
      info: new TextEncoder().encode("aes-256-gcm"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
  return _encryptionKey
}

async function encryptApiKey(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV for AES-GCM
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
  // Concatenate iv + ciphertext and base64-encode
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decryptApiKey(encrypted: string): Promise<string> {
  const key = await getEncryptionKey()
  const combined = Uint8Array.from(atob(encrypted), (ch) => ch.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
}

// ── Google Auth Helpers ───────────────────────────────────────────────────

/** Verify a Google ID token, return the verified payload. */
async function verifyGoogleToken(idToken: string): Promise<{ sub: string; email?: string; name?: string }> {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const payload = ticket.getPayload()
  if (!payload?.sub) throw new Error("Invalid token: no sub claim")
  return { sub: payload.sub, email: payload.email, name: payload.name }
}

/** Verify a Google access token via tokeninfo endpoint */
async function verifyGoogleAccessToken(accessToken: string): Promise<{ sub: string; email?: string; name?: string }> {
  const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`)
  if (!resp.ok) throw new Error("Invalid access token")
  const data = await resp.json()
  if (data.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("Token audience mismatch")
  if (!data.sub) throw new Error("Invalid token: no sub claim")
  return { sub: data.sub, email: data.email, name: data.name }
}

/** Verify id_token/access_token or dev fallback */
async function resolveGoogleSub(body: any): Promise<{ sub: string; email?: string }> {
  if (body.id_token) {
    if (!process.env.GOOGLE_CLIENT_ID) throw new Error("Server misconfigured: missing GOOGLE_CLIENT_ID")
    try {
      const verified = await verifyGoogleToken(body.id_token)
      return { sub: verified.sub, email: verified.email }
    } catch {
      const verified = await verifyGoogleAccessToken(body.id_token)
      return { sub: verified.sub, email: verified.email }
    }
  }
  throw new Error("Missing id_token")
}

// ── WASM Helpers ──────────────────────────────────────────────────────────

async function callWasm(actionNum: number, googleSub: string): Promise<any> {
  return callWasmWithInput(actionNum, { google_sub: googleSub })
}

async function callWasmWithInput(actionNum: number, input: Record<string, any>): Promise<any> {
  const paymentKey = process.env.PAYMENT_KEY
  if (!paymentKey) throw new Error("Server misconfigured: missing PAYMENT_KEY")

  const resp = await fetch(`${OUTLAYER_API}/call/${OUTLAYER_PROJECT}/${OUTLAYER_WORKER}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Key": paymentKey,
    },
    body: JSON.stringify({
      input: { action_num: actionNum, ...input },
    }),
  })

  const result: any = await resp.json()

  if (result.status === "failed") {
    throw new Error(result.error || "WASM execution failed")
  }

  const output = typeof result.output === "string" ? JSON.parse(result.output) : result.output
  if (!output) throw new Error("No output from WASM execution")

  return output
}

// Helper to get sanitized body from middleware
function getBody<T = any>(c: any): T {
  return c.get("sanitizedBody") as T
}

// ── Routes ────────────────────────────────────────────────────────────────

app.post("/api/wallet_auth", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub, email } = await resolveGoogleSub(body)
    googleSub = sub

    const output = await callWasm(1, sub)

    if (output.status === "error") {
      status = 400
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: output.message }, 400)
    }

    // Encrypt api_key before returning to client
    let encryptedApiKey: string | null = null
    if (output.api_key) {
      encryptedApiKey = await encryptApiKey(output.api_key)
    }

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({
      status: output.status,
      api_key: encryptedApiKey,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    if (err.message?.includes("Invalid token") || err.message?.includes("Token used too late")) {
      status = 401
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ error: "Authentication failed: " + err.message }, 401)
    }
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/recover", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    googleSub = sub

    const output = await callWasm(1, sub)

    if (output.status === "error") {
      status = 404
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: output.message }, 404)
    }

    // Encrypt api_key before returning to client
    let encryptedApiKey: string | null = null
    if (output.api_key) {
      encryptedApiKey = await encryptApiKey(output.api_key)
    }

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({
      status: output.status,
      api_key: encryptedApiKey,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/check", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    googleSub = sub

    const output = await callWasm(3, sub)

    // Encrypt api_key before returning to client
    let encryptedApiKey: string | null = null
    if (output.api_key) {
      encryptedApiKey = await encryptApiKey(output.api_key)
    }

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({
      status: output.status,
      exists: output.exists ?? false,
      api_key: encryptedApiKey,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/link", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    googleSub = sub
    let apiKey = body.api_key
    const nearAccountId = body.near_account_id

    if (!apiKey || !nearAccountId) {
      status = 400
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ error: "Missing api_key or near_account_id" }, 400)
    }

    // Client sends encrypted api_key → decrypt before passing to WASM
    let plaintextApiKey: string
    try {
      plaintextApiKey = await decryptApiKey(apiKey)
    } catch {
      // If decryption fails, it might be a raw key (legacy). Validate format.
      if (!API_KEY_RE.test(apiKey)) {
        status = 400
        auditLog(c, googleSub, status, Date.now() - start)
        return c.json({ error: "Invalid api_key" }, 400)
      }
      plaintextApiKey = apiKey
    }

    const output = await callWasmWithInput(4, {
      google_sub: sub,
      api_key: plaintextApiKey,
      near_account_id: nearAccountId,
    })

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ status: output.status, linked: output.linked ?? false })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/unlink", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    googleSub = sub

    const output = await callWasm(5, sub)

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ status: output.status, unlinked: output.unlinked ?? false })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/deposit-address", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    googleSub = sub

    const output = await callWasm(1, sub)

    if (!output.near_account_id && !output.api_key) {
      status = 404
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: "no wallet found" }, 404)
    }

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({
      status: "ok",
      address: output.near_account_id || null,
    })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/balance", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    googleSub = sub

    const output = await callWasm(2, sub)

    if (output.status === "error") {
      status = 400
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: output.message }, 400)
    }

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({
      status: "ok",
      amount: output.balance || "0",
      account_id: output.account,
      exists: !!output.balance,
    })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

// ── Deploy WASM (protected) ───────────────────────────────────────────────

app.post("/api/deploy-wasm", async (c) => {
  const start = Date.now()
  let status = 500

  // Require DEPLOY_SECRET via Authorization header
  const deploySecret = process.env.DEPLOY_SECRET
  if (!deploySecret) {
    status = 503
    auditLog(c, undefined, status, Date.now() - start)
    return c.json({ error: "Deploy endpoint not configured" }, 503)
  }

  const authHeader = c.req.header("Authorization")
  if (!authHeader || authHeader !== `Bearer ${deploySecret}`) {
    status = 401
    auditLog(c, undefined, status, Date.now() - start)
    return c.json({ error: "Unauthorized" }, 401)
  }

  try {
    const body = await c.req.json<{ wasm_b64: string }>()
    if (!body.wasm_b64) {
      status = 400
      auditLog(c, undefined, status, Date.now() - start)
      return c.json({ error: "missing wasm_b64" }, 400)
    }

    const wasmBytes = Uint8Array.from(atob(body.wasm_b64), (ch) => ch.charCodeAt(0))
    const hashBuffer = await crypto.subtle.digest("SHA-256", wasmBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const checksum = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")

    // Upload to FastFS
    const uploadResp = await fetch(`https://fs.fastnear.com/upload/wallet_cex.wasm?checksum=${checksum}`, {
      method: "PUT",
      body: wasmBytes,
    })
    if (!uploadResp.ok) {
      const text = await uploadResp.text()
      status = 502
      auditLog(c, undefined, status, Date.now() - start)
      return c.json({ error: `FastFS upload failed: ${text}` }, 502)
    }

    // Deploy on OutLayer
    const deployResp = await fetch(`${OUTLAYER_API}/${OUTLAYER_PROJECT}/wallet-auth/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksum }),
    })
    const deployData: any = await deployResp.json()

    status = 200
    auditLog(c, undefined, status, Date.now() - start)
    return c.json({ checksum, deploy: deployData })
  } catch (err: any) {
    auditLog(c, undefined, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/set-label", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    let sub = body.google_sub
    if (!sub) {
      const resolved = await resolveGoogleSub(body)
      sub = resolved.sub
    }
    googleSub = sub

    const label = body.label
    const walletIndex = body.wallet_index ?? 0

    if (!label) {
      status = 400
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ error: "Missing label" }, 400)
    }

    const output = await callWasmWithInput(6, {
      google_sub: sub,
      label,
      wallet_index: walletIndex,
    })

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ status: output.status })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/labels", async (c) => {
  const start = Date.now()
  let googleSub: string | undefined
  let status = 500
  try {
    const body = getBody(c) || await c.req.json()
    let sub = body.google_sub
    if (!sub) {
      const resolved = await resolveGoogleSub(body)
      sub = resolved.sub
    }
    googleSub = sub

    const output = await callWasm(7, sub)

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ status: output.status, labels: output.labels || [] })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.get("/api/test", async (c) => {
  auditLog(c, undefined, 200, 0)
  return c.json({ hello: "world" })
})

app.all("*", (c) => c.json({ error: "Not found" }, 404))

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
}
