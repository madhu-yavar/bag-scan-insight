import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type {
  CloudAnalytics,
  CloudDamageFinding,
  CloudScanDetail,
  CloudScanImage,
  CloudScanSummary,
  CloudValidationEvent,
  SaveCloudScanData,
} from "./cloud-scan-store.types";

const ViewSchema = z.enum(["front", "back", "top", "side"]);
const ManualDimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
});

const TravelContextSchema = z.object({
  pnr: z.string().optional().nullable(),
  airline: z.string().optional().nullable(),
  flight_number: z.string().optional().nullable(),
  flight_date: z.string().optional().nullable(),
  departure_airport: z.string().optional().nullable(),
  arrival_airport: z.string().optional().nullable(),
  terminal: z.string().optional().nullable(),
  bag_tag: z.string().optional().nullable(),
  baggage_category: z.string().optional().nullable(),
  baggage_category_source: z.enum(["manual", "system", "operator_override"]).optional().nullable(),
  weight_kg: z.number().positive().optional().nullable(),
  special_handling: z.string().optional().nullable(),
});

const ImageInput = z.object({
  view: ViewSchema,
  data_url: z.string().startsWith("data:image/"),
});

const SaveCloudScanInput = z.object({
  reference: z.string().optional(),
  notes: z.string().optional(),
  model: z.string().min(1),
  travel_context: TravelContextSchema.optional().nullable(),
  manual_dimensions_cm: ManualDimensionsSchema.nullish(),
  approved_review_views: z.array(ViewSchema).default([]),
  images: z.array(ImageInput).length(4),
  analysis: z.unknown(),
});

const ListCloudScansInput = z
  .object({
    limit: z.number().int().min(1).max(500).default(100),
  })
  .default({ limit: 100 });

const GetCloudScanInput = z.object({
  id: z.string().min(1),
});

const UpdateCloudApprovalsInput = z.object({
  id: z.string().min(1),
  approved_review_views: z.array(ViewSchema).default([]),
});

export const saveCloudScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SaveCloudScanInput.parse(input))
  .handler(async ({ context, data }) => {
    const { saveCloudScan: save } = await import("./cloud-scan-store.server");
    return { scan: await save(context.supabase, context.userId, data) };
  });

export const listCloudScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListCloudScansInput.parse(input))
  .handler(async ({ context, data }) => {
    const { listCloudScans: list } = await import("./cloud-scan-store.server");
    return { scans: await list(context.supabase, context.userId, data.limit) };
  });

export const getCloudScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GetCloudScanInput.parse(input))
  .handler(async ({ context, data }) => {
    const { getCloudScan: get } = await import("./cloud-scan-store.server");
    return { scan: await get(context.supabase, context.userId, data.id) };
  });

export const getCloudAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getCloudAnalytics: getAnalytics } = await import("./cloud-scan-store.server");
    try {
      return { analytics: await getAnalytics(context.supabase, context.userId) };
    } catch (error) {
      console.error("[BagScan] Dashboard analytics load failed", {
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

export const updateCloudScanApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateCloudApprovalsInput.parse(input))
  .handler(async ({ context, data }) => {
    const { updateCloudApprovals } = await import("./cloud-scan-store.server");
    return {
      scan: await updateCloudApprovals(
        context.supabase,
        context.userId,
        data.id,
        data.approved_review_views,
      ),
    };
  });
