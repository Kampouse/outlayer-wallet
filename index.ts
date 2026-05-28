import { Hono } from "hono"
import { cors } from "hono/cors"

type Bindings = {
  GOOGLE_CLIENT_ID: string
  PAYMENT_KEY: string
  ENCRYPTION_KEY: string
  DEPLOY_SECRET: string
  WALLET_DOMAIN?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ── Constants ──────────────────────────────────────────────────────────────

const OUTLAYER_API = "https://api.outlayer.fastnear.com"
const OUTLAYER_PROJECT = "outlayer.kampouse.near"
const OUTLAYER_WORKER = "wallet-auth"

// ── 1. Restricted CORS ────────────────────────────────────────────────────

app.use("/api/*", async (c, next) => {
  const allowedOrigins = [
    "https://outlayer-wallet.pages.dev",
    c.env.WALLET_DOMAIN ? `https://${c.env.WALLET_DOMAIN}` : "https://wallet.outlayer.xyz",
    "http://localhost:5173",
  ].filter(Boolean)

  return cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
    credentials: true,
  })(c, next)
})

// ── 2. Rate Limiting (in-memory, per-isolate) ─────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX = 30

app.use("/api/*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown"
  const now = Date.now()

  let entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW }
    rateLimitMap.set(ip, entry)
  }
  entry.count++

  // Lazy cleanup: evict expired entries when map grows
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k)
    }
  }

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
      if (typeof sanitized === "string" && key in STRING_LIMITS) {
        sanitized = (sanitized as string).slice(0, STRING_LIMITS[key])
      }
      result[key] = sanitized
    }
    if (result.api_key && typeof result.api_key === "string" && result.api_key.startsWith("wk_") && !API_KEY_RE.test(result.api_key)) {
      throw new Error("Invalid api_key format")
    }
    if (result.near_account_id && typeof result.near_account_id === "string" && !NEAR_ACCOUNT_RE.test(result.near_account_id)) {
      throw new Error("Invalid near_account_id format")
    }
    return result as T
  }
  return obj
}

app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    try {
      const raw = await c.req.json()
      const cleaned = sanitize(raw)
      c.set("sanitizedBody" as any, cleaned)
    } catch {
      // let route handler deal with it
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
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
})

// ── 5. Audit Logging ──────────────────────────────────────────────────────

function auditLog(c: any, googleSub: string | undefined, status: number, durationMs: number) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    google_sub: googleSub ? googleSub.slice(0, 8) + "…" : undefined,
    status,
    duration_ms: Math.round(durationMs),
  }))
}

// ── 6. API Key Encryption ─────────────────────────────────────────────────

let _encryptionKey: CryptoKey | null = null

async function getEncryptionKey(env: Bindings): Promise<CryptoKey> {
  if (_encryptionKey) return _encryptionKey
  const hexKey = env.ENCRYPTION_KEY
  if (!hexKey || hexKey.length !== 64) {
    throw new Error("Server misconfigured: ENCRYPTION_KEY must be 32-byte hex string (64 chars)")
  }
  const keyBytes = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const baseKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HKDF" }, false, ["deriveKey"])
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

async function encryptApiKey(plaintext: string, env: Bindings): Promise<string> {
  const key = await getEncryptionKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return btoa(String.fromCharCode(...combined))
}

async function decryptApiKey(encrypted: string, env: Bindings): Promise<string> {
  const key = await getEncryptionKey(env)
  const combined = Uint8Array.from(atob(encrypted), (ch) => ch.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return new TextDecoder().decode(decrypted)
}

// ── Google Auth (manual JWT verification — no google-auth-library) ─────────

/** Fetch Google's public JWK set (cached for 1 hour) */
let _googleCerts: { keys: JsonWebKey[]; fetchedAt: number } | null = null

async function getGoogleCerts(): Promise<{ keys: JsonWebKey[] }> {
  if (_googleCerts && Date.now() - _googleCerts.fetchedAt < 3600_000) {
    return { keys: _googleCerts.keys }
  }
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/certs")
  if (!resp.ok) throw new Error("Failed to fetch Google certs")
  const data = await resp.json() as any
  _googleCerts = { keys: data.keys, fetchedAt: Date.now() }
  return { keys: data.keys }
}

/** Decode JWT without verification (for header + payload) */
function decodeJwtPart(str: string): any {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded)
  return JSON.parse(binary)
}

/** Verify a Google ID token manually using crypto.subtle */
async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<{ sub: string; email?: string }> {
  const parts = idToken.split(".")
  if (parts.length !== 3) throw new Error("Invalid token format")

  const header = decodeJwtPart(parts[0])
  const payload = decodeJwtPart(parts[1])

  // Verify audience
  if (payload.aud !== clientId) throw new Error("Token audience mismatch")
  // Verify expiry
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error("Token expired")
  // Verify issuer
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Invalid token issuer")
  }
  if (!payload.sub) throw new Error("Invalid token: no sub claim")

  // Verify signature
  const certs = await getGoogleCerts()
  const cert = certs.keys.find((k: any) => k.kid === header.kid)
  if (!cert) throw new Error("No matching Google cert found")

  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
  const publicKey = await crypto.subtle.importKey("jwk", cert, algorithm, false, ["verify"])

  const signatureInput = new TextEncoder().encode(parts[0] + "." + parts[1])
  const signatureBytes = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0))

  const valid = await crypto.subtle.verify(algorithm, publicKey, signatureBytes, signatureInput)
  if (!valid) throw new Error("Invalid token signature")

  return { sub: payload.sub, email: payload.email }
}

