import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VIEWS } from "@/components/BaggageCapture";

export const Route = createFileRoute("/_authenticated/scans/$id")({
  head: () => ({
    meta: [
      { title: "Scan report — BagScan" },
      { name: "description", content: "AI-generated metadata for this baggage scan." },
    ],
  }),
  component: ScanDetail,
});

function ScanDetail() {
  const { id } = useParams({ from: "/_authenticated/scans/$id" });

  const { data, isLoading } = useQuery({
    queryKey: ["scan", id],
    queryFn: async () => {
      const [{ data: scan, error }, { data: imgs, error: iErr }] = await Promise.all([
        supabase.from("scans").select("*").eq("id", id).single(),
        supabase.from("scan_images").select("view, storage_path").eq("scan_id", id),
      ]);
      if (error) throw error;
      if (iErr) throw iErr;
      const signed = await Promise.all(
        (imgs ?? []).map(async (i) => {
          const { data: s } = await supabase.storage.from("baggage-images").createSignedUrl(i.storage_path, 3600);
          return { view: i.view as string, url: s?.signedUrl ?? "" };
        }),
      );
      return { scan, images: signed };
    },
  });

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!data?.scan) return <div className="mx-auto max-w-3xl px-6 py-16 text-center text-muted-foreground">Scan not found.</div>;

  const { scan, images } = data;
  const a = (scan.analysis as Record<string, unknown> | null) ?? null;
  const imgByView: Record<string, string> = {};
  images.forEach((i) => { imgByView[i.view] = i.url; });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/history" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to history
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold sm:text-4xl">{scan.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(scan.created_at).toLocaleString()} · model: {scan.model} · status: {scan.status}
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VIEWS.map((v) => (
          <div key={v.key} className="overflow-hidden rounded-2xl border bg-card shadow-elevated">
            <div className="aspect-[4/3] bg-secondary">
              {imgByView[v.key] ? (
                <img src={imgByView[v.key]} alt={v.title} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-xs text-muted-foreground">no image</div>
              )}
            </div>
            <div className="p-3 text-sm font-semibold">{v.title}</div>
          </div>
        ))}
      </div>

      {scan.status === "failed" && (
        <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
          <h2 className="font-semibold text-destructive">Analysis failed</h2>
          <p className="mt-1 text-sm">{scan.error ?? "Unknown error"}</p>
        </div>
      )}

      {a && <AnalysisReport analysis={a} />}

      {scan.notes && (
        <section className="mt-8 rounded-2xl border bg-card p-6 shadow-elevated">
          <h2 className="text-lg font-semibold">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{scan.notes}</p>
        </section>
      )}
    </main>
  );
}

function AnalysisReport({ analysis }: { analysis: Record<string, unknown> }) {
  const dims = (analysis.dimensions_cm ?? {}) as Record<string, unknown>;
  const colors = (analysis.colors ?? {}) as Record<string, unknown>;
  const wheels = (analysis.wheels ?? {}) as Record<string, unknown>;
  const damage = (analysis.damage as Array<Record<string, unknown>> | undefined) ?? [];
  const features = (analysis.features as string[] | undefined) ?? [];
  const handles = (analysis.handles as string[] | undefined) ?? [];

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-3">
      <section className="rounded-2xl border bg-card p-6 shadow-elevated lg:col-span-2">
        <h2 className="text-lg font-semibold">Summary</h2>
        <p className="mt-2 text-sm text-muted-foreground">{String(analysis.summary ?? "—")}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Type" value={String(analysis.bag_type ?? "—")} />
          <Field label="Size class" value={String(analysis.size_class ?? "—")} />
          <Field label="Material" value={String(analysis.material ?? "—")} />
          <Field label="Texture" value={String(analysis.texture ?? "—")} />
          <Field label="Overall condition" value={String(analysis.overall_condition ?? "—")} />
          <Field label="Brand guess" value={String(analysis.brand_guess ?? "—")} />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-elevated">
        <h2 className="text-lg font-semibold">Dimensions</h2>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          {(["width", "height", "depth"] as const).map((k) => (
            <div key={k} className="rounded-xl bg-secondary p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="mt-1 text-xl font-bold">{dims[k] != null ? `${dims[k]}` : "—"}</div>
              <div className="text-xs text-muted-foreground">cm</div>
            </div>
          ))}
        </div>
        {dims.confidence && (
          <p className="mt-3 text-xs text-muted-foreground">Confidence: {String(dims.confidence)}</p>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-elevated">
        <h2 className="text-lg font-semibold">Colors</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div><span className="text-muted-foreground">Primary: </span>{String(colors.primary ?? "—")}</div>
          <div><span className="text-muted-foreground">Secondary: </span>{String(colors.secondary ?? "—")}</div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-elevated">
        <h2 className="text-lg font-semibold">Wheels & handles</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div><span className="text-muted-foreground">Wheel count: </span>{wheels.count != null ? String(wheels.count) : "—"}</div>
          <div><span className="text-muted-foreground">Wheel type: </span>{String(wheels.type ?? "—")}</div>
          <div><span className="text-muted-foreground">Handles: </span>{handles.length ? handles.join(", ") : "—"}</div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-elevated">
        <h2 className="text-lg font-semibold">Features</h2>
        {features.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None detected.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {features.map((f) => (
              <span key={f} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{f}</span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-elevated lg:col-span-3">
        <h2 className="text-lg font-semibold">Damage report</h2>
        {damage.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No visible damage detected. 🎉</p>
        ) : (
          <ul className="mt-4 divide-y">
            {damage.map((d, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold">{String(d.type ?? "damage")} · {String(d.location ?? "—")}</div>
                  <p className="text-muted-foreground">{String(d.description ?? "")}</p>
                </div>
                <SeverityBadge severity={String(d.severity ?? "minor")} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    minor: "bg-accent/15 text-accent-foreground",
    moderate: "bg-warning/15 text-warning-foreground",
    severe: "bg-destructive/15 text-destructive",
  };
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${map[severity] ?? "bg-muted text-muted-foreground"}`}>{severity}</span>;
}
