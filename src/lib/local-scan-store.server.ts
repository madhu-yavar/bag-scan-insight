import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { BaggageView } from "@/lib/baggage-views";
import type {
  LocalScanDetail,
  LocalScanSummary,
  ManualDimensionsCm,
  SaveLocalScanData,
  TravelContext,
} from "./local-scan-store.types";

const DATA_DIR = resolve(process.cwd(), "data");
const IMAGE_DIR = resolve(DATA_DIR, "bagscan-images");
const DB_PATH = resolve(DATA_DIR, "bagscan.sqlite");

type ScanRow = {
  id: string;
  user_id: string;
  reference: string | null;
  notes: string | null;
  model: string;
  status: string;
  created_at: string;
  updated_at: string;
  pnr: string | null;
  airline: string | null;
  flight_number: string | null;
  flight_date: string | null;
  departure_airport: string | null;
  arrival_airport: string | null;
  terminal: string | null;
  bag_tag: string | null;
  baggage_category: string | null;
  weight_kg: number | null;
  special_handling: string | null;
  manual_dimensions_json: string | null;
  approved_review_views: string;
  analysis_json: string;
  capture_validation_status: string | null;
  summary: string | null;
  bag_type: string | null;
  overall_condition: string | null;
  image_count: number;
};

type ImageRow = {
  view: BaggageView;
  file_path: string;
  mime_type: string;
  bytes: number;
};

let db: DatabaseSync | null = null;

