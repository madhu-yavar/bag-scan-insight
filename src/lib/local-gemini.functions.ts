import { createServerFn } from "@tanstack/react-start";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ANALYSIS_PROMPT = `You are an expert baggage inspector. You will receive up to four submitted photo slots for one baggage item. The submitted slot labels are intended to be front, back, top, and side, but the operator may upload the wrong angle, duplicate an angle, crop the bag, stand too far away, stand too close, submit a blurry/poorly lit image, or mix photos from two different bags.

First validate the capture quality. Do not assume the submitted slot label is correct. Infer the actual view shown in each image when possible. Each submitted photo must focus on exactly one baggage item. If more than one suitcase/bag is visible in a submitted photo, require a retake for that submitted slot and do not analyze metadata from that ambiguous photo. If a submitted front image looks like the side, mark it as side. If two images show the same angle, flag a duplicate. If the bag is too small in the frame, cropped, blurred, poorly lit, or not visible, require a retake.

Second, perform a strict same-baggage identity check. All submitted slots must show the same physical bag. Compare cross-view identity signals: primary and secondary colors, material, shell type, texture/ribbing, shape/proportions, wheel count and wheel style, handle style and placement, zipper/pocket layout, straps, logos/labels, stickers/tags, dents/scuffs/stains, corners, lock position, and other distinctive marks. Opposite sides of the same bag may look different, but the core identity signals must be compatible. If one or more views appear to show a different suitcase/bag, set same_baggage to false, overall_status to "needs_retake", retake_required true for the conflicting submitted slots, and explain the visible contradiction. Do not merge metadata from different bags.

Then return the baggage metadata using only the visual evidence from views that appear to belong to the same bag. If views are swapped but still usable, use them for metadata while clearly flagging the mismatch. If required evidence is missing or mixed-bag evidence exists, use null or unknown rather than guessing.

Dimensions are critical. When the four submitted photos appear to show the same bag and the front, back, top, and side evidence is usable, estimate width, height, and depth in centimeters from the combined visual evidence. Use basis "visual-estimate" and confidence "low" or "medium" unless a real scale reference is visible. Do not set dimensions to null just because there is no measuring tape. Set dimensions to null only when the views are missing, duplicated, badly framed, too blurry, or fail the same-baggage identity check.

Return STRICT, syntactically valid JSON only with this shape. Do not return markdown, comments, explanations, code fences, trailing commas, or unescaped newline characters inside strings:

{
  "capture_validation": {
    "overall_status": "ready|needs_review|needs_retake",
    "summary": "short operator-facing status",
    "views": [
      {
        "submitted_slot": "front|back|top|side",
        "detected_view": "front|back|top|side|unknown",
        "view_match": true,
        "bag_visible": "full|partial|not_visible",
        "framing": "good|too_far|too_close|cropped|unknown",
        "lighting": "good|low_light|overexposed|unknown",
        "sharpness": "sharp|soft|blurred|unknown",
        "bag_count": number,
        "multiple_bags_visible": false,
        "retake_required": false,
        "retake_reason": null
      }
    ],
    "missing_views": ["front|back|top|side"],
    "duplicate_views": [{ "view": "front|back|top|side|unknown", "submitted_slots": ["front","side"] }],
    "identity_consistency": {
      "same_baggage": true,
      "confidence": "low|medium|high",
      "reference_slots": ["front"],
      "conflicting_slots": ["back"],
      "evidence": ["short visible identity evidence or contradiction"],
      "recommended_retake_slots": ["back"]
    },
    "recommended_action": "short next action for the operator"
  },
  "summary": "1-2 sentence overview of the bag",
  "bag_type": "carry-on|checked|duffel|backpack|garment|carton|other",
  "size_class": "cabin|medium|large|xl|unknown",
  "dimensions_cm": { "width": number|null, "height": number|null, "depth": number|null, "confidence": "low|medium|high", "basis": "visual-estimate|scale-reference|manual|unknown" },
  "colors": { "primary": "human-readable color name with hex if possible", "secondary": "string|null" },
  "material": "hard-shell|soft-shell|leather|fabric|nylon|polycarbonate|cardboard|other|unknown",
  "texture": "short description",
  "wheels": { "count": 0|2|4|null, "type": "spinner|inline|none|unknown" },
  "handles": ["top", "side", "telescopic"],
  "features": ["tsa-lock","expandable","external-pockets"],
  "brand_guess": "string|null",
  "damage": [{ "location": "string", "type": "scuff|dent|tear|stain|crack|missing-part|other", "severity": "minor|moderate|severe", "description": "string" }],
  "overall_condition": "excellent|good|fair|poor|unknown",
  "capture_quality": { "front": "good|fair|poor", "back": "good|fair|poor", "top": "good|fair|poor", "side": "good|fair|poor" },
  "notes": "anything else worth mentioning"
}

Validation rules:
- overall_status must be "ready" only when every required view is present, each submitted slot matches the detected view, and image quality is usable.
- use "needs_review" when the scan can still be analyzed but an operator should confirm, such as mild distance, soft focus, or a likely swapped angle.
- use "needs_retake" when a required view is missing, duplicated, not visible, badly cropped, too far away to inspect details, too close to understand the full bag, heavily blurred, poorly lit, more than one baggage item is visible in a submitted photo, or appears to belong to a different bag.
- retake_reason should be short and specific, for example "Bag is too far away", "Submitted front appears to be side view", "Top view is missing", or "Lower wheels are cropped".
- bag_count should be the number of visible baggage items in the submitted photo, using 0 when no bag is visible and 1 when exactly one bag is visible.
- multiple_bags_visible must be true when bag_count is greater than 1 or when there is visual ambiguity about which bag is the subject.
- missing_views must list the actual required angles that are not sufficiently represented after detected_view inference.
- duplicate_views must list repeated detected angles.
- identity_consistency.same_baggage must be false if any submitted view is visually incompatible with the others as the same physical item.
- identity_consistency.conflicting_slots must list submitted slots that appear to belong to a different bag or cannot be reconciled with the reference views.
- identity_consistency.recommended_retake_slots must list the minimum slots the operator should retake to restore one-bag consistency.
- capture_quality should summarize the submitted slots, not the inferred actual view.

If dimensions cannot be estimated because the required views are not usable or do not show the same bag, use null values and explain the limitation in dimensions_cm.basis or notes.`;

