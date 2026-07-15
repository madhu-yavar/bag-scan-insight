import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Camera, CheckCircle2, Database, Loader2, Search, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireSignedIn } from "@/lib/auth-helpers";
import { listCloudScans, type CloudScanSummary } from "@/lib/cloud-scan-store.functions";
import { listLocalScans, type LocalScanSummary } from "@/lib/local-scan-store.functions";

export const Route = createFileRoute("/reports-local")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  head: () => ({
    meta: [
      { title: "Saved reports - BagScan" },
      {
        name: "description",
        content: "Browse locally saved baggage scans and reports.",
      },
    ],
  }),
  component: LocalReportsPage,
});

function LocalReportsPage() {
  const loadCloudScans = useServerFn(listCloudScans);
  const loadLocalScans = useServerFn(listLocalScans);
  const [scans, setScans] = useState<Array<CloudScanSummary | LocalScanSummary>>([]);
  const [source, setSource] = useState<"cloud" | "local">("cloud");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function loadReports() {
      try {
        const cloud = await loadCloudScans({ data: { limit: 100 } });
        let localScans: LocalScanSummary[] = [];
        try {
          const local = await loadLocalScans({ data: { limit: 100 } });
          localScans = local.scans;
        } catch {
          localScans = [];
        }
        const cloudIds = new Set(cloud.scans.map((scan) => scan.id));
        const merged = [
          ...cloud.scans,
          ...localScans.filter((scan) => !cloudIds.has(scan.id)),
        ].slice(0, 100);
        if (!active) return;
        setScans(merged);
        setSource(cloud.scans.length > 0 ? "cloud" : "local");
      } catch {
        const local = await loadLocalScans({ data: { limit: 100 } });
        if (!active) return;
        setScans(local.scans);
        setSource("local");
      }
    }

    loadReports()
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load saved reports.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadCloudScans, loadLocalScans]);

  const filteredScans = scans.filter((scan) => {
    const text = [
      scan.reference,
      scan.summary,
      scan.bagType,
      scan.overallCondition,
      scan.captureValidationStatus,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">Saved reports</h1>
            <p className="mt-2 text-muted-foreground">
              {source === "cloud"
                ? "Cloud scan reports saved in Supabase."
                : "Local scan reports saved on this machine."}
            </p>
          </div>
          <Button className="bg-gradient-brand text-primary-foreground shadow-brand" asChild>
            <Link to="/scan-local">
              <Camera className="mr-2 h-4 w-4" />
              New scan
            </Link>
          </Button>
        </div>

        <div className="mt-8 flex max-w-md items-center gap-2 rounded-xl border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            placeholder="Search reports"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-destructive/35 bg-destructive/10 p-5 text-sm text-destructive">
            {error}
          </div>
        ) : filteredScans.length === 0 ? (
          <div className="mt-12 rounded-3xl border border-dashed p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-brand">
              <Database className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">No saved reports</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete a scan and it will appear here.
            </p>
            <Button className="mt-6" asChild>
              <Link to="/scan-local">Start scan</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredScans.map((scan) => (
              <Link
                key={scan.id}
                to="/reports-local/$id"
                params={{ id: scan.id }}
                className="group flex min-h-[220px] flex-col rounded-2xl border bg-card p-5 shadow-elevated transition hover:border-primary/70"
              >
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={scan.captureValidationStatus} />
                  <span className="text-xs text-muted-foreground">
                    {formatDate(scan.createdAt)}
                  </span>
                </div>
                <h2 className="mt-4 line-clamp-1 text-lg font-semibold">
                  {scan.reference || scan.bagType || "Baggage scan"}
                </h2>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                  {scan.summary || "Saved baggage scan report."}
                </p>
                <div className="mt-auto flex items-center justify-between pt-5 text-xs">
                  <span className="rounded-full bg-secondary px-2 py-1 font-medium text-secondary-foreground">
                    {scan.imageCount}/4 photos
                  </span>
                  <span className="font-medium text-primary opacity-0 transition group-hover:opacity-100">
                    Open
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-foreground">
        <CheckCircle2 className="h-3 w-3 text-accent" />
        Ready
      </span>
    );
  }
  if (status === "needs_review") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
        <TriangleAlert className="h-3 w-3" />
        Review
      </span>
    );
  }
  if (status === "needs_retake") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <TriangleAlert className="h-3 w-3" />
        Retake
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Saved
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
