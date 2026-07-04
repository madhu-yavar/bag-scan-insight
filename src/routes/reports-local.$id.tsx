import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Camera, Database, Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { VIEWS } from "@/lib/baggage-views";
import { getLocalScan, type LocalScanDetail } from "@/lib/local-scan-store.functions";

export const Route = createFileRoute("/reports-local/$id")({
  head: () => ({
    meta: [
      { title: "Saved report - BagScan" },
      {
        name: "description",
        content: "View a locally saved baggage scan report.",
      },
    ],
  }),
  component: LocalReportDetailPage,
});

type JsonObject = Record<string, unknown>;

function LocalReportDetailPage() {
  const { id } = useParams({ from: "/reports-local/$id" });
  const loadScan = useServerFn(getLocalScan);
  const [scan, setScan] = useState<LocalScanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadScan({ data: { id } })
      .then((result) => {
        if (!active) return;
        setScan(result.scan);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load report.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, loadScan]);

  const exportReport = () => {
    if (!scan) return;
    const payload = {
      ...scan,
      images: scan.images.map((image) => ({
        view: image.view,
        filePath: image.filePath,
        mimeType: image.mimeType,
        bytes: image.bytes,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(scan.reference || scan.id)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <Link
          to="/reports-local"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Saved reports
        </Link>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-destructive/35 bg-destructive/10 p-5 text-sm text-destructive">
            {error}
          </div>
        ) : scan ? (
          <>
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border bg-surface-elevated px-3 py-1 text-xs font-medium text-muted-foreground">
                  <Database className="h-3.5 w-3.5" />
                  {scan.id}
                </div>
                <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
                  {scan.reference || scan.bagType || "Baggage report"}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Saved {new Date(scan.createdAt).toLocaleString()} · {scan.model}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={exportReport}>
                  <Download className="mr-2 h-4 w-4" />
                  Export JSON
                </Button>
                <Button className="bg-gradient-brand text-primary-foreground shadow-brand" asChild>
                  <Link to="/scan-local">
                    <Camera className="mr-2 h-4 w-4" />
                    New scan
                  </Link>
                </Button>
              </div>
            </div>

            <PhotoGrid scan={scan} />
            <ReportSummary scan={scan} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function PhotoGrid({ scan }: { scan: LocalScanDetail }) {
  return (
    <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {VIEWS.map((view) => {
        const image = scan.images.find((item) => item.view === view.key);
        return (
          <div
            key={view.key}
            className="overflow-hidden rounded-2xl border bg-card shadow-elevated"
          >
            <div className="aspect-[4/3] bg-secondary">
              {image?.dataUrl ? (
                <img src={image.dataUrl} alt={view.title} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-xs text-muted-foreground">
                  No image
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 p-3">
              <div className="text-sm font-semibold">{view.title}</div>
              {image ? (
                <div className="text-xs text-muted-foreground">{formatBytes(image.bytes)}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ReportSummary({ scan }: { scan: LocalScanDetail }) {
  const analysis = toObject(scan.analysis);
  const colors = toObject(analysis?.colors);
  const dimensions = scan.manualDimensionsCm
    ? dimensionsToReportObject(scan.manualDimensionsCm)
    : toObject(analysis?.dimensions_cm);
  const wheels = toObject(analysis?.wheels);
  const damage = Array.isArray(analysis?.damage)
    ? analysis.damage.map(toObject).filter((item): item is JsonObject => Boolean(item))
    : [];

  const fields = [
    ["Type", analysis?.bag_type],
    ["Condition", analysis?.overall_condition],
    ["Primary color", colors?.primary],
    ["Material", analysis?.material],
    ["Texture", analysis?.texture],
    ["Wheels", wheels?.count],
    ["Dimensions", formatDimensions(dimensions)],
  ];

  return (
    <section className="mt-8 rounded-3xl border bg-card p-6 shadow-elevated">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Baggage profile</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {String(analysis?.summary || scan.summary || "No summary available.")}
          </p>
        </div>
        {scan.approvedReviewViews.length > 0 ? (
          <div className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent-foreground">
            Approved: {scan.approvedReviewViews.map(titleCase).join(", ")}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-surface-elevated p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{formatValue(value)}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border bg-surface-elevated p-4">
        <h3 className="font-semibold">Damage</h3>
        {damage.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No visible damage recorded.</p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {damage.map((item, index) => (
              <div key={index} className="rounded-xl border bg-card p-3 text-sm">
                <div className="font-semibold">
                  {formatValue(item.type)} · {formatValue(item.location)}
                </div>
                <p className="mt-1 text-muted-foreground">{formatValue(item.description)}</p>
                <div className="mt-2 text-xs font-medium uppercase text-muted-foreground">
                  {formatValue(item.severity)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function toObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function dimensionsToReportObject(
  dimensions: NonNullable<LocalScanDetail["manualDimensionsCm"]>,
): JsonObject {
  return {
    ...dimensions,
    confidence: "high",
    basis: "manual",
  };
}

function formatDimensions(dimensions: JsonObject | null) {
  if (!dimensions) return null;
  const width = dimensions.width;
  const height = dimensions.height;
  const depth = dimensions.depth;
  if (width == null && height == null && depth == null) return dimensions.basis ?? null;
  return `${formatValue(width)} x ${formatValue(height)} x ${formatValue(depth)} cm`;
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "Unknown";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value).replace(/_/g, " ");
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "baggage-report"
  );
}
