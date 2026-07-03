import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Scan history — BagScan" },
      { name: "description", content: "Browse your past baggage scans and open their AI reports." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { data: scans, isLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scans")
        .select("id, name, status, model, created_at, analysis")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">Your scans</h1>
          <p className="mt-2 text-muted-foreground">Every baggage report you've generated.</p>
        </div>
        <Link
          to="/scan"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-brand hover:opacity-95"
        >
          <Camera className="h-4 w-4" /> New scan
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !scans || scans.length === 0 ? (
        <div className="mt-16 rounded-3xl border border-dashed p-12 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-brand">
            <Camera className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">No scans yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Capture four photos and get an AI report.</p>
          <Link to="/scan" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Start your first scan
          </Link>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scans.map((s) => {
            const a = (s.analysis as Record<string, unknown> | null) ?? null;
            const summary = a && typeof a.summary === "string" ? a.summary : null;
            return (
              <li key={s.id}>
                <Link
                  to="/scans/$id"
                  params={{ id: s.id }}
                  className="group flex h-full flex-col rounded-2xl border bg-card p-5 shadow-elevated transition hover:border-primary/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={s.status} />
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</span>
                  </div>
                  <h3 className="mt-3 line-clamp-1 text-lg font-semibold">{s.name}</h3>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                    {summary ?? (s.status === "failed" ? "Analysis failed." : "No summary available.")}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-xs">
                    <span className="rounded-full bg-secondary px-2 py-1 font-medium text-secondary-foreground">{s.model}</span>
                    <span className="text-primary opacity-0 transition group-hover:opacity-100">Open →</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent-foreground"><CheckCircle2 className="h-3 w-3 text-accent" /> Complete</span>;
  if (status === "failed")
    return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"><XCircle className="h-3 w-3" /> Failed</span>;
  if (status === "analyzing")
    return <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"><Loader2 className="h-3 w-3 animate-spin" /> Analyzing</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><Clock className="h-3 w-3" /> {status}</span>;
}
