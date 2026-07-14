import { forwardRef, useCallback, useId, useImperativeHandle, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, Loader2, Lock, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VIEWS, type BaggageView } from "@/lib/baggage-views";
import { cn } from "@/lib/utils";

type Captured = Partial<Record<BaggageView, string>>;
export type ViewStatus = "ok" | "review" | "issue";

export type BaggageCaptureHandle = {
  openPicker: (view: BaggageView) => void;
  retakeView: (view: BaggageView) => void;
  clearView: (view: BaggageView) => void;
};

type BaggageCaptureProps = {
  images: Captured;
  onChange: (next: Captured) => void;
  onValidateImage?: (view: BaggageView, dataUrl: string) => Promise<boolean>;
  activeView?: BaggageView;
  onActiveViewChange?: (view: BaggageView) => void;
  viewStatuses?: Partial<Record<BaggageView, ViewStatus>>;
};

export const BaggageCapture = forwardRef<BaggageCaptureHandle, BaggageCaptureProps>(
  function BaggageCapture(
    { images, onChange, onValidateImage, activeView, onActiveViewChange, viewStatuses = {} },
    ref,
  ) {
    const [internalActiveView, setInternalActiveView] = useState<BaggageView>("front");
    const [processingView, setProcessingView] = useState<BaggageView | null>(null);
    const selectedView = activeView ?? internalActiveView;
    const firstMissingView = VIEWS.find((view) => !images[view.key])?.key ?? null;
    const isBusy = processingView !== null;
    const inputIdPrefix = useId();
    const fileRefs = useRef<Record<BaggageView, HTMLInputElement | null>>({
      front: null,
      back: null,
      top: null,
      side: null,
    });

    const setActiveView = useCallback(
      (view: BaggageView) => {
        if (!images[view] && firstMissingView && view !== firstMissingView) return;
        if (onActiveViewChange) onActiveViewChange(view);
        else setInternalActiveView(view);
      },
      [firstMissingView, images, onActiveViewChange],
    );

    const resetInput = useCallback((view: BaggageView) => {
      const input = fileRefs.current[view];
      if (input) input.value = "";
    }, []);

    const openPicker = useCallback(
      (view: BaggageView) => {
        if (isBusy || (!images[view] && firstMissingView && view !== firstMissingView)) return;
        resetInput(view);
        fileRefs.current[view]?.click();
      },
      [firstMissingView, images, isBusy, resetInput],
    );

    const handleFile = useCallback(
      async (view: BaggageView, file: File | null) => {
        if (!file || isBusy) return;
        if (!images[view] && firstMissingView && view !== firstMissingView) return;

        setProcessingView(view);
        try {
          const dataUrl = await resizeAndEncode(file);
          const accepted = onValidateImage ? await onValidateImage(view, dataUrl) : true;
          if (!accepted) return;

          const nextImages = { ...images, [view]: dataUrl };
          onChange(nextImages);
          const nextEmpty = VIEWS.find((v) => !nextImages[v.key]);
          if (nextEmpty) setActiveView(nextEmpty.key);
        } finally {
          setProcessingView(null);
        }
      },
      [firstMissingView, images, isBusy, onChange, onValidateImage, setActiveView],
    );

    const clear = useCallback(
      (view: BaggageView) => {
        if (isBusy) return;
        resetInput(view);
        const next = { ...images };
        delete next[view];
        onChange(next);
      },
      [images, isBusy, onChange, resetInput],
    );

    const prepareRetake = useCallback(
      (view: BaggageView) => {
        if (isBusy) return;
        setActiveView(view);
        resetInput(view);
        const next = { ...images };
        delete next[view];
        onChange(next);
      },
      [images, isBusy, onChange, resetInput, setActiveView],
    );

    const retake = useCallback(
      (view: BaggageView) => {
        if (isBusy) return;
        prepareRetake(view);
        fileRefs.current[view]?.click();
      },
      [isBusy, prepareRetake],
    );

    useImperativeHandle(
      ref,
      () => ({
        openPicker,
        retakeView: retake,
        clearView: clear,
      }),
      [clear, openPicker, retake],
    );

    const active = VIEWS.find((v) => v.key === selectedView)!;
    const activeStatus = viewStatuses[selectedView];
    const activeIsProcessing = processingView === selectedView;
    const activeIsLocked =
      !images[selectedView] && firstMissingView !== null && selectedView !== firstMissingView;

    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="sr-only">
          {VIEWS.map((view) => (
            <input
              key={view.key}
              id={`${inputIdPrefix}-${view.key}`}
              ref={(el) => {
                fileRefs.current[view.key] = el;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              disabled={isBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                void handleFile(view.key, file);
              }}
            />
          ))}
        </div>

        {/* Preview / capture area */}
        <div className="overflow-hidden rounded-3xl border bg-card shadow-elevated">
          <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-secondary to-muted">
            {images[selectedView] ? (
              <img
                src={images[selectedView]}
                alt={`${active.title} view`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-brand">
                  <Camera className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    Capture the {active.title.toLowerCase()} view
                  </p>
                  <p className="mt-1 text-sm">{active.hint}</p>
                </div>
              </div>
            )}
            <div className="absolute left-4 top-4 rounded-full bg-background/85 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur">
              {active.title}
            </div>
            {activeStatus === "issue" || activeStatus === "review" ? (
              <div
                className={`absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur ${
                  activeStatus === "issue"
                    ? "bg-destructive/90 text-destructive-foreground"
                    : "bg-warning/90 text-warning-foreground"
                }`}
              >
                {activeStatus === "issue" ? "Retake" : "Review"}
              </div>
            ) : null}
            {activeIsProcessing ? (
              <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-semibold shadow-elevated">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Checking {active.title.toLowerCase()} photo
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-surface-elevated p-4">
            <p className="text-sm text-muted-foreground">
              {activeIsLocked
                ? `Capture ${titleForView(firstMissingView)} before ${active.title}.`
                : active.hint}
            </p>
            <div className="flex flex-wrap gap-2">
              {images[selectedView] && (
                <Button variant="outline" size="sm" disabled={isBusy} asChild>
                  <label
                    htmlFor={`${inputIdPrefix}-${selectedView}`}
                    onClick={(event) => {
                      if (isBusy) {
                        event.preventDefault();
                        return;
                      }
                      prepareRetake(selectedView);
                    }}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" /> Retake
                  </label>
                </Button>
              )}
              <Button
                size="sm"
                className="bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-95"
                disabled={isBusy || activeIsLocked}
                asChild
              >
                <label
                  htmlFor={`${inputIdPrefix}-${selectedView}`}
                  onClick={(event) => {
                    if (isBusy || activeIsLocked) {
                      event.preventDefault();
                      return;
                    }
                    resetInput(selectedView);
                  }}
                >
                  {activeIsProcessing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : activeIsLocked ? (
                    <Lock className="mr-1.5 h-4 w-4" />
                  ) : (
                    <Camera className="mr-1.5 h-4 w-4" />
                  )}
                  {activeIsProcessing
                    ? "Checking..."
                    : activeIsLocked
                      ? "Locked"
                      : images[selectedView]
                        ? "Replace photo"
                        : "Take photo"}
                </label>
              </Button>
            </div>
          </div>
        </div>

        {/* View picker */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {VIEWS.map((v) => {
            const has = Boolean(images[v.key]);
            const isActive = v.key === selectedView;
            const isLocked = !has && firstMissingView !== null && v.key !== firstMissingView;
            const isProcessing = processingView === v.key;
            const status = viewStatuses[v.key];
            const statusClass =
              status === "issue"
                ? "border-destructive bg-destructive/5"
                : status === "review"
                  ? "border-warning bg-warning/5"
                  : isActive
                    ? "border-primary bg-primary/5 shadow-brand"
                    : "bg-card hover:border-primary/60";
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setActiveView(v.key)}
                disabled={isBusy || isLocked}
                className={cn(
                  "group relative flex items-center gap-3 rounded-2xl border p-3 text-left transition",
                  (isBusy || isLocked) && "cursor-not-allowed opacity-60",
                  statusClass,
                )}
              >
                <div
                  className={cn(
                    "grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border",
                    has ? "bg-background" : "bg-muted",
                  )}
                >
                  {has ? (
                    <img src={images[v.key]} alt="" className="h-full w-full object-cover" />
                  ) : isProcessing ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : isLocked ? (
                    <Lock className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{v.title}</span>
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : status === "issue" || status === "review" ? (
                      <AlertTriangle
                        className={`h-4 w-4 ${status === "issue" ? "text-destructive" : "text-warning"}`}
                      />
                    ) : (
                      has && <Check className="h-4 w-4 text-accent" />
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {isProcessing
                      ? "Checking photo"
                      : isLocked
                        ? `Complete ${titleForView(firstMissingView)} first`
                        : status === "issue"
                          ? "Needs retake"
                          : status === "review"
                            ? "Review photo"
                            : v.hint}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  },
);

async function resizeAndEncode(file: File, maxDim = 1024, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function titleForView(view: BaggageView | null) {
  return VIEWS.find((item) => item.key === view)?.title ?? "the current view";
}
