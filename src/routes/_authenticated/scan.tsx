import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Sparkles, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BaggageCapture, VIEWS, type BaggageView } from "@/components/BaggageCapture";
import { supabase } from "@/integrations/supabase/client";
import { analyzeBaggage } from "@/lib/scans.functions";

export const Route = createFileRoute("/_authenticated/scan")({
  head: () => ({
    meta: [
      { title: "New scan — BagScan" },
      { name: "description", content: "Capture 4 photos of a bag and run AI analysis to extract metadata." },
    ],
  }),
  component: ScanPage,
});

type ImageMap = Partial<Record<BaggageView, string>>;
type Mode = "gemini" | "gemma";
const GEMMA_KEY = "bagscan.gemma_endpoint";

function ScanPage() {
  const router = useRouter();
  const runAnalyze = useServerFn(analyzeBaggage);
  const [images, setImages] = useState<ImageMap>({});
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<Mode>("gemini");
  const [gemmaUrl, setGemmaUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(GEMMA_KEY);
    if (saved) setGemmaUrl(saved);
  }, []);

  const allCaptured = VIEWS.every((v) => images[v.key]);
  const canSubmit = allCaptured && !submitting && (mode === "gemini" || gemmaUrl.trim().length > 0);

  const analyze = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    if (mode === "gemma") window.localStorage.setItem(GEMMA_KEY, gemmaUrl.trim());
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You are signed out");

      const { data: scan, error: scanErr } = await supabase
        .from("scans")
        .insert({
          user_id: uid,
          name: name.trim() || `Scan ${new Date().toLocaleString()}`,
          notes: notes.trim() || null,
          model: mode === "gemini" ? "gemini" : "gemma-local",
          status: "analyzing",
        })
        .select()
        .single();
      if (scanErr || !scan) throw scanErr ?? new Error("Failed to create scan");

      // Upload images to storage in parallel
      const uploads = await Promise.all(
        VIEWS.map(async (v) => {
          const dataUrl = images[v.key]!;
          const blob = await (await fetch(dataUrl)).blob();
          const path = `${uid}/${scan.id}/${v.key}.jpg`;
          const { error: upErr } = await supabase.storage
            .from("baggage-images")
            .upload(path, blob, { contentType: "image/jpeg", upsert: true });
          if (upErr) throw upErr;
          return { view: v.key, path, data_url: dataUrl };
        }),
      );

      await supabase.from("scan_images").insert(
        uploads.map((u) => ({ scan_id: scan.id, user_id: uid, view: u.view, storage_path: u.path })),
      );

      let analysis: unknown;
      try {
        if (mode === "gemini") {
          const res = await runAnalyze({
            data: {
              images: uploads.map((u) => ({ view: u.view, data_url: u.data_url })),
            },
          });
          analysis = res.analysis;
        } else {
          analysis = await callLocalGemma(gemmaUrl.trim(), uploads);
        }
        await supabase.from("scans").update({ status: "completed", analysis: analysis as never }).eq("id", scan.id);
        toast.success("Analysis complete");
        router.navigate({ to: "/scans/$id", params: { id: scan.id } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        await supabase.from("scans").update({ status: "failed", error: msg }).eq("id", scan.id);
        throw err;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold sm:text-4xl">New baggage scan</h1>
        <p className="mt-2 text-muted-foreground">
          Capture all four views. We'll upload the photos, analyze them, and save the report.
        </p>
      </div>

      <BaggageCapture images={images} onChange={setImages} />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="rounded-3xl border bg-card p-6 shadow-elevated">
          <h2 className="text-lg font-semibold">Scan details</h2>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Label (optional)</Label>
              <Input id="name" placeholder="e.g. Away Bigger Carry-On" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" placeholder="Anything worth remembering about this bag" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border bg-card p-6 shadow-elevated">
          <h2 className="text-lg font-semibold">Model</h2>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="mt-4 grid gap-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 hover:border-primary/60">
              <RadioGroupItem value="gemini" id="m-gemini" className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Gemini (cloud)</div>
                <p className="mt-1 text-xs text-muted-foreground">Fast, no setup. Runs on Lovable AI.</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 hover:border-primary/60">
              <RadioGroupItem value="gemma" id="m-gemma" className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold"><Server className="h-4 w-4 text-accent" /> Gemma (local)</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Point at your local multimodal endpoint. Must accept an OpenAI-style <code>chat/completions</code> body.
                </p>
                {mode === "gemma" && (
                  <Input
                    className="mt-2"
                    placeholder="http://localhost:11434/v1/chat/completions"
                    value={gemmaUrl}
                    onChange={(e) => setGemmaUrl(e.target.value)}
                  />
                )}
              </div>
            </label>
          </RadioGroup>

          <Button
            className="mt-6 w-full bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-95"
            disabled={!canSubmit}
            onClick={analyze}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {submitting ? "Analyzing…" : allCaptured ? "Analyze baggage" : `Capture all 4 views (${Object.keys(images).length}/4)`}
          </Button>
        </div>
      </div>
    </main>
  );
}

async function callLocalGemma(
  endpoint: string,
  uploads: { view: BaggageView; data_url: string }[],
): Promise<unknown> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: SYSTEM_PROMPT },
  ];
  for (const u of uploads) {
    content.push({ type: "text", text: `View: ${u.view}` });
    content.push({ type: "image_url", image_url: { url: u.data_url } });
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma3",
      messages: [{ role: "user", content }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Local Gemma endpoint returned ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Local Gemma did not return JSON");
  }
}

const SYSTEM_PROMPT = `You are an expert baggage inspector. Analyze the 4 photos and return STRICT JSON only with keys: summary, bag_type, size_class, dimensions_cm{width,height,depth,confidence}, colors{primary,secondary}, material, texture, wheels{count,type}, handles[], features[], brand_guess, damage[{location,type,severity,description}], overall_condition, notes. Use null/[] when unknown. No markdown, no code fences.`;