export function saveScan(userId: string, data: SaveLocalScanData): LocalScanSummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  const scanDir = resolve(IMAGE_DIR, id);
  mkdirSync(scanDir, { recursive: true });

  const analysisObject = toObject(data.analysis);
  const validation = toObject(analysisObject?.capture_validation);
  const captureValidationStatus = stringOrNull(validation?.overall_status);
  const summary = stringOrNull(analysisObject?.summary);
  const bagType = stringOrNull(analysisObject?.bag_type);
  const overallCondition = stringOrNull(analysisObject?.overall_condition);

  const imageRows = data.images.map((image) => {
    const parsed = parseDataUrl(image.data_url);
    const extension = imageExtension(parsed.mimeType);
    const absolutePath = resolve(scanDir, `${image.view}.${extension}`);
    writeFileSync(absolutePath, parsed.buffer);
    return {
      view: image.view,
      filePath: storedPath(absolutePath),
      mimeType: parsed.mimeType,
      bytes: parsed.buffer.byteLength,
    };
  });

  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const travel = normalizeTravelContext(data.travel_context);
    database
      .prepare(
        `INSERT INTO scans (
          id, user_id, reference, notes, model, status, created_at, updated_at,
          pnr, airline, flight_number, flight_date, departure_airport, arrival_airport, terminal,
          bag_tag, baggage_category, weight_kg, special_handling, manual_dimensions_json,
          approved_review_views, analysis_json, capture_validation_status,
          summary, bag_type, overall_condition
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        normalizeText(data.reference),
        normalizeText(data.notes),
        data.model,
        "completed",
        now,
        now,
        travel?.pnr ?? null,
        travel?.airline ?? null,
        travel?.flight_number ?? null,
        travel?.flight_date ?? null,
        travel?.departure_airport ?? null,
        travel?.arrival_airport ?? null,
        travel?.terminal ?? null,
        travel?.bag_tag ?? null,
        travel?.baggage_category ?? null,
        travel?.weight_kg ?? null,
        travel?.special_handling ?? null,
        data.manual_dimensions_cm ? JSON.stringify(data.manual_dimensions_cm) : null,
        JSON.stringify(data.approved_review_views),
        JSON.stringify(data.analysis),
        captureValidationStatus,
        summary,
        bagType,
        overallCondition,
      );

    const insertImage = database.prepare(
      `INSERT INTO scan_images (scan_id, view, file_path, mime_type, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const image of imageRows) {
      insertImage.run(id, image.view, image.filePath, image.mimeType, image.bytes, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return scanRowToSummary(readScanRow(userId, id));
}

export function listScans(userId: string, limit: number): LocalScanSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT
        s.*,
        COUNT(i.view) AS image_count
       FROM scans s
       LEFT JOIN scan_images i ON i.scan_id = s.id
       WHERE s.user_id = ?
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as ScanRow[];

  return rows.map(scanRowToSummary);
}

export function getScan(userId: string, id: string): LocalScanDetail {
  const row = readScanRow(userId, id);
  const summary = scanRowToSummary(row);
  const images = getDb()
    .prepare(
      `SELECT view, file_path, mime_type, bytes
       FROM scan_images
       WHERE scan_id = ?
       ORDER BY CASE view
         WHEN 'front' THEN 1
         WHEN 'back' THEN 2
         WHEN 'top' THEN 3
         WHEN 'side' THEN 4
         ELSE 5
       END`,
    )
    .all(id) as ImageRow[];

  return {
    ...summary,
    analysis: parseJson(row.analysis_json, null),
    images: images.map((image) => ({
      view: image.view,
      filePath: image.file_path,
      mimeType: image.mime_type,
      bytes: image.bytes,
      dataUrl: readImageDataUrl(image),
    })),
  };
}

export function updateApprovals(userId: string, id: string, approvedReviewViews: string[]) {
  readScanRow(userId, id);
  getDb()
    .prepare(
      `UPDATE scans SET approved_review_views = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(JSON.stringify(approvedReviewViews), new Date().toISOString(), id, userId);
}

function readScanRow(userId: string, id: string): ScanRow {
  const row = getDb()
    .prepare(
      `SELECT
        s.*,
        COUNT(i.view) AS image_count
       FROM scans s
       LEFT JOIN scan_images i ON i.scan_id = s.id
       WHERE s.id = ? AND s.user_id = ?
       GROUP BY s.id`,
    )
    .get(id, userId) as ScanRow | undefined;

  if (!row) throw new Error("Saved scan not found.");
  return row;
}

function scanRowToSummary(row: ScanRow): LocalScanSummary {
  return {
    id: row.id,
    reference: row.reference,
    notes: row.notes,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    travelContext: rowToTravelContext(row),
    manualDimensionsCm: parseManualDimensions(row.manual_dimensions_json),
    approvedReviewViews: parseJson<string[]>(row.approved_review_views, []),
    captureValidationStatus: row.capture_validation_status,
    summary: row.summary,
    bagType: row.bag_type,
    overallCondition: row.overall_condition,
    imageCount: Number(row.image_count ?? 0),
  };
}

function getDb() {
  if (db) return db;

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(IMAGE_DIR, { recursive: true });

  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reference TEXT,
      notes TEXT,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      pnr TEXT,
      airline TEXT,
      flight_number TEXT,
      flight_date TEXT,
      departure_airport TEXT,
      arrival_airport TEXT,
      terminal TEXT,
      bag_tag TEXT,
      baggage_category TEXT,
      weight_kg REAL,
      special_handling TEXT,
      manual_dimensions_json TEXT,
      approved_review_views TEXT NOT NULL DEFAULT '[]',
      analysis_json TEXT NOT NULL,
      capture_validation_status TEXT,
      summary TEXT,
      bag_type TEXT,
      overall_condition TEXT
    );
    CREATE TABLE IF NOT EXISTS scan_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id TEXT NOT NULL,
      view TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(scan_id, view),
      FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scan_images_scan_id ON scan_images(scan_id);
  `);
  ensureColumn(db, "scans", "user_id", "TEXT");
  ensureColumn(db, "scans", "pnr", "TEXT");
  ensureColumn(db, "scans", "airline", "TEXT");
  ensureColumn(db, "scans", "flight_number", "TEXT");
  ensureColumn(db, "scans", "flight_date", "TEXT");
  ensureColumn(db, "scans", "departure_airport", "TEXT");
  ensureColumn(db, "scans", "arrival_airport", "TEXT");
  ensureColumn(db, "scans", "terminal", "TEXT");
  ensureColumn(db, "scans", "bag_tag", "TEXT");
  ensureColumn(db, "scans", "baggage_category", "TEXT");
  ensureColumn(db, "scans", "weight_kg", "REAL");
  ensureColumn(db, "scans", "special_handling", "TEXT");
  ensureColumn(db, "scans", "manual_dimensions_json", "TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_scans_user_created_at ON scans(user_id, created_at DESC)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_scans_user_pnr ON scans(user_id, pnr)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_scans_user_flight ON scans(user_id, flight_number)");

  return db;
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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

function readImageDataUrl(image: ImageRow) {
  const absolutePath = resolve(process.cwd(), image.file_path);
  if (!existsSync(absolutePath)) return null;
  const base64 = readFileSync(absolutePath).toString("base64");
  return `data:${image.mime_type};base64,${base64}`;
}

function storedPath(absolutePath: string) {
  return relative(process.cwd(), absolutePath).split(sep).join("/");
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
    weight_kg: positiveNumber(value.weight_kg),
    special_handling: normalizeText(value.special_handling ?? undefined),
  };
  return Object.values(travel).some((item) => item != null) ? travel : null;
}

function rowToTravelContext(row: ScanRow): TravelContext | null {
  return normalizeTravelContext({
    pnr: row.pnr,
    airline: row.airline,
    flight_number: row.flight_number,
    flight_date: row.flight_date,
    departure_airport: row.departure_airport,
    arrival_airport: row.arrival_airport,
    terminal: row.terminal,
    bag_tag: row.bag_tag,
    baggage_category: row.baggage_category,
    weight_kg: row.weight_kg,
    special_handling: row.special_handling,
  });
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseManualDimensions(value: string | null): ManualDimensionsCm | null {
  if (!value) return null;
  const parsed = parseJson<unknown>(value, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const dimensions = parsed as Record<string, unknown>;
  const width = numberOrNull(dimensions.width);
  const height = numberOrNull(dimensions.height);
  const depth = numberOrNull(dimensions.depth);
  return width && height && depth ? { width, height, depth } : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}