const AnalyzeInput = z.object({
  accepted_review_views: z.array(z.enum(["front", "back", "top", "side"])).default([]),
  images: z
    .array(
      z.object({
        view: z.enum(["front", "back", "top", "side"]),
        data_url: z.string().startsWith("data:image/"),
      }),
    )
    .min(1)
    .max(4),
  model: z
    .enum(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"])
    .default("gemini-3.5-flash"),
});

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export const analyzeBaggageWithGemini = createServerFn({ method: "POST" })
  .validator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }) => {
    const key = getGeminiApiKey();
    if (!key) {
      throw new Error("GEMINI_API_KEY missing. Add it to .env.local and restart npm run dev.");
    }

    const parts: Array<Record<string, unknown>> = [{ text: ANALYSIS_PROMPT }];

    if (data.accepted_review_views.length > 0) {
      parts.push({
        text: `Operator-approved review slots: ${data.accepted_review_views.join(
          ", ",
        )}. The operator accepts these submitted photos for analysis despite non-blocking review warnings. Use these approved photos for metadata unless the image is truly unusable, not visible, duplicated, or appears to belong to a different bag.`,
      });
    }

    for (const image of data.images) {
      const parsed = parseDataUrl(image.data_url);
      parts.push({ text: `Submitted slot: ${image.view}` });
      parts.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.base64,
        },
      });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      data.model,
    )}:generateContent?key=${encodeURIComponent(key)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();

    if (!raw) throw new Error("Gemini returned an empty response.");

    const analysis = parseJsonResponse(raw);
    return { analysis, model: data.model };
  });

function parseDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Image payload must be a base64 data URL.");
  return { mimeType: match[1], base64: match[2] };
}

function getGeminiApiKey() {
  // Prefer project-local env files in dev so a stale shell variable cannot
  // override the key the operator is editing in this repo.
  for (const file of [".env.local", ".env"]) {
    const value = readEnvValue(file, "GEMINI_API_KEY");
    if (value) return value;
  }

  return normalizeEnvValue(process.env.GEMINI_API_KEY);
}

function readEnvValue(file: string, name: string) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return "";

  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((item) => new RegExp(`^\\s*${name}\\s*=`).test(item));

  if (!line) return "";
  return normalizeEnvValue(line.replace(new RegExp(`^\\s*${name}\\s*=\\s*`), ""));
}

function normalizeEnvValue(value: string | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function parseJsonResponse(raw: string): Json {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as Json;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Json;
    throw new Error("Gemini returned non-JSON output.");
  }
}
