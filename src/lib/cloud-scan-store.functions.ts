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

const ImageInput = z.object({
  view: ViewSchema,
  data_url: z.string().startsWith("data:image/"),
});

const SaveCloudScanInput = z.object({
  reference: z.string().optional(),
  notes: z.string().optional(),
  model: z.string().min(1),
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

export const getCloudAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getCloudAnalytics: getAnalytics } = await import("./cloud-scan-store.server");
    return { analytics: await getAnalytics(context.supabase, context.userId) };
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
