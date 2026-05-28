export const onRequest: PagesFunction = async (context) => {
  return new Response(JSON.stringify({ hello: "world" }), {
    headers: { "Content-Type": "application/json" },
  });
};
