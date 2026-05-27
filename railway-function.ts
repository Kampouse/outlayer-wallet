import { Hono } from "hono@4"
import { cors } from "hono/cors"

const app = new Hono()

app.use("/api/*", cors())

app.post("/api/wallet_auth", async (c) => {
  try {
    const body = await c.req.json()
    const googleSub = body.google_sub || body.sub

    if (!googleSub) {
      return c.json({ error: "Missing google_sub" }, 400)
    }

    const paymentKey = process.env.PAYMENT_KEY
    if (!paymentKey) {
      return c.json({ error: "Server misconfigured" }, 500)
    }

    const actionNum = body.action_num || 1

    const resp = await fetch(
      "https://api.outlayer.fastnear.com/call/outlayer.kampouse.near/wallet-auth",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Payment-Key": paymentKey,
        },
        body: JSON.stringify({
          input: { action_num: actionNum, google_sub: googleSub },
        }),
      }
    )

    const data = await resp.json()
    return c.json(data, resp.status)
  } catch (err) {
    return c.json({ error: err.message }, 500)
  }
})

app.get("/api/test", (c) => c.json({ hello: "world" }))

app.all("*", (c) => c.json({ error: "Not found" }, 404))

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
}