/** Verify a Google access token via tokeninfo endpoint */
async function verifyGoogleAccessToken(accessToken: string, clientId: string): Promise<{ sub: string; email?: string }> {
  const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`)
  if (!resp.ok) throw new Error("Invalid access token")
  const data = await resp.json() as any
  if (data.aud !== clientId) throw new Error("Token audience mismatch")
  if (!data.sub) throw new Error("Invalid token: no sub claim")
  return { sub: data.sub, email: data.email }
}

/** Verify id_token/access_token */
async function resolveGoogleSub(body: any, env: Bindings): Promise<{ sub: string; email?: string }> {
  if (body.id_token) {
    if (!env.GOOGLE_CLIENT_ID) throw new Error("Server misconfigured: missing GOOGLE_CLIENT_ID")
    try {
      return await verifyGoogleIdToken(body.id_token, env.GOOGLE_CLIENT_ID)
    } catch {
      return await verifyGoogleAccessToken(body.id_token, env.GOOGLE_CLIENT_ID)
    }
  }
  throw new Error("Missing id_token")
}

// ── WASM Helpers ──────────────────────────────────────────────────────────

async function callWasm(actionNum: number, googleSub: string, env: Bindings): Promise<any> {
  return callWasmWithInput(actionNum, { google_sub: googleSub }, env)
}

async function callWasmWithInput(actionNum: number, input: Record<string, any>, env: Bindings): Promise<any> {
  if (!env.PAYMENT_KEY) throw new Error("Server misconfigured: missing PAYMENT_KEY")

  const resp = await fetch(`${OUTLAYER_API}/call/${OUTLAYER_PROJECT}/${OUTLAYER_WORKER}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Key": env.PAYMENT_KEY,
    },
    body: JSON.stringify({ input: { action_num: actionNum, ...input } }),
  })

  const result: any = await resp.json()
  if (result.status === "failed") throw new Error(result.error || "WASM execution failed")

  const output = typeof result.output === "string" ? JSON.parse(result.output) : result.output
  if (!output) throw new Error("No output from WASM execution")
  return output
}

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
    const { sub } = await resolveGoogleSub(body, c.env)
    googleSub = sub

    const output = await callWasm(1, sub, c.env)

    if (output.status === "error") {
      status = 400
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: output.message }, 400)
    }

    const encryptedApiKey = output.api_key ? await encryptApiKey(output.api_key, c.env) : null

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({
      status: output.status,
      api_key: encryptedApiKey,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    if (err.message?.includes("Invalid token") || err.message?.includes("Token used too late") || err.message?.includes("Token expired")) {
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
    const { sub } = await resolveGoogleSub(body, c.env)
    googleSub = sub

    const output = await callWasm(1, sub, c.env)

    if (output.status === "error") {
      status = 404
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: output.message }, 404)
    }

    const encryptedApiKey = output.api_key ? await encryptApiKey(output.api_key, c.env) : null

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
    const { sub } = await resolveGoogleSub(body, c.env)
    googleSub = sub

    const output = await callWasm(3, sub, c.env)
    const encryptedApiKey = output.api_key ? await encryptApiKey(output.api_key, c.env) : null

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
    const { sub } = await resolveGoogleSub(body, c.env)
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
      plaintextApiKey = await decryptApiKey(apiKey, c.env)
    } catch {
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
    }, c.env)

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
    const { sub } = await resolveGoogleSub(body, c.env)
    googleSub = sub

    const output = await callWasm(5, sub, c.env)

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
    const { sub } = await resolveGoogleSub(body, c.env)
    googleSub = sub

    const output = await callWasm(1, sub, c.env)

    if (!output.near_account_id && !output.api_key) {
      status = 404
      auditLog(c, googleSub, status, Date.now() - start)
      return c.json({ status: "error", message: "no wallet found" }, 404)
    }

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ status: "ok", address: output.near_account_id || null })
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
    const { sub } = await resolveGoogleSub(body, c.env)
    googleSub = sub

    const output = await callWasm(2, sub, c.env)

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

  if (!c.env.DEPLOY_SECRET) {
    status = 503
    auditLog(c, undefined, status, Date.now() - start)
    return c.json({ error: "Deploy endpoint not configured" }, 503)
  }

  const authHeader = c.req.header("Authorization")
  if (!authHeader || authHeader !== `Bearer ${c.env.DEPLOY_SECRET}`) {
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
      const resolved = await resolveGoogleSub(body, c.env)
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

    const output = await callWasmWithInput(6, { google_sub: sub, label, wallet_index: walletIndex }, c.env)

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
      const resolved = await resolveGoogleSub(body, c.env)
      sub = resolved.sub
    }
    googleSub = sub

    const output = await callWasm(7, sub, c.env)

    status = 200
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ status: output.status, labels: output.labels || [] })
  } catch (err: any) {
    auditLog(c, googleSub, status, Date.now() - start)
    return c.json({ error: err.message }, 500)
  }
})

app.get("/api/test", (c) => c.json({ hello: "world" }))

app.all("*", (c) => c.json({ error: "Not found" }, 404))

export default app
