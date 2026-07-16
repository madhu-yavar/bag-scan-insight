import type { BaggageView } from "@/lib/baggage-views";
import { VIEWS } from "@/lib/baggage-views";

export type JsonObject = Record<string, unknown>;

export type NormalizedDamageFinding = {
  location: string | null;
  damageType: string | null;
  severity: string | null;
  description: string | null;
  confidence: string | null;
};

export type NormalizedImageMetrics = {
  viewValidationStatus: string | null;
  viewConfidence: number | null;
  qualityScore: number | null;
  identityScore: number | null;
};

export type NormalizedValidationEvent = {
  view: BaggageView | null;
  eventType: "view_validation" | "identity_validation" | "final_analysis";
  accepted: boolean | null;
  score: number | null;
  confidence: string | null;
  reason: string | null;
  rawResponse: unknown;
};

export type NormalizedScanAnalysis = {
  summary: string | null;
  bagType: string | null;
  sizeClass: string | null;
  brandGuess: string | null;
  brandConfidence: string | null;
  visibleLogoText: string | null;
  modelGuess: string | null;
  modelConfidence: string | null;
  shellType: string | null;
  luggageFormFactor: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  dimensionConfidence: string | null;
  dimensionBasis: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  material: string | null;
  texture: string | null;
  wheelCount: number | null;
  wheelType: string | null;
  handleCount: number | null;
  overallCondition: string | null;
  captureValidationStatus: string | null;
  identityScore: number | null;
  qualityScore: number | null;
  damageFindings: NormalizedDamageFinding[];
  imageMetrics: Record<BaggageView, NormalizedImageMetrics>;
  validationEvents: NormalizedValidationEvent[];
};

export function normalizeScanAnalysis(analysis: unknown): NormalizedScanAnalysis {
  const root = toObject(analysis) ?? {};
  const dimensions = toObject(root.dimensions_cm);
  const colors = toObject(root.colors);
  const wheels = toObject(root.wheels);
  const validation = toObject(root.capture_validation);
  const identity = toObject(validation?.identity_consistency);
  const captureQuality = toObject(root.capture_quality);
  const viewRows = Array.isArray(validation?.views)
    ? validation.views.map(toObject).filter((item): item is JsonObject => Boolean(item))
    : [];

  const imageMetrics = buildImageMetrics(viewRows, captureQuality, identity);
  const qualityScores = VIEWS.map((view) => imageMetrics[view.key].qualityScore).filter(
    (value): value is number => value != null,
  );
  const identityScore = identityScoreFrom(identity);

  return {
    summary: stringOrNull(root.summary),
    bagType: normalizedText(root.bag_type),
    sizeClass: normalizedText(root.size_class),
    brandGuess: stringOrNull(root.brand_guess ?? toObject(root.brand)?.name),
    brandConfidence: normalizedText(root.brand_confidence ?? toObject(root.brand)?.confidence),
    visibleLogoText: stringOrNull(
      root.visible_logo_text ?? toObject(root.brand)?.visible_logo_text,
    ),
    modelGuess: stringOrNull(root.model_guess ?? toObject(root.brand)?.model_guess),
    modelConfidence: normalizedText(
      root.model_confidence ?? toObject(root.brand)?.model_confidence,
    ),
    shellType: normalizedText(root.shell_type),
    luggageFormFactor: normalizedText(root.luggage_form_factor),
    widthCm: numberOrNull(dimensions?.width),
    heightCm: numberOrNull(dimensions?.height),
    depthCm: numberOrNull(dimensions?.depth),
    dimensionConfidence: normalizedText(dimensions?.confidence),
    dimensionBasis: normalizedText(dimensions?.basis),
    primaryColor: stringOrNull(colors?.primary),
    secondaryColor: stringOrNull(colors?.secondary),
    material: normalizedText(root.material),
    texture: stringOrNull(root.texture),
    wheelCount: integerOrNull(wheels?.count),
    wheelType: normalizedText(wheels?.type),
    handleCount: Array.isArray(root.handles) ? root.handles.length : null,
    overallCondition: normalizedText(root.overall_condition),
    captureValidationStatus: normalizedText(validation?.overall_status) ?? "ready",
    identityScore,
    qualityScore: average(qualityScores),
    damageFindings: normalizeDamage(root.damage),
    imageMetrics,
    validationEvents: buildValidationEvents(validation, viewRows, identity, imageMetrics),
  };
}

function buildImageMetrics(
  viewRows: JsonObject[],
  captureQuality: JsonObject | null,
  identity: JsonObject | null,
): Record<BaggageView, NormalizedImageMetrics> {
  const identityScore = identityScoreFrom(identity);
  const metrics = Object.fromEntries(
    VIEWS.map((view) => [
      view.key,
      {
        viewValidationStatus: null,
        viewConfidence: null,
        qualityScore: qualityScoreFrom(captureQuality?.[view.key]),
        identityScore,
      },
    ]),
  ) as Record<BaggageView, NormalizedImageMetrics>;

  for (const row of viewRows) {
    const view = normalizeView(row.submitted_slot);
    if (!view) continue;
    const accepted =
      row.retake_required !== true &&
      row.view_match !== false &&
      row.multiple_bags_visible !== true &&
      normalizedText(row.bag_visible) !== "not_visible";
    const qualityScore = scoreViewQuality(row, captureQuality?.[view]);
    metrics[view] = {
      viewValidationStatus: accepted ? "accepted" : "rejected",
      viewConfidence: qualityScore,
      qualityScore,
      identityScore,
    };
  }

  return metrics;
}

