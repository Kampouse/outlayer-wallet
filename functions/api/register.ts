import type { PagesFunction } from "../pages";

// Proxies wallet registration to the coordinator, keeping the server key server-side.
export const onRequest: PagesFunction = async (context) => {
  const { SERVER_KEY, COORDINATOR_URL } = context.env as Record<string, string>;

  const coordinatorUrl = COORDINATOR_URL || "https://api.outlayer.fastnear.com";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SERVER_KEY) {
    headers["Authorization"] = `Bearer ${SERVER_KEY}`;
  }

  const resp = await fetch(`${coordinatorUrl}/register`, {
    method: "POST",
    headers,
  });

  const data = await resp.json();
  return new Response(JSON.stringify(data), {
    status: resp.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
