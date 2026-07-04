import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Ruler, Palette, ShieldAlert, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-hero opacity-95" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-primary-glow/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-[420px] w-[420px] rounded-full bg-accent/30 blur-3xl" />

        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 py-24 text-center text-primary-foreground sm:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-medium backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> Powered by multimodal AI
          </span>
          <h1 className="mt-6 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
            Scan any baggage from every angle.
            <span className="block bg-gradient-to-r from-white to-accent bg-clip-text text-transparent">
              Get its full profile in seconds.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-white/85 sm:text-lg">
            Capture front, back, top and side photos with your phone camera. Our AI reports the
            dimensions, color, texture, wheel count and any visible damage — automatically.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/scan-local"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-primary shadow-brand transition hover:bg-white/95"
            >
              <Camera className="h-4 w-4" /> Start a scan
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">
          Everything about a bag, in one scan
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
          Four photos are all it takes. The model returns structured metadata you can save, share,
          or feed into downstream systems.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Ruler,
              title: "Dimensions",
              body: "Estimated width, height and depth in cm with a size class.",
              color: "text-primary",
            },
            {
              icon: Palette,
              title: "Color & texture",
              body: "Primary/secondary colors and surface material.",
              color: "text-accent",
            },
            {
              icon: ShieldAlert,
              title: "Damage report",
              body: "Scuffs, dents, torn seams and severity.",
              color: "text-warning",
            },
            {
              icon: Sparkles,
              title: "Features",
              body: "Wheels, handles, locks, expansion zippers.",
              color: "text-brand-purple",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border bg-card p-6 shadow-elevated">
              <f.icon className={`h-8 w-8 ${f.color}`} />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t bg-surface-elevated">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Four photos. One report.</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {[
              { n: "01", t: "Front", d: "Face the camera. Full bag in frame." },
              { n: "02", t: "Back", d: "Flip it — capture straps and pockets." },
              { n: "03", t: "Top", d: "Look down. Grab handles + zippers." },
              { n: "04", t: "Side", d: "Profile view. Shows depth + wheels." },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border bg-card p-6">
                <div className="font-display text-4xl font-black text-primary">{s.n}</div>
                <div className="mt-2 text-lg font-semibold">{s.t}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              to="/scan-local"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-6 py-3 text-sm font-semibold text-primary-foreground shadow-brand transition hover:opacity-95"
            >
              <Camera className="h-4 w-4" /> Start scanning
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">BagScan</footer>
    </div>
  );
}
