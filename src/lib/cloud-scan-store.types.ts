import type { BaggageView } from "@/lib/baggage-views";
import type { ManualDimensionsCm, TravelContext } from "./local-scan-store.types";

export type CloudScanImageInput = {
  view: BaggageView;
  data_url: string;
};

export type SaveCloudScanData = {
  reference?: string;
  notes?: string;
  model: string;
  travel_context?: TravelContext | null;
  manual_dimensions_cm?: ManualDimensionsCm | null;
  approved_review_views: BaggageView[];
  images: CloudScanImageInput[];
  analysis: unknown;
};

export type CloudScanSummary = {
  id: string;
  reference: string | null;
  notes: string | null;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  travelContext: TravelContext | null;
  manualDimensionsCm: ManualDimensionsCm | null;
  approvedReviewViews: string[];
  captureValidationStatus: string | null;
  summary: string | null;
  bagType: string | null;
  sizeClass: string | null;
  overallCondition: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  volumeLiters: number | null;
  qualityScore: number | null;
  identityScore: number | null;
  imageCount: number;
  storage: "cloud";
};

export type CloudScanImage = {
  view: BaggageView;
  storagePath: string;
  filePath: string;
  mimeType: string;
  bytes: number;
  dataUrl: string | null;
  signedUrl: string | null;
  qualityScore: number | null;
  identityScore: number | null;
  viewValidationStatus: string | null;
};

export type CloudDamageFinding = {
  location: string | null;
  damageType: string | null;
  severity: string | null;
  description: string | null;
  confidence: string | null;
};

export type CloudValidationEvent = {
  view: BaggageView | null;
  eventType: string;
  accepted: boolean | null;
  score: number | null;
  confidence: string | null;
  reason: string | null;
  createdAt: string;
};

export type CloudScanDetail = CloudScanSummary & {
  analysis: unknown;
  images: CloudScanImage[];
  damageFindings: CloudDamageFinding[];
  validationEvents: CloudValidationEvent[];
};

export type AnalyticsScanSummary = Omit<CloudScanSummary, "storage"> & {
  storage: "cloud" | "local";
};

export type CloudAnalytics = {
  totals: {
    scans: number;
    photos: number;
    completed: number;
    needsReview: number;
    failed: number;
    damages: number;
    avgQualityScore: number | null;
    avgIdentityScore: number | null;
    avgVolumeLiters: number | null;
  };
  sources: {
    cloudScans: number;
    localScans: number;
    cloudPhotos: number;
    localPhotos: number;
  };
  operational: {
    dimensionReadyScans: number;
    oversizeCandidates: number;
    highVolumeCandidates: number;
    avgLinearCm: number | null;
    reviewRate: number | null;
    damageRate: number | null;
    planningReadiness: number | null;
  };
  travel: {
    pnrLinkedScans: number;
    uniquePnrs: number;
    uniqueFlights: number;
    uniqueAirlines: number;
    weightedScans: number;
    totalWeightKg: number | null;
    avgWeightKg: number | null;
    pnrReadiness: number | null;
  };
  flightLoads: Array<{
    label: string;
    count: number;
    totalWeightKg: number | null;
    oversizeCount: number;
    highVolumeCount: number;
  }>;
  terminalLoads: Array<{
    label: string;
    count: number;
    totalWeightKg: number | null;
    oversizeCount: number;
    highVolumeCount: number;
  }>;
  pnrGroups: Array<{
    label: string;
    count: number;
    totalWeightKg: number | null;
    oversizeCount: number;
    highVolumeCount: number;
  }>;
  bagTypes: Array<{ label: string; count: number }>;
  sizeClasses: Array<{ label: string; count: number }>;
  conditions: Array<{ label: string; count: number }>;
  materials: Array<{ label: string; count: number }>;
  damageSeverity: Array<{ label: string; count: number }>;
  viewQuality: Array<{
    view: BaggageView;
    imageCount: number;
    avgQualityScore: number | null;
    avgIdentityScore: number | null;
    rejectedCount: number;
  }>;
  recentScans: AnalyticsScanSummary[];
};
