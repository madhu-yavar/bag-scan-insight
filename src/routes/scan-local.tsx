import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import {
  BaggageCapture,
  type BaggageCaptureHandle,
  type ViewStatus,
} from "@/components/BaggageCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireSignedIn } from "@/lib/auth-helpers";
import { VIEWS, type BaggageView } from "@/lib/baggage-views";
import {
  analyzeBaggageWithGemini,
  validateBaggageIdentityWithGemini,
  validateBaggageViewWithGemini,
} from "@/lib/local-gemini.functions";
import {
  saveLocalScan,
  updateLocalScanApprovals,
  type LocalScanSummary,
} from "@/lib/local-scan-store.functions";

export const Route = createFileRoute("/scan-local")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  head: () => ({
    meta: [
      { title: "New baggage scan - BagScan" },
      {
        name: "description",
        content: "Capture baggage photos and generate a structured inspection profile.",
      },
    ],
  }),
  component: LocalScanPage,
});

type ImageMap = Partial<Record<BaggageView, string>>;
type JsonObject = Record<string, unknown>;
const MODEL = "gemini-3.5-flash";

function LocalScanPage() {
  const analyzeWithGemini = useServerFn(analyzeBaggageWithGemini);
  const validateIdentityWithGemini = useServerFn(validateBaggageIdentityWithGemini);
  const validateViewWithGemini = useServerFn(validateBaggageViewWithGemini);
  const saveScan = useServerFn(saveLocalScan);
  const updateScanApprovals = useServerFn(updateLocalScanApprovals);
  const [images, setImages] = useState<ImageMap>({});
  const [activeView, setActiveView] = useState<BaggageView>("front");
  const [viewStatuses, setViewStatuses] = useState<Partial<Record<BaggageView, ViewStatus>>>({});
  const [approvedReviewViews, setApprovedReviewViews] = useState<
    Partial<Record<BaggageView, boolean>>
  >({});
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [analysis, setAnalysis] = useState<unknown>(null);
  const [savedScan, setSavedScan] = useState<LocalScanSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const captureApiRef = useRef<BaggageCaptureHandle | null>(null);

  const capturedCount = useMemo(() => VIEWS.filter((view) => images[view.key]).length, [images]);
  const allCaptured = capturedCount === VIEWS.length;

  const validateCapturedView = async (view: BaggageView, dataUrl: string) => {
    setViewStatuses((current) => {
      const updated = { ...current };
      delete updated[view];
      return updated;
    });

    try {
      const result = await validateViewWithGemini({
        data: {
          model: MODEL,
          view,
          data_url: dataUrl,
        },
      });
      const validation = toObject(result.validation);
      const accepted = isSingleViewAccepted(validation, view);

      if (!accepted) {
        setViewStatuses((current) => ({ ...current, [view]: "issue" }));
        toast.error(`${titleCase(view)} photo rejected: ${singleViewRetakeReason(validation)}`);
        return false;
      }

      const identityResult = await validateCapturedIdentity(view, dataUrl);
      if (!identityResult.accepted) {
        setViewStatuses((current) => {
          const updated = { ...current, [view]: "issue" as const };
          for (const slot of identityResult.issueSlots) updated[slot] = "issue";
          return updated;
        });
        toast.error(`${titleCase(view)} photo rejected: ${identityResult.reason}`);
        return false;
      }

      const warnings = [singleViewValidationWarning(validation), identityResult.warning].filter(
        Boolean,
      );
      setViewStatuses((current) => ({ ...current, [view]: warnings.length ? "review" : "ok" }));
      if (warnings.length) {
        toast.warning(`${titleCase(view)} photo accepted for review: ${warnings.join(" ")}`);
      } else toast.success(`${titleCase(view)} photo accepted`);
      return true;
    } catch (error) {
      setViewStatuses((current) => ({ ...current, [view]: "issue" }));
      toast.error(error instanceof Error ? error.message : "Could not validate photo");
      return false;
    }
  };

  const validateCapturedIdentity = async (view: BaggageView, dataUrl: string) => {
    const candidateImages = { ...images, [view]: dataUrl };
    const identityImages = VIEWS.filter((item) => candidateImages[item.key]).map((item) => ({
      view: item.key,
      data_url: candidateImages[item.key]!,
    }));

    if (identityImages.length < 2) {
      return { accepted: true, warning: "", reason: "", issueSlots: [] as BaggageView[] };
    }

    const result = await validateIdentityWithGemini({
      data: {
        model: MODEL,
        new_view: view,
        images: identityImages,
      },
    });
    const identity = toObject(result.identity);

    if (!isIdentityAccepted(identity)) {
      return {
        accepted: false,
        warning: "",
        reason: identityRetakeReason(identity, view),
        issueSlots: identityIssueSlots(identity, view),
      };
    }

    return {
      accepted: true,
      warning: identityValidationWarning(identity),
      reason: "",
      issueSlots: [] as BaggageView[],
    };
  };

  const analyze = async () => {
    if (!allCaptured || submitting) return;
    setSubmitting(true);
    setAnalysis(null);
    setSavedScan(null);
    try {
      const approvedViews = approvedViewList(approvedReviewViews);
      const result = await analyzeWithGemini({
        data: {
          model: MODEL,
          accepted_review_views: approvedViews,
          images: VIEWS.map((view) => ({
            view: view.key,
            data_url: images[view.key]!,
          })),
        },
      });
      setAnalysis(result.analysis);
      setViewStatuses(buildViewStatuses(result.analysis, approvedReviewViews));
      const status = getCaptureStatus(result.analysis);
      if (status === "needs_retake") toast.warning("Retake needed");
      else if (status === "needs_review") toast.warning("Review capture");
      else toast.success("Baggage profile ready");

      try {
        const saved = await saveScan({
          data: {
            reference: name,
            notes,
            model: MODEL,
            approved_review_views: approvedViews,
            images: VIEWS.map((view) => ({
              view: view.key,
              data_url: images[view.key]!,
            })),
            analysis: result.analysis,
          },
        });
        setSavedScan(saved.scan);
        toast.success("Scan saved");
      } catch (saveError) {
        toast.error(
          saveError instanceof Error
            ? `Scan complete, but save failed: ${saveError.message}`
            : "Scan complete, but save failed",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleImagesChange = (next: ImageMap) => {
    const changedViews = VIEWS.filter((view) => images[view.key] !== next[view.key]).map(
      (view) => view.key,
    );

    setImages(next);

    if (changedViews.length > 0) {
      setAnalysis(null);
      setSavedScan(null);
      setViewStatuses((current) => {
        const updated = { ...current };
        changedViews.forEach((view) => {
          if (!next[view]) delete updated[view];
        });
        return updated;
      });
      setApprovedReviewViews((current) => {
        const updated = { ...current };
        changedViews.forEach((view) => {
          delete updated[view];
        });
        return updated;
      });
    }
  };

  const correctView = (view: BaggageView) => {
    setActiveView(view);
    setAnalysis(null);
    setSavedScan(null);
    setApprovedReviewViews((current) => {
      const updated = { ...current };
      delete updated[view];
      return updated;
    });
    if (captureApiRef.current) {
      captureApiRef.current.retakeView(view);
    } else {
      setImages((current) => {
        const updated = { ...current };
        delete updated[view];
        return updated;
      });
    }
    setViewStatuses((current) => ({ ...current, [view]: "issue" }));
    window.setTimeout(() => {
      captureRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const approveView = async (view: BaggageView) => {
    const nextApproved = { ...approvedReviewViews, [view]: true };
    const approvedViews = approvedViewList(nextApproved);
    setApprovedReviewViews(nextApproved);
    setViewStatuses((current) => ({ ...current, [view]: "ok" }));

    if (savedScan) {
      try {
        const updated = await updateScanApprovals({
          data: {
            id: savedScan.id,
            approved_review_views: approvedViews,
          },
        });
        setSavedScan(updated.scan);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Photo approved, but save failed");
      }
    }

    toast.success(`${titleCase(view)} photo approved`);
  };

  const exportReport = () => {
    const report = {
      schemaVersion: "local-gemini-v1",
      createdAt: new Date().toISOString(),
      name: name.trim() || null,
      notes: notes.trim() || null,
      model: MODEL,
      savedScanId: savedScan?.id ?? null,
      approvedReviewViews: approvedViewList(approvedReviewViews),
      capturedViews: VIEWS.map((view) => ({
        view: view.key,
        imageDataUrl: images[view.key] ?? null,
      })),
      analysis,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(name || "baggage-scan")}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">New baggage scan</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Capture the required views and generate a baggage profile for review.
            </p>
          </div>
          <div className="rounded-xl border bg-surface-elevated px-4 py-3 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{capturedCount}/4</span> views captured
          </div>
        </div>

        <div ref={captureRef}>
          <BaggageCapture
            ref={captureApiRef}
            images={images}
            onChange={handleImagesChange}
            onValidateImage={validateCapturedView}
            activeView={activeView}
            onActiveViewChange={setActiveView}
            viewStatuses={viewStatuses}
          />
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-3xl border bg-card p-6 shadow-elevated">
            <h2 className="text-lg font-semibold">Baggage details</h2>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="local-name">Reference</Label>
                <Input
                  id="local-name"
                  placeholder="e.g. BAG-1042"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="local-notes">Notes</Label>
                <Textarea
                  id="local-notes"
                  placeholder="Tag number, visible marks, or handling notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="rounded-3xl border bg-card p-6 shadow-elevated">
            {savedScan ? (
              <div className="mb-4 rounded-xl border border-accent/35 bg-accent/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">Saved</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {savedScan.id}
                    </div>
                  </div>
                </div>
                <Button className="mt-3 w-full" size="sm" variant="outline" asChild>
                  <Link to="/reports-local/$id" params={{ id: savedScan.id }}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open saved report
                  </Link>
                </Button>
              </div>
            ) : null}

            <Button
              className="w-full bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-95"
              disabled={!allCaptured || submitting}
              onClick={analyze}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {submitting
                ? "Scanning..."
                : !allCaptured
                  ? `Capture all 4 views (${capturedCount}/4)`
                  : "Scan baggage"}
            </Button>

            <Button
              className="mt-3 w-full"
              variant="outline"
              disabled={!analysis}
              onClick={exportReport}
            >
              <Download className="mr-2 h-4 w-4" />
              Export report
            </Button>

            <Button className="mt-3 w-full" variant="ghost" asChild>
              <Link to="/reports-local">
                <Database className="mr-2 h-4 w-4" />
                Saved reports
              </Link>
            </Button>
          </section>
        </div>

        {analysis ? (
          <section className="mt-8 rounded-3xl border bg-card p-6 shadow-elevated">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Baggage profile</h2>
                <p className="text-sm text-muted-foreground">Review the detected attributes.</p>
              </div>
              <Button variant="outline" onClick={exportReport}>
                <Download className="mr-2 h-4 w-4" />
                Export report
              </Button>
            </div>
            <AnalysisSummary
              analysis={analysis}
              approvedReviewViews={approvedReviewViews}
              onApproveView={approveView}
              onCorrectView={correctView}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function AnalysisSummary({
  analysis,
  approvedReviewViews,
  onApproveView,
  onCorrectView,
}: {
  analysis: unknown;
  approvedReviewViews: Partial<Record<BaggageView, boolean>>;
  onApproveView: (view: BaggageView) => void | Promise<void>;
  onCorrectView: (view: BaggageView) => void;
}) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return null;

  const item = analysis as JsonObject;
  const colors = toObject(item.colors);
  const dimensions = toObject(item.dimensions_cm);
  const wheels = toObject(item.wheels);
  const validation = toObject(item.capture_validation);

  const fields = [
    ["Type", item.bag_type],
    ["Condition", item.overall_condition],
    ["Primary color", colors?.primary],
    ["Material", item.material],
    ["Texture", item.texture],
    ["Wheels", wheels?.count],
    ["Dimensions", formatDimensions(dimensions)],
  ];

  return (
    <>
      <CaptureReview
        validation={validation}
        approvedReviewViews={approvedReviewViews}
        onApproveView={onApproveView}
        onCorrectView={onCorrectView}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-surface-elevated p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{formatValue(value)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function CaptureReview({
  validation,
  approvedReviewViews,
  onApproveView,
  onCorrectView,
}: {
  validation: JsonObject | null;
  approvedReviewViews: Partial<Record<BaggageView, boolean>>;
  onApproveView: (view: BaggageView) => void | Promise<void>;
  onCorrectView: (view: BaggageView) => void;
}) {
  if (!validation) return null;

  const status = String(validation.overall_status ?? "ready");
  const views = Array.isArray(validation.views)
    ? validation.views.map(toObject).filter((view): view is JsonObject => Boolean(view))
    : [];
  const missingViews = Array.isArray(validation.missing_views)
    ? validation.missing_views.map(String).filter(Boolean)
    : [];
  const duplicates = Array.isArray(validation.duplicate_views)
    ? validation.duplicate_views
        .map(toObject)
        .filter((duplicate): duplicate is JsonObject => Boolean(duplicate))
    : [];
  const identity = toObject(validation.identity_consistency);
  const hasIdentityIssue = identity?.same_baggage === false;
  const identitySlots = identityRetakeSlots(identity);
  const identitySlotSet = new Set(identitySlots);
  const issueViews = views.filter((view) => {
    if (!hasViewIssue(view)) return false;
    const slot = normalizeView(view.submitted_slot);
    return !(
      slot &&
      approvedReviewViews[slot] &&
      canApproveView(view) &&
      !identitySlotSet.has(slot)
    );
  });
  const hasBlockingIssues =
    status === "needs_retake" ||
    hasIdentityIssue ||
    issueViews.length > 0 ||
    missingViews.length > 0 ||
    duplicates.length > 0;

  if (!hasBlockingIssues) {
    return (
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div>
          <div className="font-semibold text-foreground">Capture accepted</div>
          <p className="mt-1 text-muted-foreground">
            The required baggage views are clear enough for review.
          </p>
        </div>
      </div>
    );
  }

  const urgent = status === "needs_retake";

  return (
    <div
      className={`mt-5 rounded-xl border p-4 ${
        urgent ? "border-destructive/35 bg-destructive/10" : "border-warning/45 bg-warning/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`mt-0.5 h-5 w-5 shrink-0 ${urgent ? "text-destructive" : "text-warning"}`}
        />
        <div>
          <div className="font-semibold text-foreground">
            {urgent ? "Retake needed" : "Capture review"}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatValue(validation.recommended_action || validation.summary)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {hasIdentityIssue ? (
          <div className="rounded-lg border border-destructive/30 bg-background/70 p-3 md:col-span-2">
            <div className="text-sm font-semibold text-foreground">Different baggage detected</div>
            <p className="mt-2 text-sm text-muted-foreground">{formatIdentityEvidence(identity)}</p>
            {identitySlots.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {identitySlots.map((slot) => (
                  <Button
                    key={slot}
                    className="h-8 px-3 text-xs"
                    variant="outline"
                    onClick={() => onCorrectView(slot)}
                  >
                    Retake {titleCase(slot)}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {issueViews.map((view) => {
          const submittedSlot = normalizeView(view.submitted_slot);
          const canApprove =
            submittedSlot && !identitySlotSet.has(submittedSlot) && canApproveView(view);
          return (
            <div
              key={String(view.submitted_slot)}
              className="rounded-lg border bg-background/70 p-3"
            >
              <div className="text-sm font-semibold text-foreground">
                {titleCase(String(view.submitted_slot ?? "Photo"))}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Detected: {titleCase(String(view.detected_view ?? "unknown"))}
              </div>
              <div className="mt-2 text-sm">
                {formatValue(view.retake_reason || viewIssueSummary(view))}
              </div>
              {submittedSlot ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canApprove ? (
                    <Button
                      className="h-8 px-3 text-xs"
                      variant="secondary"
                      onClick={() => void onApproveView(submittedSlot)}
                    >
                      Use photo
                    </Button>
                  ) : null}
                  <Button
                    className="h-8 px-3 text-xs"
                    variant="outline"
                    onClick={() => onCorrectView(submittedSlot)}
                  >
                    Retake {titleCase(submittedSlot)}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {missingViews.length > 0 ? (
        <div className="mt-4">
          <div className="text-sm">
            <span className="font-semibold text-foreground">Missing views: </span>
            {missingViews.map(titleCase).join(", ")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingViews.map((view) => {
              const normalized = normalizeView(view);
              if (!normalized) return null;
              return (
                <Button
                  key={view}
                  className="h-8 px-3 text-xs"
                  variant="outline"
                  onClick={() => onCorrectView(normalized)}
                >
                  Capture {titleCase(view)}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {duplicates.length > 0 ? (
        <div className="mt-4 rounded-lg border bg-background/70 p-3">
          <div className="text-sm">
            <span className="font-semibold text-foreground">Repeated views: </span>
            {duplicates.map(formatDuplicate).join("; ")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {duplicates.flatMap((duplicate) =>
              duplicateSlots(duplicate).map((slot) => (
                <Button
                  key={`${String(duplicate.view ?? "duplicate")}-${slot}`}
                  className="h-8 px-3 text-xs"
                  variant="outline"
                  onClick={() => onCorrectView(slot)}
                >
                  Retake {titleCase(slot)}
                </Button>
              )),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function getCaptureStatus(analysis: unknown) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return "ready";
  const validation = toObject((analysis as JsonObject).capture_validation);
  if (hasIdentityIssue(validation)) return "needs_retake";
  return String(validation?.overall_status ?? "ready");
}

function buildViewStatuses(
  analysis: unknown,
  approvedReviewViews: Partial<Record<BaggageView, boolean>> = {},
): Partial<Record<BaggageView, ViewStatus>> {
  const statuses: Partial<Record<BaggageView, ViewStatus>> = {};
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return statuses;

  const validation = toObject((analysis as JsonObject).capture_validation);
  if (!validation) return statuses;

  const overallStatus = String(validation.overall_status ?? "ready");
  const identitySlots = identityRetakeSlots(toObject(validation.identity_consistency));
  const identitySlotSet = new Set(identitySlots);
  const views = Array.isArray(validation.views)
    ? validation.views.map(toObject).filter((view): view is JsonObject => Boolean(view))
    : [];

  for (const view of views) {
    const slot = normalizeView(view.submitted_slot);
    if (!slot || !hasViewIssue(view)) continue;
    if (approvedReviewViews[slot] && canApproveView(view) && !identitySlotSet.has(slot)) {
      statuses[slot] = "ok";
      continue;
    }
    statuses[slot] =
      view.retake_required === true || overallStatus === "needs_retake" ? "issue" : "review";
  }

  if (Array.isArray(validation.missing_views)) {
    for (const value of validation.missing_views) {
      const slot = normalizeView(value);
      if (slot) statuses[slot] = "issue";
    }
  }

  if (Array.isArray(validation.duplicate_views)) {
    const duplicates = validation.duplicate_views
      .map(toObject)
      .filter((duplicate): duplicate is JsonObject => Boolean(duplicate));
    for (const duplicate of duplicates) {
      for (const slot of duplicateSlots(duplicate)) {
        statuses[slot] = "issue";
      }
    }
  }

  for (const slot of identitySlots) {
    statuses[slot] = "issue";
  }

  return statuses;
}

function normalizeView(value: unknown): BaggageView | null {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  return VIEWS.some((view) => view.key === normalized) ? (normalized as BaggageView) : null;
}

function isSingleViewAccepted(validation: JsonObject | null, expected: BaggageView) {
  if (!validation) return false;
  const detected = normalizeView(validation.detected_view);
  return (
    validation.status === "accepted" &&
    validation.retake_required !== true &&
    validation.view_match === true &&
    detected === expected &&
    validation.bag_visible === "full" &&
    validation.multiple_bags_visible !== true &&
    numericValue(validation.bag_count) <= 1 &&
    validation.framing === "good" &&
    validation.lighting === "good" &&
    validation.sharpness === "sharp"
  );
}

function singleViewRetakeReason(validation: JsonObject | null) {
  if (!validation) return "Could not validate this photo. Retake it.";
  if (validation.retake_reason) return formatValue(validation.retake_reason);

  const expected = normalizeView(validation.submitted_slot);
  const detected = normalizeView(validation.detected_view);
  if (expected && detected && expected !== detected) {
    return `Expected ${titleCase(expected)} view, detected ${titleCase(detected)} view.`;
  }
  if (validation.bag_visible !== "full") return "Bag must be fully visible.";
  if (validation.multiple_bags_visible === true || numericValue(validation.bag_count) > 1) {
    return "Only one baggage item can be visible.";
  }
  if (validation.framing !== "good") return `Framing is ${formatValue(validation.framing)}.`;
  if (validation.lighting !== "good") return `Lighting is ${formatValue(validation.lighting)}.`;
  if (validation.sharpness !== "sharp") return `Photo is ${formatValue(validation.sharpness)}.`;
  return "Retake this photo with the requested angle clearly visible.";
}

function singleViewValidationWarning(validation: JsonObject | null) {
  const warning = validation?.validation_warning;
  return typeof warning === "string" && warning.trim() ? warning.trim() : "";
}

function isIdentityAccepted(identity: JsonObject | null) {
  if (!identity) return false;
  if (identity.same_baggage !== true) return false;

  const confidence = String(identity.confidence ?? "").toLowerCase();
  return confidence === "high" || confidence === "medium";
}

function identityRetakeReason(identity: JsonObject | null, newView: BaggageView) {
  if (!identity) {
    return "Could not verify that this photo belongs to the same suitcase. Retake it.";
  }

  const message =
    typeof identity.operator_message === "string" && identity.operator_message.trim()
      ? identity.operator_message.trim()
      : "";
  if (message) return message;

  const evidence = Array.isArray(identity.evidence)
    ? identity.evidence.map(String).filter(Boolean)
    : [];
  if (evidence.length > 0) return evidence.join(" ");

  const confidence = String(identity.confidence ?? "").toLowerCase();
  if (identity.same_baggage !== true) {
    return `${titleCase(newView)} appears to show a different suitcase. Retake this photo.`;
  }
  if (confidence === "low") {
    return "Same-suitcase confidence is too low. Retake this photo with clearer shared identity details.";
  }

  return "Retake this photo so it clearly matches the previously captured suitcase.";
}

function identityIssueSlots(identity: JsonObject | null, newView: BaggageView) {
  if (!identity) return [newView];

  const slots = uniqueViews([
    ...normalizeViewArray(identity.recommended_retake_slots),
    ...normalizeViewArray(identity.conflicting_slots),
    newView,
  ]);
  return slots.length > 0 ? slots : [newView];
}

function identityValidationWarning(identity: JsonObject | null) {
  if (!identity) return "";

  const confidence = String(identity.confidence ?? "").toLowerCase();
  if (confidence === "medium") {
    const evidence = Array.isArray(identity.evidence)
      ? identity.evidence.map(String).filter(Boolean)
      : [];
    return evidence.length > 0
      ? `Same-suitcase check passed with medium confidence: ${evidence.join(" ")}`
      : "Same-suitcase check passed with medium confidence.";
  }

  return "";
}

function hasViewIssue(view: JsonObject | null) {
  if (!view) return false;
  return (
    view.retake_required === true ||
    view.view_match === false ||
    view.bag_visible !== "full" ||
    view.multiple_bags_visible === true ||
    numericValue(view.bag_count) > 1 ||
    (view.framing != null && view.framing !== "good") ||
    (view.lighting != null && view.lighting !== "good") ||
    (view.sharpness != null && view.sharpness !== "sharp")
  );
}

function canApproveView(view: JsonObject | null) {
  return (
    Boolean(view) &&
    view?.retake_required !== true &&
    view?.multiple_bags_visible !== true &&
    numericValue(view?.bag_count) <= 1
  );
}

function hasIdentityIssue(validation: JsonObject | null) {
  const identity = toObject(validation?.identity_consistency);
  return identity?.same_baggage === false;
}

function identityRetakeSlots(identity: JsonObject | null) {
  const recommended = normalizeViewArray(identity?.recommended_retake_slots);
  if (recommended.length > 0) return recommended;
  const conflicting = normalizeViewArray(identity?.conflicting_slots);
  if (conflicting.length > 0) return conflicting;
  return identity?.same_baggage === false ? VIEWS.map((view) => view.key) : [];
}

function normalizeViewArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueViews(value.map(normalizeView).filter((slot): slot is BaggageView => Boolean(slot)));
}

function uniqueViews(values: BaggageView[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function formatIdentityEvidence(identity: JsonObject | null) {
  const evidence = Array.isArray(identity?.evidence)
    ? identity.evidence.map(String).filter(Boolean)
    : [];
  if (evidence.length > 0) return evidence.join(" ");
  return "One or more views appear to show a different bag. Retake the highlighted view before using this report.";
}

function viewIssueSummary(view: JsonObject) {
  const issues = [
    view.view_match === false ? "Wrong angle" : null,
    view.bag_visible !== "full" ? formatValue(view.bag_visible) : null,
    view.multiple_bags_visible === true || numericValue(view.bag_count) > 1
      ? "Multiple baggage items visible"
      : null,
    view.framing !== "good" ? formatValue(view.framing) : null,
    view.lighting !== "good" ? formatValue(view.lighting) : null,
    view.sharpness !== "sharp" ? formatValue(view.sharpness) : null,
  ].filter(Boolean);

  return issues.join(", ") || "Review photo";
}

function formatDuplicate(value: JsonObject | null) {
  if (!value) return "";
  const slots = Array.isArray(value.submitted_slots)
    ? value.submitted_slots.map(String).map(titleCase).join(", ")
    : "multiple slots";
  return `${titleCase(String(value.view ?? "unknown"))}: ${slots}`;
}

function duplicateSlots(value: JsonObject) {
  if (!Array.isArray(value.submitted_slots)) return [];
  return value.submitted_slots
    .map(normalizeView)
    .filter((slot): slot is BaggageView => Boolean(slot));
}

function approvedViewList(approvedReviewViews: Partial<Record<BaggageView, boolean>>) {
  return VIEWS.filter((view) => approvedReviewViews[view.key]).map((view) => view.key);
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
      .replace(/^-+|-+$/g, "") || "baggage-scan"
  );
}
