import { createServerFn } from "@tanstack/react-start";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

const SINGLE_VIEW_PROMPT = `You are validating exactly one baggage photo before the operator can continue to the next required view.

The operator will provide the expected submitted slot: front, back, top, or side.
Inspect the image and decide whether it is acceptable for that exact slot.

Rules:
- Accept only when exactly one baggage item is visible, the expected angle is clearly shown, and the bag is usable for inspection.
- Reject when the submitted photo shows a different angle than expected. For example, reject a side view submitted as front, a front/back view submitted as side, or any non-top view submitted as top.
- Reject when the bag is missing, heavily cropped, too far away, too close, heavily blurred, poorly lit, overexposed, or when multiple bags are visible.
- For front and back, use visible face details and handle/pocket/wheel layout to distinguish them when possible. If uncertain between front/back, reject and ask for a clearer view.
- For top, the photo must be looking down enough to inspect top handles/zippers and depth. A normal front/back/side standing view is not top.
- For side, the photo must show the bag profile/depth. A normal front/back face is not side.

Return STRICT JSON only:
{
  "submitted_slot": "front|back|top|side",
  "detected_view": "front|back|top|side|unknown",
  "status": "accepted|rejected",
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

Use status "accepted" only when retake_required is false and view_match is true. Make retake_reason short and operator-facing.`;

const SINGLE_VIEW_RETRY_PROMPT = `Validate this single baggage photo for the expected submitted slot.

Return only one valid JSON object. No markdown. No prose.

JSON shape:
{
  "submitted_slot": "front|back|top|side",
  "detected_view": "front|back|top|side|unknown",
  "status": "accepted|rejected",
  "view_match": true,
  "bag_visible": "full|partial|not_visible",
  "framing": "good|too_far|too_close|cropped|unknown",
  "lighting": "good|low_light|overexposed|unknown",
  "sharpness": "sharp|soft|blurred|unknown",
  "bag_count": 1,
  "multiple_bags_visible": false,
  "retake_required": false,
  "retake_reason": null
}

Reject if the angle does not match the expected slot, the full bag is not visible, more than one bag is visible, or the photo is unusable.`;

const IDENTITY_PROMPT = `You are validating whether multiple baggage photos show the same physical suitcase.

You will receive 2 to 4 submitted slots. One slot is the newly uploaded photo. Compare all photos as identity evidence only. Do not extract baggage dimensions or general metadata.

This is an adversarial validation task. Operators may accidentally or deliberately mix photos from two similar suitcases. Do not assume matching slot labels mean the same suitcase.

Compare durable identity signals across photos and score each signal independently. Use these exact feature names and weights:
- unique_marks, weight 30: logos, tags, stickers, labels, tape, dents, scuffs, stains, cracks, or other distinctive marks
- color, weight 20: primary and secondary color family
- material, weight 15: hard-shell, fabric, leather, nylon, cardboard, etc.
- texture_pattern, weight 15: ribbing, grooves, shell panels, weave, seams, surface pattern
- wheels, weight 15: wheel count, wheel style, wheel placement
- handles, weight 15: telescopic, top, side handles, straps, handle shape and placement
- zipper_pockets_locks, weight 15: zipper tracks, external pockets, locks, expansion seams
- shape_proportion, weight 10: overall proportions, edge/corner design, thickness/depth compatibility

Rules:
- Set same_baggage false when any submitted slot is visually incompatible with the reference suitcase.
- Set same_baggage false when the newly uploaded photo conflicts with previously accepted photos.
- Set confidence low when overlap is too weak to verify identity, even if no direct contradiction is visible.
- Opposite sides may have different pockets or labels, but core construction, material, color family, wheel/handle style, and distinctive marks must be compatible.
- When in doubt, prefer needs-retake over accepting a mixed-bag set.
- recommended_retake_slots should include the minimum slots the operator should retake. Prefer the newly uploaded slot when it conflicts with already accepted slots.
- For each feature score, set observable false when the feature is not clearly visible in enough views to compare.
- For observable features, use match "match", "mismatch", or "unknown". Use "mismatch" only when there is concrete visual contradiction.
- Hard mismatches must include color/material/texture/wheel/handle/unique mark contradictions that should block capture immediately.
- confidence_score must be a number from 0 to 1 based on the visible weighted evidence, not a guess. Penalize unknowns and weak overlap.

Return STRICT JSON only:
{
  "same_baggage": true,
  "confidence": "high|medium|low",
  "confidence_score": 0.92,
  "new_view": "front|back|top|side",
  "reference_slots": ["front"],
  "conflicting_slots": [],
  "recommended_retake_slots": [],
  "hard_mismatches": [
    { "feature": "color", "slots": ["front","side"], "reason": "front is black, side is blue" }
  ],
  "feature_scores": [
    { "feature": "unique_marks", "weight": 30, "observable": false, "match": "unknown", "evidence": "no shared unique mark visible" },
    { "feature": "color", "weight": 20, "observable": true, "match": "match", "evidence": "all visible panels are black" },
    { "feature": "material", "weight": 15, "observable": true, "match": "match", "evidence": "all views show hard shell material" },
    { "feature": "texture_pattern", "weight": 15, "observable": true, "match": "mismatch", "evidence": "front has vertical ribbing, side is smooth fabric" },
    { "feature": "wheels", "weight": 15, "observable": true, "match": "unknown", "evidence": "wheels not visible clearly in side view" },
    { "feature": "handles", "weight": 15, "observable": true, "match": "match", "evidence": "same telescopic handle style" },
    { "feature": "zipper_pockets_locks", "weight": 15, "observable": true, "match": "unknown", "evidence": "zipper path partly occluded" },
    { "feature": "shape_proportion", "weight": 10, "observable": true, "match": "match", "evidence": "similar rectangular hard-shell proportions" }
  ],
  "evidence": ["short concrete visual evidence"],
  "operator_message": "short operator-facing result"
}`;

