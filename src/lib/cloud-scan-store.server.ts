import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BaggageView } from "@/lib/baggage-views";
import { VIEWS } from "@/lib/baggage-views";
import { normalizeScanAnalysis } from "./analysis-normalizer";
import type {
  CloudAnalytics,
  CloudDamageFinding,
  CloudScanDetail,
  CloudScanImage,
  CloudScanSummary,
  CloudValidationEvent,
  SaveCloudScanData,
} from "./cloud-scan-store.types";
import type { ManualDimensionsCm } from "./local-scan-store.types";

const PHOTO_BUCKET = "bagscan-photos";
const SIGNED_URL_SECONDS = 60 * 60;

type Row = Record<string, unknown>;

export async function saveCloudScan(
  supabase: SupabaseClient,
  userId: string,
  data: SaveCloudScanData,
): Promise<CloudScanSummary> {
  const scanId = randomUUID();
  const now = new Date().toISOString();
  const normalized = normalizeScanAnalysis(data.analysis);
  const uploadedPaths: string[] = [];
  const imageRows: Row[] = [];

  try {
    for (const image of data.images) {
      const parsed = parseDataUrl(image.data_url);
      const storagePath = `${userId}/${scanId}/${image.view}.${imageExtension(parsed.mimeType)}`;
      const upload = await supabase.storage.from(PHOTO_BUCKET).upload(storagePath, parsed.buffer, {
        contentType: parsed.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });
      if (upload.error) throw new Error(`Photo upload failed: ${upload.error.message}`);
      uploadedPaths.push(storagePath);

      const metrics = normalized.imageMetrics[image.view];
      imageRows.push({
        scan_id: scanId,
        user_id: userId,
        view: image.view,
        storage_bucket: PHOTO_BUCKET,
        storage_path: storagePath,
        mime_type: parsed.mimeType,
        bytes: parsed.buffer.byteLength,
        view_validation_status: metrics.viewValidationStatus,
        view_confidence: metrics.viewConfidence,
        quality_score: metrics.qualityScore,
        identity_score: metrics.identityScore,
        created_at: now,
      });
    }

    const status =
      normalized.captureValidationStatus === "needs_review" ? "needs_review" : "completed";
    const sessionInsert = await supabase.from("bagscan_sessions").insert({
      id: scanId,
      user_id: userId,
      reference: normalizeText(data.reference),
      notes: normalizeText(data.notes),
      status,
      model: data.model,
      analysis_version: "local-gemini-v1",
      manual_dimensions_json: data.manual_dimensions_cm ?? null,
      approved_review_views: data.approved_review_views,
      capture_validation_status: normalized.captureValidationStatus,
      created_at: now,
      completed_at: now,
      updated_at: now,
    });
    if (sessionInsert.error) throw new Error(`Scan save failed: ${sessionInsert.error.message}`);

    if (imageRows.length > 0) {
      const imageInsert = await supabase.from("bagscan_images").insert(imageRows);
      if (imageInsert.error)
        throw new Error(`Image metadata save failed: ${imageInsert.error.message}`);
    }

    const dimensions = data.manual_dimensions_cm;
    const extractionInsert = await supabase.from("bagscan_extractions").insert({
      scan_id: scanId,
      user_id: userId,
      summary: normalized.summary,
      bag_type: normalized.bagType,
      size_class: normalized.sizeClass,
      brand_guess: normalized.brandGuess,
      width_cm: dimensions?.width ?? normalized.widthCm,
      height_cm: dimensions?.height ?? normalized.heightCm,
      depth_cm: dimensions?.depth ?? normalized.depthCm,
      dimension_confidence: dimensions ? "high" : normalized.dimensionConfidence,
      dimension_basis: dimensions ? "manual" : normalized.dimensionBasis,
      primary_color: normalized.primaryColor,
      secondary_color: normalized.secondaryColor,
      material: normalized.material,
      texture: normalized.texture,
      wheel_count: normalized.wheelCount,
      wheel_type: normalized.wheelType,
      handle_count: normalized.handleCount,
      overall_condition: normalized.overallCondition,
      capture_validation_status: normalized.captureValidationStatus,
      identity_score: normalized.identityScore,
      quality_score: normalized.qualityScore,
      raw_analysis: data.analysis,
      created_at: now,
      updated_at: now,
    });
    if (extractionInsert.error) {
      throw new Error(`Extraction save failed: ${extractionInsert.error.message}`);
    }

    if (normalized.damageFindings.length > 0) {
      const damageInsert = await supabase.from("bagscan_damage_findings").insert(
        normalized.damageFindings.map((item) => ({
          scan_id: scanId,
          user_id: userId,
          location: item.location,
          damage_type: item.damageType,
          severity: item.severity,
          description: item.description,
          confidence: item.confidence,
          created_at: now,
        })),
      );
      if (damageInsert.error)
        throw new Error(`Damage findings save failed: ${damageInsert.error.message}`);
    }

    if (normalized.validationEvents.length > 0) {
      const eventInsert = await supabase.from("bagscan_validation_events").insert(
        normalized.validationEvents.map((event) => ({
          scan_id: scanId,
          user_id: userId,
          view: event.view,
          event_type: event.eventType,
          accepted: event.accepted,
          score: event.score,
          confidence: event.confidence,
          reason: event.reason,
          raw_response: event.rawResponse,
          created_at: now,
        })),
      );
      if (eventInsert.error) {
        throw new Error(`Validation events save failed: ${eventInsert.error.message}`);
      }
    }

    const detail = await getCloudScan(supabase, userId, scanId);
    return cloudDetailToSummary(detail);
  } catch (error) {
    await cleanupFailedSave(supabase, userId, scanId, uploadedPaths);
    throw error;
  }
}

