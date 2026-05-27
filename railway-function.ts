import { Hono } from "hono@4"
import { cors } from "hono/cors"

const app = new Hono()

app.use("/api/*", cors())

const REGISTER_API = "https://api.outlayer.fastnear.com/register"
const NEAR_RPC = "https://rpc.mainnet.near.org"

// In-memory store — survives for the life of the container
// For production, swap with Redis/D1/Turso
const walletStore = new Map<string, { api_key: string; near_account_id: string }>()

app.post("/api/wallet_auth", async (c) => {
  try {
    const body = await c.req.json()
    const googleSub = body.google_sub || body.sub
    if (!googleSub) return c.json({ error: "Missing google_sub" }, 400)

    const paymentKey = process.env.PAYMENT_KEY
    if (!paymentKey) return c.json({ error: "Server misconfigured" }, 500)

    const existing = walletStore.get(googleSub)
    if (existing) {
      return c.json({ status: "ok", api_key: existing.api_key, near_account_id: existing.near_account_id, message: "existing" })
    }

    const resp = await fetch(REGISTER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Payment-Key": paymentKey },
      body: JSON.stringify({}),
    })
    const data = await resp.json()
    if (!data.api_key) return c.json({ status: "error", message: "registration failed" }, 500)

    walletStore.set(googleSub, { api_key: data.api_key, near_account_id: data.near_account_id })
    return c.json({ status: "ok", api_key: data.api_key, near_account_id: data.near_account_id })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/recover", async (c) => {
  try {
    const body = await c.req.json()
    const googleSub = body.google_sub || body.sub
    if (!googleSub) return c.json({ error: "Missing google_sub" }, 400)

    const existing = walletStore.get(googleSub)
    if (!existing) return c.json({ status: "not_found", message: "no wallet for this google account" })
    return c.json({ status: "ok", api_key: existing.api_key, near_account_id: existing.near_account_id })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/deposit-address", async (c) => {
  try {
    const body = await c.req.json()
    const googleSub = body.google_sub || body.sub
    if (!googleSub) return c.json({ error: "Missing google_sub" }, 400)

    const wallet = walletStore.get(googleSub)
    if (!wallet) return c.json({ status: "error", message: "no wallet found" }, 404)
    return c.json({ status: "ok", address: wallet.near_account_id })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.post("/api/wallet/balance", async (c) => {
  try {
    const body = await c.req.json()
    const googleSub = body.google_sub || body.sub
    if (!googleSub) return c.json({ error: "Missing google_sub" }, 400)

    const wallet = walletStore.get(googleSub)
    if (!wallet) return c.json({ status: "error", message: "no wallet found" }, 404)

    // Query NEAR RPC directly — no WASM needed for read-only
    const resp = await fetch(NEAR_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: wallet.near_account_id,
        },
      }),
    })
    const data = await resp.json()

    if (data.error) {
      // Account doesn't exist yet — needs a deposit to be created
      return c.json({ status: "ok", amount: "0", account_id: wallet.near_account_id, exists: false })
    }

    const amount = data.result?.amount || "0"
    return c.json({ status: "ok", amount, account_id: wallet.near_account_id, exists: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

app.get("/api/test", (c) => c.json({ hello: "world", wallets: walletStore.size }))

app.all("*", (c) => c.json({ error: "Not found" }, 404))

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
}
