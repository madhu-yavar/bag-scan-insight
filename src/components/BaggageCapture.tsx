import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Camera, Loader2, Lock, RotateCcw } from "lucide-react";
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
  asideActions?: ReactNode;
};

export const BaggageCapture = forwardRef<BaggageCaptureHandle, BaggageCaptureProps>(
  function BaggageCapture(
    {
      images,
      onChange,
      onValidateImage,
      activeView,
      onActiveViewChange,
      viewStatuses = {},
      asideActions,
    },
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

    const moveToView = useCallback(
      (view: BaggageView) => {
        if (onActiveViewChange) onActiveViewChange(view);
        else setInternalActiveView(view);
      },
      [onActiveViewChange],
    );

    const setActiveView = useCallback(
      (view: BaggageView) => {
        if (!images[view] && firstMissingView && view !== firstMissingView) return;
        moveToView(view);
      },
      [firstMissingView, images, moveToView],
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
          if (nextEmpty) moveToView(nextEmpty.key);
        } finally {
          setProcessingView(null);
        }
      },
      [firstMissingView, images, isBusy, moveToView, onChange, onValidateImage],
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
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
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

        <aside className="rounded-[14px] border bg-card p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Scan sequence
          </h2>
          <div className="mt-4 flex flex-col gap-2">
            {VIEWS.map((v, index) => {
              const has = Boolean(images[v.key]);
              const isActive = v.key === selectedView;
              const isLocked = !has && firstMissingView !== null && v.key !== firstMissingView;
              const isProcessing = processingView === v.key;
              const status = viewStatuses[v.key];
              const statusLabel = isProcessing
                ? "checking"
                : status === "issue"
                  ? "retake"
                  : status === "review"
                    ? "review"
                    : has
                      ? "done"
                      : isActive
                        ? "live"
                        : "standby";
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setActiveView(v.key)}
                  disabled={isBusy || isLocked}
                  className={cn(
                    "grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[10px] border px-3 py-3 text-left transition",
                    isActive
                      ? "border-primary bg-surface-2 text-foreground"
                      : "border-transparent bg-surface-2/55 text-muted-foreground hover:border-primary/45 hover:text-foreground",
                    status === "issue" && "border-destructive/70 bg-destructive/10 text-foreground",
                    status === "review" && "border-warning/70 bg-warning/10 text-foreground",
                    (isBusy || isLocked) && "cursor-not-allowed opacity-45",
                  )}
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate text-sm font-semibold">{v.title} view</span>
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground",
                      isActive && "text-primary",
                      status === "issue" && "text-destructive",
                      status === "review" && "text-warning",
                      has && status !== "issue" && status !== "review" && "text-success",
                    )}
                  >
                    {statusLabel}
                  </span>
                </button>
              );
            })}
          </div>
          {asideActions ? <div className="mt-4 flex flex-col gap-2">{asideActions}</div> : null}
        </aside>

        <section className="relative overflow-hidden rounded-[14px] border bg-card">
          <div className="relative flex min-h-[360px] aspect-[4/3] w-full flex-col items-center justify-center p-8 text-center xl:min-h-[456px]">
            <div className="absolute left-4 top-4 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
              {active.title} view
            </div>
            <div className="absolute right-4 top-4 flex items-center gap-2 font-mono text-[11px] text-warning">
              <span className="h-2 w-2 rounded-full bg-warning shadow-[0_0_12px_var(--color-warning)]" />
              REC · {activeIsProcessing ? "checking" : "00:00"}
            </div>

            <div className="pointer-events-none absolute inset-x-[7%] top-[13%] bottom-[13%] rounded-lg border border-primary/25">
              <div className="absolute left-1/2 top-[-12px] bottom-[-12px] w-px bg-primary/40" />
              <div className="absolute left-[-12px] right-[-12px] top-1/2 h-px bg-primary/40" />
            </div>

            {images[selectedView] ? (
              <img
                src={images[selectedView]}
                alt={`${active.title} view`}
                className="relative z-10 max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="relative z-10 max-w-md text-center">
                <h3 className="text-[22px] font-bold text-foreground">
                  Capture the {active.title.toLowerCase()} view
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{active.hint}.</p>
                <Button
                  className="mt-5 h-10 rounded-[10px] bg-primary px-6 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary/90"
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
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : activeIsLocked ? (
                      <Lock className="mr-2 h-4 w-4" />
                    ) : (
                      <Camera className="mr-2 h-4 w-4" />
                    )}
                    {activeIsProcessing ? "Checking" : activeIsLocked ? "Locked" : "Take photo"}
                  </label>
                </Button>
              </div>
            )}

            {images[selectedView] ? (
              <div className="absolute bottom-5 right-5 z-20 flex flex-wrap justify-end gap-2">
                <Button
                  className="h-9 rounded-[10px] border border-border bg-surface-2 px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground hover:border-primary/60 hover:bg-surface-2"
                  variant="outline"
                  disabled={isBusy}
                  asChild
                >
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
                    <RotateCcw className="mr-2 h-4 w-4" /> Retake
                  </label>
                </Button>
                <Button
                  className="h-9 rounded-[10px] bg-primary px-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary/90"
                  disabled={isBusy}
                  asChild
                >
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
                    Replace photo
                  </label>
                </Button>
              </div>
            ) : null}

            {activeStatus === "issue" || activeStatus === "review" ? (
              <div
                className={cn(
                  "absolute bottom-5 left-5 z-20 rounded-md border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]",
                  activeStatus === "issue"
                    ? "border-destructive/50 bg-destructive/15 text-destructive"
                    : "border-warning/50 bg-warning/15 text-warning",
                )}
              >
                {activeStatus === "issue" ? "Retake required" : "Review required"}
              </div>
            ) : null}

            {activeIsProcessing ? (
              <div className="absolute inset-0 z-30 grid place-items-center bg-background/70 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-[10px] border bg-card px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Validating {active.title.toLowerCase()} photo
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="rounded-[14px] border bg-card p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            View brief
          </h2>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            {activeIsLocked
              ? `Capture ${titleForView(firstMissingView)} before the ${active.title.toLowerCase()} view.`
              : `Position the bag centred in the reticle. ${active.hint}.`}
          </p>

          <h3 className="mt-5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Auto detections
          </h3>
          <dl className="mt-4 space-y-2 font-mono text-[11px] text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>Photo</dt>
              <dd className={cn(images[selectedView] ? "text-success" : "text-muted-foreground")}>
                {images[selectedView] ? "captured" : "pending"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Validation</dt>
              <dd
                className={cn(
                  activeStatus === "ok" && "text-success",
                  activeStatus === "issue" && "text-destructive",
                  activeStatus === "review" && "text-warning",
                )}
              >
                {activeIsProcessing
                  ? "checking"
                  : activeStatus === "issue"
                    ? "retake"
                    : activeStatus === "review"
                      ? "review"
                      : images[selectedView]
                        ? "accepted"
                        : "pending"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Sequence</dt>
              <dd>{activeIsLocked ? "locked" : "ready"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Dimensions</dt>
              <dd>pending</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Category</dt>
              <dd>pending</dd>
            </div>
          </dl>
        </aside>
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
