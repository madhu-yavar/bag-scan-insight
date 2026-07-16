import type { BaggageView } from "@/lib/baggage-views";

export type LocalScanImageInput = {
  view: BaggageView;
  data_url: string;
};

export type ManualDimensionsCm = {
  width: number;
  height: number;
  depth: number;
};

export type TravelContext = {
  pnr?: string | null;
  airline?: string | null;
  flight_number?: string | null;
  flight_date?: string | null;
  departure_airport?: string | null;
  arrival_airport?: string | null;
  terminal?: string | null;
  bag_tag?: string | null;
  baggage_category?: string | null;
  baggage_category_source?: "manual" | "system" | "operator_override" | null;
  weight_kg?: number | null;
  special_handling?: string | null;
};

export type SaveLocalScanData = {
  reference?: string;
  notes?: string;
  model: string;
  travel_context?: TravelContext | null;
  manual_dimensions_cm?: ManualDimensionsCm | null;
  approved_review_views: BaggageView[];
  images: LocalScanImageInput[];
  analysis: unknown;
};

export type LocalScanSummary = {
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
  overallCondition: string | null;
  imageCount: number;
};

export type LocalScanImage = {
  view: BaggageView;
  filePath: string;
  mimeType: string;
  bytes: number;
  dataUrl: string | null;
};

export type LocalScanDetail = LocalScanSummary & {
  analysis: unknown;
  images: LocalScanImage[];
};
