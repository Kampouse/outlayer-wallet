export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API routes
    if (url.pathname === "/api/wallet_auth" && request.method === "POST") {
      try {
        const body = await request.json();
        const { google_sub } = body;

        if (!google_sub || typeof google_sub !== "string") {
          return new Response(JSON.stringify({ error: "google_sub required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const paymentKey = env.PAYMENT_KEY;
        if (!paymentKey) {
          return new Response(JSON.stringify({ error: "Server misconfigured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const resp = await fetch(
          "https://api.outlayer.fastnear.com/call/outlayer.kampouse.near/wallet-auth",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Payment-Key": paymentKey,
            },
            body: JSON.stringify({
              input: { action_num: 1, google_sub },
            }),
          }
        );

        const result = await resp.json();

        if (result.status === "failed") {
          return new Response(JSON.stringify({ error: result.error || "Execution failed" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        const output = result.output;
        if (!output) {
          return new Response(JSON.stringify({ error: "No output from execution" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (output.status === "error") {
          return new Response(JSON.stringify({ status: "error", message: output.message || "Unknown error" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          status: output.status,
          api_key: output.api_key,
          near_account_id: output.near_account_id,
          _compute_cost: result.compute_cost,
          _instructions: result.instructions,
          _call_id: result.call_id,
        }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Everything else → Pages static assets
    return env.ASSETS.fetch(request);
  },
};