const IDENTITY_RETRY_PROMPT = `Compare these baggage photos and decide if they show the same physical suitcase.

Return only valid JSON. No markdown. No prose.

JSON:
{
  "same_baggage": true,
  "confidence": "high|medium|low",
  "confidence_score": 0.92,
  "new_view": "front|back|top|side",
  "reference_slots": ["front"],
  "conflicting_slots": [],
  "recommended_retake_slots": [],
  "hard_mismatches": [],
  "feature_scores": [
    { "feature": "color", "weight": 20, "observable": true, "match": "match|mismatch|unknown", "evidence": "short evidence" }
  ],
  "evidence": ["visible matching or conflicting identity signals"],
  "operator_message": "short result"
}

Use same_baggage false if any photo appears to be a different suitcase. Use confidence low when identity cannot be verified. Include hard_mismatches for blocking contradictions.`;

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

const ValidateViewInput = z.object({
  view: z.enum(["front", "back", "top", "side"]),
  data_url: z.string().startsWith("data:image/"),
  model: z
    .enum(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"])
    .default("gemini-3.5-flash"),
});

const ValidateIdentityInput = z.object({
  new_view: z.enum(["front", "back", "top", "side"]),
  images: z
    .array(
      z.object({
        view: z.enum(["front", "back", "top", "side"]),
        data_url: z.string().startsWith("data:image/"),
      }),
    )
    .min(2)
    .max(4),
  model: z
    .enum(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"])
    .default("gemini-3.5-flash"),
});

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
type ViewSlot = z.infer<typeof ValidateViewInput>["view"];

export const analyzeBaggageWithGemini = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

export const validateBaggageViewWithGemini = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ValidateViewInput.parse(input))
  .handler(async ({ data }) => {
    const key = getGeminiApiKey();
    if (!key) {
      throw new Error("GEMINI_API_KEY missing. Add it to .env.local and restart npm run dev.");
    }

    const parsed = parseDataUrl(data.data_url);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      data.model,
    )}:generateContent?key=${encodeURIComponent(key)}`;

    const imagePart = {
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.base64,
      },
    };
    const raw = await requestGeminiText(endpoint, [
      { text: SINGLE_VIEW_PROMPT },
      { text: `Expected submitted slot: ${data.view}` },
      imagePart,
    ]);
    const validation = tryParseJsonResponse(raw);
    if (validation) return { validation, model: data.model };

    console.warn("Gemini returned non-JSON output during single-view validation.", {
      view: data.view,
      rawPreview: raw.slice(0, 500),
    });

    const retryRaw = await requestGeminiText(endpoint, [
      { text: SINGLE_VIEW_RETRY_PROMPT },
      { text: `Expected submitted slot: ${data.view}` },
      imagePart,
    ]);
    const retryValidation = tryParseJsonResponse(retryRaw);
    if (retryValidation) return { validation: retryValidation, model: data.model };

    console.warn("Gemini returned non-JSON output during single-view validation retry.", {
      view: data.view,
      rawPreview: retryRaw.slice(0, 500),
    });

    return {
      validation: acceptedReviewViewValidation(
        data.view,
        "AI view validation was inconclusive. Continue, but the final scan will re-check this photo.",
      ),
      model: data.model,
    };
  });

export const validateBaggageIdentityWithGemini = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ValidateIdentityInput.parse(input))
  .handler(async ({ data }) => {
    const key = getGeminiApiKey();
    if (!key) {
      throw new Error("GEMINI_API_KEY missing. Add it to .env.local and restart npm run dev.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      data.model,
    )}:generateContent?key=${encodeURIComponent(key)}`;
    const imageParts = identityImageParts(data.images);

    const raw = await requestGeminiText(endpoint, [
      { text: IDENTITY_PROMPT },
      { text: `Newly uploaded slot: ${data.new_view}` },
      ...imageParts,
    ]);
    const identity = tryParseJsonResponse(raw);
    if (identity) return { identity, model: data.model };

    console.warn("Gemini returned non-JSON output during baggage identity validation.", {
      newView: data.new_view,
      rawPreview: raw.slice(0, 500),
    });

    const retryRaw = await requestGeminiText(endpoint, [
      { text: IDENTITY_RETRY_PROMPT },
      { text: `Newly uploaded slot: ${data.new_view}` },
      ...imageParts,
    ]);
    const retryIdentity = tryParseJsonResponse(retryRaw);
    if (retryIdentity) return { identity: retryIdentity, model: data.model };

    console.warn("Gemini returned non-JSON output during baggage identity validation retry.", {
      newView: data.new_view,
      rawPreview: retryRaw.slice(0, 500),
    });

    return {
      identity: rejectedIdentityValidation(
        data.new_view,
        "AI could not verify that this photo belongs to the same suitcase. Retake the newly uploaded photo.",
      ),
      model: data.model,
    };
  });

function parseDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Image payload must be a base64 data URL.");
  return { mimeType: match[1], base64: match[2] };
}

function getGeminiApiKey() {
  // Prefer project-local env files in dev so a stale shell variable cannot
  // override the key the operator is editing in this repo.
  const keyNames = ["GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GEMINI_API_KEY"];
  for (const file of [".env.local", ".env"]) {
    for (const keyName of keyNames) {
      const value = readEnvValue(file, keyName);
      if (value) return value;
    }
  }

  for (const keyName of keyNames) {
    const value = normalizeEnvValue(process.env[keyName]);
    if (value) return value;
  }

  return "";
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

async function requestGeminiText(endpoint: string, parts: Array<Record<string, unknown>>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.05,
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

  return (
    payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function acceptedReviewViewValidation(view: ViewSlot, reason: string) {
  return {
    submitted_slot: view,
    detected_view: view,
    status: "accepted",
    view_match: true,
    bag_visible: "full",
    framing: "good",
    lighting: "good",
    sharpness: "sharp",
    bag_count: 1,
    multiple_bags_visible: false,
    retake_required: false,
    retake_reason: null,
    validation_warning: reason,
  };
}

function rejectedIdentityValidation(view: ViewSlot, reason: string) {
  return {
    same_baggage: false,
    confidence: "low",
    new_view: view,
    reference_slots: [],
    conflicting_slots: [view],
    recommended_retake_slots: [view],
    evidence: [reason],
    operator_message: reason,
  };
}

function identityImageParts(images: Array<{ view: ViewSlot; data_url: string }>) {
  const parts: Array<Record<string, unknown>> = [];
  for (const image of images) {
    const parsed = parseDataUrl(image.data_url);
    parts.push({ text: `Submitted slot: ${image.view}` });
    parts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.base64,
      },
    });
  }
  return parts;
}

function tryParseJsonResponse(raw: string) {
  if (!raw) return null;
  try {
    return parseJsonResponse(raw);
  } catch {
    return null;
  }
}

function parseJsonResponse(raw: string): Json {
  const cleaned = stripCodeFence(raw);
  const jsonStart = extractJsonStart(cleaned);
  const candidates = [cleaned, extractJsonBlock(cleaned), closeOpenJsonContainers(jsonStart)]
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    for (const value of [candidate, removeTrailingJsonCommas(candidate)]) {
      try {
        return parseJsonValue(value);
      } catch {
        // Try the next recoverable shape before surfacing a model-format error.
      }
    }
  }

  throw new Error("Gemini returned non-JSON output.");
}

function parseJsonValue(value: string): Json {
  const parsed = JSON.parse(value) as Json;
  if (typeof parsed === "string") {
    const nested = parsed.trim();
    if (nested.startsWith("{") || nested.startsWith("[")) return JSON.parse(nested) as Json;
  }
  return parsed;
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function removeTrailingJsonCommas(value: string) {
  return value.replace(/,\s*([}\]])/g, "$1");
}

function extractJsonStart(value: string) {
  const objectIndex = value.indexOf("{");
  const arrayIndex = value.indexOf("[");
  const starts = [objectIndex, arrayIndex].filter((index) => index >= 0);
  if (starts.length === 0) return "";
  return value.slice(Math.min(...starts));
}

function closeOpenJsonContainers(value: string) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.at(-1) === char) stack.pop();
      else return value;
    }
  }

  if (inString || stack.length === 0) return value;
  return `${value}${stack.reverse().join("")}`;
}

function extractJsonBlock(value: string) {
  const objectIndex = value.indexOf("{");
  const arrayIndex = value.indexOf("[");
  const starts = [objectIndex, arrayIndex].filter((index) => index >= 0);
  if (starts.length === 0) return "";

  const start = Math.min(...starts);
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }

  return "";
}