export async function listCloudScans(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<CloudScanSummary[]> {
  const sessionsResult = await supabase
    .from("bagscan_sessions")
    .select(
      "id,user_id,reference,notes,status,model,manual_dimensions_json,approved_review_views,capture_validation_status,created_at,updated_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (sessionsResult.error)
    throw new Error(`Could not load cloud reports: ${sessionsResult.error.message}`);

  const sessions = rows(sessionsResult.data);
  if (sessions.length === 0) return [];

  const ids = sessions.map((row) => stringField(row, "id")).filter(Boolean);
  const [extractions, images] = await Promise.all([
    selectRows(supabase, "bagscan_extractions", "*", ids),
    selectRows(supabase, "bagscan_images", "scan_id", ids),
  ]);

  const extractionByScan = new Map(extractions.map((row) => [stringField(row, "scan_id"), row]));
  const imageCounts = countBy(images, "scan_id");

  return sessions.map((session) =>
    rowsToSummary(session, extractionByScan.get(stringField(session, "id")), imageCounts),
  );
}

export async function getCloudScan(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<CloudScanDetail> {
  const sessionResult = await supabase
    .from("bagscan_sessions")
    .select(
      "id,user_id,reference,notes,status,model,manual_dimensions_json,approved_review_views,capture_validation_status,created_at,updated_at",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionResult.error) throw new Error(`Could not load report: ${sessionResult.error.message}`);
  if (!sessionResult.data) throw new Error("Cloud scan not found.");

  const [extraction, imageRows, damageRows, validationRows] = await Promise.all([
    selectSingleRow(supabase, "bagscan_extractions", "*", id),
    selectRows(supabase, "bagscan_images", "*", [id]),
    selectRows(supabase, "bagscan_damage_findings", "*", [id]),
    selectRows(supabase, "bagscan_validation_events", "*", [id]),
  ]);

  const images = await Promise.all(
    imageRows
      .sort((a, b) => viewOrder(stringField(a, "view")) - viewOrder(stringField(b, "view")))
      .map((row) => rowToImage(supabase, row)),
  );

  return {
    ...rowsToSummary(sessionResult.data as Row, extraction, new Map([[id, imageRows.length]])),
    analysis: extraction?.raw_analysis ?? null,
    images,
    damageFindings: damageRows.map(rowToDamage),
    validationEvents: validationRows.map(rowToValidationEvent),
  };
}

export async function updateCloudApprovals(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  approvedReviewViews: BaggageView[],
): Promise<CloudScanSummary> {
  const result = await supabase
    .from("bagscan_sessions")
    .update({
      approved_review_views: approvedReviewViews,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (result.error) throw new Error(`Could not update approvals: ${result.error.message}`);
  return cloudDetailToSummary(await getCloudScan(supabase, userId, id));
}

export async function getCloudAnalytics(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudAnalytics> {
  const [sessionsResult, extractionsResult, imagesResult, damageResult, recentScans] =
    await Promise.all([
      supabase.from("bagscan_sessions").select("id,status").eq("user_id", userId).limit(5000),
      supabase
        .from("bagscan_extractions")
        .select(
          "scan_id,bag_type,size_class,material,overall_condition,quality_score,identity_score,volume_liters",
        )
        .eq("user_id", userId)
        .limit(5000),
      supabase
        .from("bagscan_images")
        .select("view,quality_score,identity_score,view_validation_status")
        .eq("user_id", userId)
        .limit(20000),
      supabase
        .from("bagscan_damage_findings")
        .select("severity")
        .eq("user_id", userId)
        .limit(10000),
      listCloudScans(supabase, userId, 10),
    ]);

  if (sessionsResult.error)
    throw new Error(`Could not load dashboard sessions: ${sessionsResult.error.message}`);
  if (extractionsResult.error)
    throw new Error(`Could not load dashboard extractions: ${extractionsResult.error.message}`);
  if (imagesResult.error)
    throw new Error(`Could not load dashboard image metrics: ${imagesResult.error.message}`);
  if (damageResult.error)
    throw new Error(`Could not load dashboard damage metrics: ${damageResult.error.message}`);

  const sessions = rows(sessionsResult.data);
  const extractions = rows(extractionsResult.data);
  const images = rows(imagesResult.data);
  const damages = rows(damageResult.data);

  return {
    totals: {
      scans: sessions.length,
      completed: sessions.filter((row) => stringField(row, "status") === "completed").length,
      needsReview: sessions.filter((row) => stringField(row, "status") === "needs_review").length,
      failed: sessions.filter((row) => stringField(row, "status") === "failed").length,
      damages: damages.length,
      avgQualityScore: average(extractions.map((row) => numberField(row, "quality_score"))),
      avgIdentityScore: average(extractions.map((row) => numberField(row, "identity_score"))),
      avgVolumeLiters: average(extractions.map((row) => numberField(row, "volume_liters"))),
    },
    bagTypes: distribution(extractions, "bag_type"),
    sizeClasses: distribution(extractions, "size_class"),
    conditions: distribution(extractions, "overall_condition"),
    materials: distribution(extractions, "material"),
    damageSeverity: distribution(damages, "severity"),
    viewQuality: VIEWS.map((view) => {
      const viewRows = images.filter((row) => stringField(row, "view") === view.key);
      return {
        view: view.key,
        imageCount: viewRows.length,
        avgQualityScore: average(viewRows.map((row) => numberField(row, "quality_score"))),
        avgIdentityScore: average(viewRows.map((row) => numberField(row, "identity_score"))),
        rejectedCount: viewRows.filter(
          (row) => stringField(row, "view_validation_status") === "rejected",
        ).length,
      };
    }),
    recentScans,
  };
}

function cloudDetailToSummary(detail: CloudScanDetail): CloudScanSummary {
  const { analysis, images, damageFindings, validationEvents, ...summary } = detail;
  void analysis;
  void images;
  void damageFindings;
  void validationEvents;
  return summary;
}

async function cleanupFailedSave(
  supabase: SupabaseClient,
  userId: string,
  scanId: string,
  paths: string[],
) {
  if (paths.length > 0) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  await supabase.from("bagscan_sessions").delete().eq("id", scanId).eq("user_id", userId);
}

async function selectRows(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  scanIds: string[],
) {
  if (scanIds.length === 0) return [];
  const result = await supabase.from(table).select(columns).in("scan_id", scanIds);
  if (result.error) throw new Error(`Could not load ${table}: ${result.error.message}`);
  return rows(result.data);
}

async function selectSingleRow(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  scanId: string,
) {
  const result = await supabase.from(table).select(columns).eq("scan_id", scanId).maybeSingle();
  if (result.error) throw new Error(`Could not load ${table}: ${result.error.message}`);
  return result.data ? (result.data as Row) : null;
}

async function rowToImage(supabase: SupabaseClient, row: Row): Promise<CloudScanImage> {
  const storagePath = stringField(row, "storage_path");
  const signedUrl = storagePath ? await createSignedUrl(supabase, storagePath) : null;
  return {
    view: normalizeView(row.view) ?? "front",
    storagePath,
    filePath: storagePath,
    mimeType: stringField(row, "mime_type"),
    bytes: numberField(row, "bytes") ?? 0,
    dataUrl: signedUrl,
    signedUrl,
    qualityScore: numberField(row, "quality_score"),
    identityScore: numberField(row, "identity_score"),
    viewValidationStatus: stringOrNull(row.view_validation_status),
  };
}

async function createSignedUrl(supabase: SupabaseClient, storagePath: string) {
  const result = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (result.error) return null;
  return result.data.signedUrl;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function rowsToSummary(
  session: Row,
  extraction: Row | null | undefined,
  imageCounts: Map<string, number>,
): CloudScanSummary {
  const id = stringField(session, "id");
  const dimensions = parseManualDimensions(session.manual_dimensions_json);
  return {
    id,
    reference: stringOrNull(session.reference),
    notes: stringOrNull(session.notes),
    model: stringField(session, "model"),
    status: stringField(session, "status"),
    createdAt: stringField(session, "created_at"),
    updatedAt: stringField(session, "updated_at"),
    manualDimensionsCm: dimensions,
    approvedReviewViews: parseStringArray(session.approved_review_views),
    captureValidationStatus:
      stringOrNull(session.capture_validation_status) ??
      stringOrNull(extraction?.capture_validation_status),
    summary: stringOrNull(extraction?.summary),
    bagType: stringOrNull(extraction?.bag_type),
    sizeClass: stringOrNull(extraction?.size_class),
    overallCondition: stringOrNull(extraction?.overall_condition),
    widthCm: dimensions?.width ?? numberField(extraction, "width_cm"),
    heightCm: dimensions?.height ?? numberField(extraction, "height_cm"),
    depthCm: dimensions?.depth ?? numberField(extraction, "depth_cm"),
    volumeLiters: numberField(extraction, "volume_liters"),
    qualityScore: numberField(extraction, "quality_score"),
    identityScore: numberField(extraction, "identity_score"),
    imageCount: imageCounts.get(id) ?? 0,
    storage: "cloud",
  };
}

function rowToDamage(row: Row): CloudDamageFinding {
  return {
    location: stringOrNull(row.location),
    damageType: stringOrNull(row.damage_type),
    severity: stringOrNull(row.severity),
    description: stringOrNull(row.description),
    confidence: stringOrNull(row.confidence),
  };
}

function rowToValidationEvent(row: Row): CloudValidationEvent {
  return {
    view: normalizeView(row.view),
    eventType: stringField(row, "event_type"),
    accepted: typeof row.accepted === "boolean" ? row.accepted : null,
    score: numberField(row, "score"),
    confidence: stringOrNull(row.confidence),
    reason: stringOrNull(row.reason),
    createdAt: stringField(row, "created_at"),
  };
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new Error("Image payload must be a base64 data URL.");
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function imageExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}

function countBy(items: Row[], key: string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = stringField(item, key);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function distribution(rowsToCount: Row[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rowsToCount) {
    const label = stringOrNull(row[key]) ?? "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

function parseDataObject(value: unknown): Row | null {
  if (typeof value === "string") {
    try {
      return parseDataObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return isRow(value) ? value : null;
}

function parseManualDimensions(value: unknown): ManualDimensionsCm | null {
  const parsed = parseDataObject(value);
  if (!parsed) return null;
  const width = positiveNumber(parsed.width);
  const height = positiveNumber(parsed.height);
  const depth = positiveNumber(parsed.depth);
  return width && height && depth ? { width, height, depth } : null;
}

function parseStringArray(value: unknown) {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeView(value: unknown): BaggageView | null {
  return VIEWS.some((view) => view.key === value) ? (value as BaggageView) : null;
}

function viewOrder(value: string) {
  const index = VIEWS.findIndex((view) => view.key === value);
  return index === -1 ? VIEWS.length : index;
}

function stringField(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

function stringOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberField(row: Row | null | undefined, key: string) {
  return finiteNumber(row?.[key]);
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positiveNumber(value: unknown) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function isRow(value: unknown): value is Row {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
