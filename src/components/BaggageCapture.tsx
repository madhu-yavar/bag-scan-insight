import { useRef, useState } from "react";
import { Camera, Check, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BaggageView = "front" | "back" | "top" | "side";
export const VIEWS: { key: BaggageView; title: string; hint: string }[] = [
  { key: "front", title: "Front", hint: "Face the bag towards you, full body in frame" },
  { key: "back", title: "Back", hint: "Show straps, back panel and pockets" },
  { key: "top", title: "Top", hint: "Look down at handles and zippers" },
  { key: "side", title: "Side", hint: "Profile view — shows depth and wheels" },
];

type Captured = Partial<Record<BaggageView, string>>;

export function BaggageCapture({
  images,
  onChange,
}: {
  images: Captured;
  onChange: (next: Captured) => void;
}) {
  const [activeView, setActiveView] = useState<BaggageView>("front");
  const fileRefs = useRef<Record<BaggageView, HTMLInputElement | null>>({
    front: null, back: null, top: null, side: null,
  });

  const handleFile = async (view: BaggageView, file: File | null) => {
    if (!file) return;
    const dataUrl = await resizeAndEncode(file);
    onChange({ ...images, [view]: dataUrl });
    const nextEmpty = VIEWS.find((v) => !images[v.key] && v.key !== view);
    if (nextEmpty) setActiveView(nextEmpty.key);
  };

  const clear = (view: BaggageView) => {
    const next = { ...images };
    delete next[view];
    onChange(next);
  };

  const active = VIEWS.find((v) => v.key === activeView)!;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Preview / capture area */}
      <div className="overflow-hidden rounded-3xl border bg-card shadow-elevated">
        <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-secondary to-muted">
          {images[activeView] ? (
            <img src={images[activeView]} alt={`${active.title} view`} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-brand">
                <Camera className="h-7 w-7" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">Capture the {active.title.toLowerCase()} view</p>
                <p className="mt-1 text-sm">{active.hint}</p>
              </div>
            </div>
          )}
          <div className="absolute left-4 top-4 rounded-full bg-background/85 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur">
            {active.title}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-surface-elevated p-4">
          <p className="text-sm text-muted-foreground">{active.hint}</p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={(el) => { fileRefs.current[activeView] = el; }}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(activeView, e.target.files?.[0] ?? null)}
            />
            {images[activeView] && (
              <Button variant="outline" size="sm" onClick={() => clear(activeView)}>
                <RotateCcw className="mr-1.5 h-4 w-4" /> Retake
              </Button>
            )}
            <Button
              size="sm"
              className="bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-95"
              onClick={() => fileRefs.current[activeView]?.click()}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              {images[activeView] ? "Replace photo" : "Take photo"}
            </Button>
          </div>
        </div>
      </div>

      {/* View picker */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        {VIEWS.map((v) => {
          const has = Boolean(images[v.key]);
          const isActive = v.key === activeView;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setActiveView(v.key)}
              className={cn(
                "group relative flex items-center gap-3 rounded-2xl border p-3 text-left transition",
                isActive ? "border-primary bg-primary/5 shadow-brand" : "bg-card hover:border-primary/60",
              )}
            >
              <div className={cn(
                "grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border",
                has ? "bg-background" : "bg-muted",
              )}>
                {has ? (
                  <img src={images[v.key]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Upload className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">{v.title}</span>
                  {has && <Check className="h-4 w-4 text-accent" />}
                </div>
                <p className="truncate text-xs text-muted-foreground">{v.hint}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function resizeAndEncode(file: File, maxDim = 1024, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}
