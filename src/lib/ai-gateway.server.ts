// Server-only helper for calling the Lovable AI Gateway.
const BASE_URL = "https://ai.gateway.lovable.dev/v1";

export async function callGeminiChat(body: unknown): Promise<Response> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  return fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify(body),
  });
}
