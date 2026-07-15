import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, Camera, Database, Loader2, PackageSearch, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { requireSignedIn } from "@/lib/auth-helpers";
import { getCloudAnalytics, type CloudAnalytics } from "@/lib/cloud-scan-store.functions";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  head: () => ({
    meta: [
      { title: "Analytics dashboard - BagScan" },
      {
        name: "description",
        content: "Analyze BagScan baggage dimensions, quality, types, materials, and damage.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const loadAnalytics = useServerFn(getCloudAnalytics);
  const [analytics, setAnalytics] = useState<CloudAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadAnalytics()
      .then((result) => {
        if (!active) return;
        setAnalytics(result.analytics);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load dashboard analytics.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadAnalytics]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border bg-surface-elevated px-3 py-1 text-xs font-medium text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Cloud analytics
            </div>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Analytics dashboard</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Track baggage type, dimensions, condition, damage, capture quality, and identity
              confidence from saved cloud scans.
            </p>
          </div>
          <Button className="bg-gradient-brand text-primary-foreground shadow-brand" asChild>
            <Link to="/scan-local">
              <Camera className="mr-2 h-4 w-4" />
              New scan
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-destructive/35 bg-destructive/10 p-5 text-sm text-destructive">
            {error}
          </div>
        ) : analytics ? (
          <DashboardContent analytics={analytics} />
        ) : null}
      </main>
    </div>
  );
}

function DashboardContent({ analytics }: { analytics: CloudAnalytics }) {
  const hasScans = analytics.totals.scans > 0;
  return (
    <>
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total scans" value={analytics.totals.scans} />
        <MetricCard label="Needs review" value={analytics.totals.needsReview} />
        <MetricCard label="Damage findings" value={analytics.totals.damages} />
        <MetricCard label="Avg volume" value={formatVolume(analytics.totals.avgVolumeLiters)} />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <DistributionPanel
          title="Baggage types"
          items={analytics.bagTypes}
          emptyLabel="No types yet"
        />
        <DistributionPanel
          title="Size classes"
          items={analytics.sizeClasses}
          emptyLabel="No size classes yet"
        />
        <DistributionPanel
          title="Materials"
          items={analytics.materials}
          emptyLabel="No materials yet"
        />
        <DistributionPanel
          title="Condition"
          items={analytics.conditions}
          emptyLabel="No condition data yet"
        />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border bg-card p-5 shadow-elevated">
          <h2 className="font-semibold">Capture quality by view</h2>
          <div className="mt-4 grid gap-3">
            {analytics.viewQuality.map((view) => (
              <div key={view.view} className="rounded-xl border bg-surface-elevated p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium capitalize">{view.view}</div>
                  <div className="text-xs text-muted-foreground">{view.imageCount} photos</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((view.avgQualityScore ?? 0) * 100)}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>Quality {formatPercent(view.avgQualityScore)}</span>
                  <span>{view.rejectedCount} rejected</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-elevated">
          <h2 className="font-semibold">Recent cloud scans</h2>
          {hasScans ? (
            <div className="mt-4 grid gap-3">
              {analytics.recentScans.map((scan) => (
                <Link
                  key={scan.id}
                  to="/reports-local/$id"
                  params={{ id: scan.id }}
                  className="rounded-xl border bg-surface-elevated p-4 transition hover:border-primary/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {scan.reference || scan.bagType || "Baggage scan"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDate(scan.createdAt)}
                      </div>
                    </div>
                    {scan.captureValidationStatus === "needs_review" ? (
                      <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <PackageSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed p-6 text-center">
              <Database className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Complete a cloud-backed scan to populate dashboard analytics.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
    </div>
  );
}

function DistributionPanel({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
  emptyLabel: string;
}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <h2 className="font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="capitalize">{item.label.replace(/_/g, " ")}</span>
                <span className="font-medium">{item.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(8, Math.round((item.count / max) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPercent(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`;
}

function formatVolume(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value)} L`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
