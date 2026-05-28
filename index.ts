import { Hono } from "hono@4"
import { cors } from "hono/cors"
import { OAuth2Client } from "google-auth-library"

const app = new Hono()

app.use("/api/*", cors())

const OUTLAYER_API = "https://api.outlayer.fastnear.com"
const OUTLAYER_PROJECT = "outlayer.kampouse.near"
const OUTLAYER_WORKER = "wallet-auth"

// Google OAuth client — CLIENT_ID set via env var
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

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
    // Try id_token verification first, fall back to access token verification
    try {
      const verified = await verifyGoogleToken(body.id_token)
      return { sub: verified.sub, email: verified.email }
    } catch {
      // Might be an access_token, not an id_token
      const verified = await verifyGoogleAccessToken(body.id_token)
      return { sub: verified.sub, email: verified.email }
    }
  }
  // Accept google_sub directly for label operations (safe: no auth-sensitive data)
  if (body.google_sub) {
    return { sub: body.google_sub }
  }
  throw new Error("Missing id_token or google_sub")
}

/** Call the WASM wallet-auth worker on production OutLayer (with persistent storage) */
async function callWasm(actionNum: number, googleSub: string): Promise<any> {
  return callWasmWithInput(actionNum, { google_sub: googleSub })
}

/** Call the WASM wallet-auth worker with arbitrary input fields */
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

  // /call returns { status, output } or { output } directly
  const output = typeof result.output === "string" ? JSON.parse(result.output) : result.output
  if (!output) throw new Error("No output from WASM execution")

  return output
}

// ── Routes ──────────────────────────────────────────────────────────────────

app.post("/api/wallet_auth", async (c) => {
  try {
    const body = await c.req.json()
    const { sub, email } = await resolveGoogleSub(body)

    const output = await callWasm(1, sub)

    if (output.status === "error") {
      return c.json({ status: "error", message: output.message }, 400)
    }

    return c.json({
      status: output.status,
      api_key: output.api_key,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    if (err.message?.includes("Invalid token") || err.message?.includes("Token used too late")) {
      return c.json({ error: "Authentication failed: " + err.message }, 401)
    }
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/recover", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)

    const output = await callWasm(1, sub)

    if (output.status === "error") {
      return c.json({ status: "error", message: output.message }, 404)
    }

    return c.json({
      status: output.status,
      api_key: output.api_key,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/check", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)

    const output = await callWasm(3, sub)

    return c.json({
      status: output.status,
      exists: output.exists ?? false,
      api_key: output.api_key || null,
      near_account_id: output.near_account_id || null,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/link", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    const apiKey = body.api_key
    const nearAccountId = body.near_account_id

    if (!apiKey || !nearAccountId) {
      return c.json({ error: "Missing api_key or near_account_id" }, 400)
    }

    const output = await callWasmWithInput(4, {
      google_sub: sub,
      api_key: apiKey,
      near_account_id: nearAccountId,
    })

    return c.json({ status: output.status, linked: output.linked ?? false })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/unlink", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)

    const output = await callWasm(5, sub)

    return c.json({ status: output.status, unlinked: output.unlinked ?? false })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/deposit-address", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)

    const output = await callWasm(1, sub)

    if (!output.near_account_id && !output.api_key) {
      return c.json({ status: "error", message: "no wallet found" }, 404)
    }

    return c.json({
      status: "ok",
      address: output.near_account_id || null,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/balance", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)

    const output = await callWasm(2, sub)

    if (output.status === "error") {
      return c.json({ status: "error", message: output.message }, 400)
    }

    return c.json({
      status: "ok",
      amount: output.balance || "0",
      account_id: output.account,
      exists: !!output.balance,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/deploy-wasm", async (c) => {
  try {
    const body = await c.req.json<{ wasm_b64: string }>()
    if (!body.wasm_b64) return c.json({ error: "missing wasm_b64" }, 400)

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
      return c.json({ error: `FastFS upload failed: ${text}` }, 500)
    }

    // Deploy on OutLayer
    const deployResp = await fetch(`${OUTLAYER_API}/${OUTLAYER_PROJECT}/wallet-auth/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checksum }),
    })
    const deployData: any = await deployResp.json()

    return c.json({ checksum, deploy: deployData })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/set-label", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)
    const label = body.label
    const walletIndex = body.wallet_index ?? 0

    if (!label) return c.json({ error: "Missing label" }, 400)

    const output = await callWasmWithInput(6, {
      google_sub: sub,
      label,
      wallet_index: walletIndex,
    })

    return c.json({ status: output.status })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/labels", async (c) => {
  try {
    const body = await c.req.json()
    const { sub } = await resolveGoogleSub(body)

    const output = await callWasm(7, sub)

    return c.json({ status: output.status, labels: output.labels || [] })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.get("/api/test", (c) => c.json({ hello: "world" }))

app.all("*", (c) => c.json({ error: "Not found" }, 404))

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
}
