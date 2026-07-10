import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type {
  LocalScanDetail,
  LocalScanImage,
  LocalScanSummary,
  ManualDimensionsCm,
  SaveLocalScanData,
} from "./local-scan-store.types";

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

const SaveScanInput = z.object({
  reference: z.string().optional(),
  notes: z.string().optional(),
  model: z.string().min(1),
  manual_dimensions_cm: ManualDimensionsSchema.nullish(),
  approved_review_views: z.array(ViewSchema).default([]),
  images: z.array(ImageInput).length(4),
  analysis: z.unknown(),
});

const ListScansInput = z
  .object({
    limit: z.number().int().min(1).max(200).default(50),
  })
  .default({ limit: 50 });

const GetScanInput = z.object({
  id: z.string().min(1),
});

const UpdateApprovalsInput = z.object({
  id: z.string().min(1),
  approved_review_views: z.array(ViewSchema).default([]),
});

export const saveLocalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SaveScanInput.parse(input))
  .handler(async ({ context, data }) => {
    const { saveScan } = await import("./local-scan-store.server");
    return { scan: saveScan(context.userId, data) };
  });

export const listLocalScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ListScansInput.parse(input))
  .handler(async ({ context, data }) => {
    const { listScans } = await import("./local-scan-store.server");
    return { scans: listScans(context.userId, data.limit) };
  });

export const getLocalScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => GetScanInput.parse(input))
  .handler(async ({ context, data }) => {
    const { getScan } = await import("./local-scan-store.server");
    return { scan: getScan(context.userId, data.id) };
  });

export const updateLocalScanApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateApprovalsInput.parse(input))
  .handler(async ({ context, data }) => {
    const { getScan, updateApprovals } = await import("./local-scan-store.server");
    updateApprovals(context.userId, data.id, data.approved_review_views);
    return { scan: getScan(context.userId, data.id) };
  });
