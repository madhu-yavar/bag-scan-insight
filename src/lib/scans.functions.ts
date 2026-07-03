import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGeminiChat } from "./ai-gateway.server";

const ANALYSIS_PROMPT = `You are an expert baggage inspector. You will receive up to 4 photos of a single piece of luggage from different angles (front, back, top, side).

Return a STRICT JSON object (no markdown, no prose) with this shape:

{
  "summary": "1-2 sentence overview of the bag",
  "bag_type": "carry-on|checked|duffel|backpack|garment|other",
  "size_class": "cabin|medium|large|xl|unknown",
  "dimensions_cm": { "width": number|null, "height": number|null, "depth": number|null, "confidence": "low|medium|high" },
  "colors": { "primary": "human-readable color name with hex if possible", "secondary": "..." | null },
  "material": "hard-shell|soft-shell|leather|fabric|nylon|polycarbonate|other",
  "texture": "short description",
  "wheels": { "count": 0|2|4|null, "type": "spinner|inline|none|unknown" },
  "handles": ["top", "side", "telescopic"],
  "features": ["tsa-lock","expandable","external-pockets", "..."],
  "brand_guess": "string or null",
  "damage": [ { "location": "front-lower-corner", "type": "scuff|dent|tear|stain", "severity": "minor|moderate|severe", "description": "..." } ],
  "overall_condition": "excellent|good|fair|poor",
  "notes": "anything else worth mentioning"
}

If a field cannot be determined, use null or an empty array. Do NOT wrap the JSON in code fences.`;

const AnalyzeInput = z.object({
  images: z
    .array(z.object({ view: z.enum(["front", "back", "top", "side"]), data_url: z.string().startsWith("data:image/") }))
    .min(1)
    .max(4),
  model: z.enum(["google/gemini-3-flash-preview", "google/gemini-2.5-flash", "google/gemini-2.5-pro"]).default("google/gemini-3-flash-preview"),
});

export const analyzeBaggage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }) => {
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: ANALYSIS_PROMPT },
    ];
    for (const img of data.images) {
      content.push({ type: "text", text: `View: ${img.view}` });
      content.push({ type: "image_url", image_url: { url: img.data_url } });
    }

    const res = await callGeminiChat({
      model: data.model,
      messages: [{ role: "user", content }],
    });

    if (res.status === 429) throw new Error("Rate limit exceeded. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AI Gateway error ${res.status}: ${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";
    // Strip accidental code fences
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: try to find first { ... }
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error("AI returned non-JSON output");
    }
    return { analysis: parsed, model: data.model };
  });