function buildValidationEvents(
  validation: JsonObject | null,
  viewRows: JsonObject[],
  identity: JsonObject | null,
  imageMetrics: Record<BaggageView, NormalizedImageMetrics>,
): NormalizedValidationEvent[] {
  const events: NormalizedValidationEvent[] = [];
  const status = normalizedText(validation?.overall_status);

  if (validation) {
    events.push({
      view: null,
      eventType: "final_analysis",
      accepted: status !== "needs_retake",
      score: average(
        VIEWS.map((view) => imageMetrics[view.key].qualityScore).filter(
          (value): value is number => value != null,
        ),
      ),
      confidence: null,
      reason: stringOrNull(validation.summary) ?? stringOrNull(validation.recommended_action),
      rawResponse: validation,
    });
  }

  for (const row of viewRows) {
    const view = normalizeView(row.submitted_slot);
    if (!view) continue;
    const metric = imageMetrics[view];
    events.push({
      view,
      eventType: "view_validation",
      accepted: metric.viewValidationStatus === "accepted",
      score: metric.qualityScore,
      confidence: null,
      reason: stringOrNull(row.retake_reason) ?? viewReason(row),
      rawResponse: row,
    });
  }

  if (identity) {
    events.push({
      view: null,
      eventType: "identity_validation",
      accepted: identity.same_baggage === true,
      score: identityScoreFrom(identity),
      confidence: normalizedText(identity.confidence),
      reason: identityReason(identity),
      rawResponse: identity,
    });
  }

  return events;
}

function normalizeDamage(value: unknown): NormalizedDamageFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toObject)
    .filter((item): item is JsonObject => Boolean(item))
    .map((item) => ({
      location: stringOrNull(item.location),
      damageType: normalizedText(item.type ?? item.damage_type),
      severity: normalizedText(item.severity),
      description: stringOrNull(item.description),
      confidence: normalizedText(item.confidence),
    }));
}

function scoreViewQuality(row: JsonObject, fallbackQuality: unknown) {
  if (
    row.retake_required === true ||
    row.view_match === false ||
    row.multiple_bags_visible === true ||
    normalizedText(row.bag_visible) === "not_visible"
  ) {
    return 0.2;
  }

  const scores = [
    qualityScoreFrom(fallbackQuality),
    categoricalScore(row.bag_visible, { full: 1, partial: 0.55, not_visible: 0 }),
    categoricalScore(row.framing, {
      good: 1,
      too_far: 0.55,
      too_close: 0.55,
      cropped: 0.45,
      unknown: 0.6,
    }),
    categoricalScore(row.lighting, {
      good: 1,
      low_light: 0.55,
      overexposed: 0.45,
      unknown: 0.6,
    }),
    categoricalScore(row.sharpness, {
      sharp: 1,
      soft: 0.65,
      blurred: 0.25,
      unknown: 0.6,
    }),
  ].filter((value): value is number => value != null);

  return average(scores);
}

function qualityScoreFrom(value: unknown) {
  return categoricalScore(value, { good: 1, fair: 0.65, poor: 0.25 });
}

function identityScoreFrom(identity: JsonObject | null) {
  if (!identity) return null;
  const explicit = finiteNumber(identity.confidence_score);
  if (explicit != null) return clamp(explicit, 0, 1);
  if (identity.same_baggage === false) return 0.2;
  const confidence = normalizedText(identity.confidence);
  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.7;
  if (confidence === "low") return 0.4;
  return null;
}

function categoricalScore(value: unknown, map: Record<string, number>) {
  const key = normalizedText(value);
  if (!key) return null;
  return map[key] ?? null;
}

function viewReason(row: JsonObject) {
  const values = [
    row.view_match === false ? "wrong angle" : null,
    normalizedText(row.bag_visible) !== "full" ? normalizedText(row.bag_visible) : null,
    row.multiple_bags_visible === true ? "multiple bags visible" : null,
    normalizedText(row.framing) !== "good" ? normalizedText(row.framing) : null,
    normalizedText(row.lighting) !== "good" ? normalizedText(row.lighting) : null,
    normalizedText(row.sharpness) !== "sharp" ? normalizedText(row.sharpness) : null,
  ].filter((value): value is string => Boolean(value));

  return values.length > 0 ? values.join(", ") : null;
}

function identityReason(identity: JsonObject) {
  if (Array.isArray(identity.evidence)) {
    const evidence = identity.evidence.map(String).filter(Boolean);
    if (evidence.length > 0) return evidence.join(" ");
  }
  return stringOrNull(identity.operator_message);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return clamp(values.reduce((sum, value) => sum + value, 0) / values.length, 0, 1);
}

function normalizeView(value: unknown): BaggageView | null {
  return VIEWS.some((view) => view.key === value) ? (value as BaggageView) : null;
}

function toObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function stringOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizedText(value: unknown) {
  return stringOrNull(value)?.toLowerCase().replace(/\s+/g, "_") ?? null;
}

function numberOrNull(value: unknown) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function integerOrNull(value: unknown) {
  const number = finiteNumber(value);
  if (number == null || number < 0) return null;
  return Math.round(number);
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
