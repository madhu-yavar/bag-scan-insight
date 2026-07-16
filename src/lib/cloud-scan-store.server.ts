import { createHash, randomUUID } from "node:crypto";
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
import type { ManualDimensionsCm, TravelContext } from "./local-scan-store.types";

const PHOTO_BUCKET = "bagscan-photos";
const SIGNED_URL_SECONDS = 60 * 60;
const DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
const SESSION_SELECT =
  "id,org_id,user_id,reference,notes,pnr,airline,flight_number,flight_date,departure_airport,arrival_airport,terminal,bag_tag,baggage_category,baggage_category_source,weight_kg,special_handling,status,model,manual_dimensions_json,approved_review_views,capture_validation_status,created_at,updated_at";
const ANALYTICS_SESSION_SELECT =
  "id,org_id,status,pnr,airline,flight_number,flight_date,departure_airport,arrival_airport,terminal,bag_tag,baggage_category,baggage_category_source,weight_kg,special_handling,created_at";

export async function saveCloudScan(
  supabase: SupabaseClient,
  userId: string,
  data: SaveCloudScanData,
): Promise<CloudScanSummary> {
  const scanId = randomUUID();
  const now = new Date().toISOString();
  const normalized = normalizeScanAnalysis(data.analysis);
  const orgId = await ensureDefaultOrgMembership(supabase, userId);
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
        org_id: orgId,
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
    const travel = normalizeTravelContext(data.travel_context);
    const sessionInsert = await supabase.from("bagscan_sessions").insert({
      id: scanId,
      org_id: orgId,
      user_id: userId,
      reference: normalizeText(data.reference),
      notes: normalizeText(data.notes),
      pnr: travel?.pnr ?? null,
      pnr_hash: travel?.pnr ? hashPnr(travel.pnr) : null,
      airline: travel?.airline ?? null,
      flight_number: travel?.flight_number ?? null,
      flight_date: travel?.flight_date ?? null,
      departure_airport: travel?.departure_airport ?? null,
      arrival_airport: travel?.arrival_airport ?? null,
      terminal: travel?.terminal ?? null,
      bag_tag: travel?.bag_tag ?? null,
      baggage_category: travel?.baggage_category ?? null,
      baggage_category_source: travel?.baggage_category_source ?? null,
      weight_kg: travel?.weight_kg ?? null,
      special_handling: travel?.special_handling ?? null,
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
      org_id: orgId,
      user_id: userId,
      summary: normalized.summary,
      bag_type: normalized.bagType,
      size_class: normalized.sizeClass,
      brand_guess: normalized.brandGuess,
      brand_confidence: normalized.brandConfidence,
      visible_logo_text: normalized.visibleLogoText,
      model_guess: normalized.modelGuess,
      model_confidence: normalized.modelConfidence,
      shell_type: normalized.shellType,
      luggage_form_factor: normalized.luggageFormFactor,
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
          org_id: orgId,
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
          org_id: orgId,
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
  await ensureDefaultOrgMembership(supabase, userId);
  const sessionsResult = await supabase
    .from("bagscan_sessions")
    .select(SESSION_SELECT)
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
  await ensureDefaultOrgMembership(supabase, userId);
  const sessionResult = await supabase
    .from("bagscan_sessions")
    .select(SESSION_SELECT)
    .eq("id", id)
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
  await ensureDefaultOrgMembership(supabase, userId);
  const [sessionsResult, extractionsResult, imagesResult, damageResult, recentScans] =
    await Promise.all([
      supabase.from("bagscan_sessions").select(ANALYTICS_SESSION_SELECT).limit(5000),
      supabase
        .from("bagscan_extractions")
        .select(
          "scan_id,org_id,bag_type,size_class,brand_guess,brand_confidence,visible_logo_text,model_guess,model_confidence,shell_type,luggage_form_factor,primary_color,material,overall_condition,wheel_count,wheel_type,width_cm,height_cm,depth_cm,quality_score,identity_score,volume_liters,raw_analysis",
        )
        .limit(5000),
      supabase
        .from("bagscan_images")
        .select("view,quality_score,identity_score,view_validation_status")
        .limit(20000),
      supabase.from("bagscan_damage_findings").select("severity").limit(10000),
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
  const allRecentScans = recentScans
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 10);
  const extractionByScan = new Map(extractions.map((row) => [stringField(row, "scan_id"), row]));
  const travelRows = travelAnalyticsRows(sessions, extractionByScan);
  const weightedRows = travelRows.filter((row) => row.weightKg != null);
  const dimensionRows = extractions.filter((row) => linearCm(row) != null);
  const oversizeCandidates = dimensionRows.filter((row) => (linearCm(row) ?? 0) > 158).length;
  const highVolumeCandidates = extractions.filter(
    (row) => (numberField(row, "volume_liters") ?? 0) >= 90,
  ).length;

  return {
    totals: {
      scans: sessions.length,
      photos: images.length,
      completed: sessions.filter((row) => stringField(row, "status") === "completed").length,
      needsReview: sessions.filter((row) => stringField(row, "status") === "needs_review").length,
      failed: sessions.filter((row) => stringField(row, "status") === "failed").length,
      damages: damages.length,
      avgQualityScore: average(extractions.map((row) => numberField(row, "quality_score"))),
      avgIdentityScore: average(extractions.map((row) => numberField(row, "identity_score"))),
      avgVolumeLiters: average(extractions.map((row) => numberField(row, "volume_liters"))),
    },
    sources: {
      cloudScans: sessions.length,
      localScans: 0,
      cloudPhotos: images.length,
      localPhotos: 0,
    },
    operational: {
      dimensionReadyScans: dimensionRows.length,
      oversizeCandidates,
      highVolumeCandidates,
      avgLinearCm: average(dimensionRows.map(linearCm)),
      reviewRate: ratio(
        sessions.filter((row) => stringField(row, "status") === "needs_review").length,
        sessions.length,
      ),
      damageRate: ratio(damages.length, sessions.length),
      planningReadiness: ratio(dimensionRows.length, sessions.length),
    },
    travel: {
      pnrLinkedScans: travelRows.filter((row) => row.pnr).length,
      uniquePnrs: uniqueCount(travelRows.map((row) => row.pnr)),
      uniqueFlights: uniqueCount(travelRows.map(flightIdentity)),
      uniqueAirlines: uniqueCount(travelRows.map((row) => row.airline)),
      weightedScans: weightedRows.length,
      totalWeightKg: sumNullable(weightedRows.map((row) => row.weightKg)),
      avgWeightKg: average(weightedRows.map((row) => row.weightKg)),
      pnrReadiness: ratio(
        travelRows.filter((row) => row.pnr && row.flightNumber && row.weightKg != null).length,
        sessions.length,
      ),
    },
    filterOptions: {
      airlines: sortedUnique(travelRows.map((row) => row.airline)),
      airports: sortedUnique(
        travelRows.flatMap((row) => [row.departureAirport, row.arrivalAirport]),
      ),
      terminals: sortedUnique(travelRows.map((row) => terminalLabel(row))),
      flightDates: sortedUnique(travelRows.map((row) => row.flightDate)),
      baggageCategories: sortedUnique(travelRows.map((row) => row.baggageCategory)),
    },
    travelRecords: travelRows.map(travelRecordForDashboard),
    manufacturingRecords: extractions.map(manufacturingRecordForDashboard),
    airlineLoads: groupedTravelLoads(travelRows, airlineLabel),
    airportLoads: groupedTravelLoads(travelRows, airportLabel),
    flightLoads: groupedTravelLoads(travelRows, flightLabel),
    terminalLoads: groupedTravelLoads(travelRows, terminalLabel),
    pnrGroups: groupedTravelLoads(travelRows, pnrLabel),
    bagTypes: distribution(extractions, "bag_type"),
    baggageCategories: distribution(sessions, "baggage_category"),
    brands: distribution(extractions, "brand_guess"),
    formFactors: distribution(extractions, "luggage_form_factor"),
    shellTypes: distribution(extractions, "shell_type"),
    sizeClasses: distribution(extractions, "size_class"),
    primaryColors: distribution(extractions, "primary_color"),
    conditions: distribution(extractions, "overall_condition"),
    materials: distribution(extractions, "material"),
    wheelCounts: distribution(extractions, "wheel_count"),
    wheelTypes: distribution(extractions, "wheel_type"),
    lockSignals: featureDistribution(extractions, (feature) => /lock/i.test(feature)),
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
    recentScans: allRecentScans,
  };
}

type TravelAnalyticsRow = {
  id: string;
  status: string;
  createdAt: string;
  pnr: string | null;
  airline: string | null;
  flightNumber: string | null;
  flightDate: string | null;
  departureAirport: string | null;
  arrivalAirport: string | null;
  terminal: string | null;
  bagTag: string | null;
  baggageCategory: string | null;
  weightKg: number | null;
  linearCm: number | null;
  volumeLiters: number | null;
  bagType: string | null;
  sizeClass: string | null;
  overallCondition: string | null;
};

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
    travelContext: rowToTravelContext(session),
    manualDimensionsCm: dimensions,
    approvedReviewViews: parseStringArray(session.approved_review_views),
    captureValidationStatus:
      stringOrNull(session.capture_validation_status) ??
      stringOrNull(extraction?.capture_validation_status),
    summary: stringOrNull(extraction?.summary),
    bagType: stringOrNull(extraction?.bag_type),
    sizeClass: stringOrNull(extraction?.size_class),
    brandGuess: stringOrNull(extraction?.brand_guess),
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
    const label = labelFromValue(row[key]);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

function featureDistribution(rowsToCount: Row[], predicate: (feature: string) => boolean) {
  const counts = new Map<string, number>();
  for (const row of rowsToCount) {
    const analysis = parseDataObject(row.raw_analysis);
    const features = Array.isArray(analysis?.features) ? analysis.features.map(String) : [];
    const matched = features.filter((feature) => predicate(feature));
    if (matched.length === 0) {
      counts.set("not_visible", (counts.get("not_visible") ?? 0) + 1);
      continue;
    }
    for (const feature of matched) counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

function labelFromValue(value: unknown) {
  if (typeof value === "string") return stringOrNull(value) ?? "unknown";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "unknown";
}

function travelAnalyticsRows(
  sessions: Row[],
  extractionByScan: Map<string, Row>,
): TravelAnalyticsRow[] {
  return sessions.map((session) => {
    const id = stringField(session, "id");
    const extraction = extractionByScan.get(id);
    return {
      id,
      status: stringField(session, "status"),
      createdAt: stringField(session, "created_at"),
      pnr: stringOrNull(session.pnr),
      airline: stringOrNull(session.airline),
      flightNumber: stringOrNull(session.flight_number),
      flightDate: stringOrNull(session.flight_date),
      departureAirport: stringOrNull(session.departure_airport),
      arrivalAirport: stringOrNull(session.arrival_airport),
      terminal: stringOrNull(session.terminal),
      bagTag: stringOrNull(session.bag_tag),
      baggageCategory: stringOrNull(session.baggage_category),
      weightKg: numberField(session, "weight_kg"),
      linearCm: extraction ? linearCm(extraction) : null,
      volumeLiters: extraction ? numberField(extraction, "volume_liters") : null,
      bagType: stringOrNull(extraction?.bag_type),
      sizeClass: stringOrNull(extraction?.size_class),
      overallCondition: stringOrNull(extraction?.overall_condition),
    };
  });
}

function travelRecordForDashboard(row: TravelAnalyticsRow) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    pnr: row.pnr,
    airline: row.airline,
    flightNumber: row.flightNumber,
    flightDate: row.flightDate,
    departureAirport: row.departureAirport,
    arrivalAirport: row.arrivalAirport,
    terminal: row.terminal,
    bagTag: row.bagTag,
    baggageCategory: row.baggageCategory,
    weightKg: row.weightKg,
    linearCm: row.linearCm,
    volumeLiters: row.volumeLiters,
    bagType: row.bagType,
    sizeClass: row.sizeClass,
    overallCondition: row.overallCondition,
  };
}

function manufacturingRecordForDashboard(row: Row) {
  const analysis = parseDataObject(row.raw_analysis);
  const features = Array.isArray(analysis?.features) ? analysis.features.map(String) : [];
  return {
    id: stringField(row, "scan_id"),
    brandGuess: stringOrNull(row.brand_guess),
    bagType: stringOrNull(row.bag_type),
    sizeClass: stringOrNull(row.size_class),
    shellType: stringOrNull(row.shell_type),
    formFactor: stringOrNull(row.luggage_form_factor),
    primaryColor: stringOrNull(row.primary_color),
    material: stringOrNull(row.material),
    wheelCount: numberField(row, "wheel_count"),
    wheelType: stringOrNull(row.wheel_type),
    overallCondition: stringOrNull(row.overall_condition),
    widthCm: numberField(row, "width_cm"),
    heightCm: numberField(row, "height_cm"),
    depthCm: numberField(row, "depth_cm"),
    volumeLiters: numberField(row, "volume_liters"),
    lockSignals: features.filter((feature) => /lock/i.test(feature)),
  };
}

function groupedTravelLoads(
  rowsToGroup: TravelAnalyticsRow[],
  getLabel: (row: TravelAnalyticsRow) => string | null,
) {
  const groups = new Map<
    string,
    {
      label: string;
      count: number;
      totalWeightKg: number;
      weightCount: number;
      oversizeCount: number;
      highVolumeCount: number;
    }
  >();

  for (const row of rowsToGroup) {
    const label = getLabel(row);
    if (!label) continue;
    const group = groups.get(label) ?? {
      label,
      count: 0,
      totalWeightKg: 0,
      weightCount: 0,
      oversizeCount: 0,
      highVolumeCount: 0,
    };
    group.count += 1;
    if (row.weightKg != null) {
      group.totalWeightKg += row.weightKg;
      group.weightCount += 1;
    }
    if ((row.linearCm ?? 0) > 158) group.oversizeCount += 1;
    if ((row.volumeLiters ?? 0) >= 90) group.highVolumeCount += 1;
    groups.set(label, group);
  }

  return [...groups.values()]
    .map((group) => ({
      label: group.label,
      count: group.count,
      totalWeightKg: group.weightCount > 0 ? Math.round(group.totalWeightKg * 10) / 10 : null,
      oversizeCount: group.oversizeCount,
      highVolumeCount: group.highVolumeCount,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function airlineLabel(row: TravelAnalyticsRow) {
  return row.airline || null;
}

function airportLabel(row: TravelAnalyticsRow) {
  return row.departureAirport || row.arrivalAirport || null;
}

function flightLabel(row: TravelAnalyticsRow) {
  if (!row.flightNumber && !row.airline) return null;
  const flight = [row.airline, row.flightNumber].filter(Boolean).join(" ");
  const route = [row.departureAirport, row.arrivalAirport].filter(Boolean).join("-");
  return [flight || "Unknown flight", row.flightDate, route].filter(Boolean).join(" · ");
}

function terminalLabel(row: TravelAnalyticsRow) {
  if (!row.departureAirport && !row.terminal) return null;
  return [row.departureAirport || "Unknown airport", row.terminal || "Terminal n/a"].join(" · ");
}

function pnrLabel(row: TravelAnalyticsRow) {
  if (!row.pnr) return null;
  const flight = [row.airline, row.flightNumber].filter(Boolean).join(" ");
  return [row.pnr, flight].filter(Boolean).join(" · ");
}

function flightIdentity(row: TravelAnalyticsRow) {
  if (!row.flightNumber && !row.airline) return null;
  return [row.airline, row.flightNumber, row.flightDate, row.departureAirport, row.arrivalAirport]
    .filter(Boolean)
    .join("|");
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

function normalizeUpperText(value: string | null | undefined) {
  const trimmed = normalizeText(value ?? undefined);
  return trimmed ? trimmed.toUpperCase() : null;
}

function normalizeTravelContext(value: TravelContext | null | undefined): TravelContext | null {
  if (!value) return null;
  const travel = {
    pnr: normalizeUpperText(value.pnr),
    airline: normalizeText(value.airline ?? undefined),
    flight_number: normalizeUpperText(value.flight_number),
    flight_date: normalizeText(value.flight_date ?? undefined),
    departure_airport: normalizeUpperText(value.departure_airport),
    arrival_airport: normalizeUpperText(value.arrival_airport),
    terminal: normalizeText(value.terminal ?? undefined),
    bag_tag: normalizeUpperText(value.bag_tag),
    baggage_category: normalizeText(value.baggage_category ?? undefined),
    baggage_category_source: normalizeCategorySource(value.baggage_category_source),
    weight_kg: positiveNumber(value.weight_kg),
    special_handling: normalizeText(value.special_handling ?? undefined),
  };
  return Object.values(travel).some((item) => item != null) ? travel : null;
}

function rowToTravelContext(row: Row): TravelContext | null {
  return normalizeTravelContext({
    pnr: stringOrNull(row.pnr),
    airline: stringOrNull(row.airline),
    flight_number: stringOrNull(row.flight_number),
    flight_date: stringOrNull(row.flight_date),
    departure_airport: stringOrNull(row.departure_airport),
    arrival_airport: stringOrNull(row.arrival_airport),
    terminal: stringOrNull(row.terminal),
    bag_tag: stringOrNull(row.bag_tag),
    baggage_category: stringOrNull(row.baggage_category),
    baggage_category_source: normalizeCategorySource(row.baggage_category_source),
    weight_kg: numberField(row, "weight_kg"),
    special_handling: stringOrNull(row.special_handling),
  });
}

function hashPnr(pnr: string) {
  return createHash("sha256").update(pnr).digest("hex");
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

function linearCm(row: Row) {
  const width = numberField(row, "width_cm");
  const height = numberField(row, "height_cm");
  const depth = numberField(row, "depth_cm");
  if (width == null || height == null || depth == null) return null;
  return width + height + depth;
}

function ratio(value: number, total: number) {
  return total > 0 ? value / total : null;
}

function sumNullable(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

function average(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function uniqueCount(values: Array<string | null>) {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function sortedUnique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 100);
}

function isRow(value: unknown): value is Row {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCategorySource(value: unknown): TravelContext["baggage_category_source"] {
  return value === "manual" || value === "system" || value === "operator_override" ? value : null;
}

async function ensureDefaultOrgMembership(supabase: SupabaseClient, userId: string) {
  const result = await supabase.from("bagscan_org_members").upsert(
    {
      org_id: DEFAULT_ORG_ID,
      user_id: userId,
      role: "operator",
    },
    { onConflict: "org_id,user_id", ignoreDuplicates: true },
  );
  if (result.error) {
    throw new Error(`Could not initialize analytics organization: ${result.error.message}`);
  }
  return DEFAULT_ORG_ID;
}
