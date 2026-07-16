import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  LogOut,
  Plane,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

import {
  BaggageCapture,
  type BaggageCaptureHandle,
  type ViewStatus,
} from "@/components/BaggageCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hasSupabaseConfig, supabase } from "@/integrations/supabase/client";
import { requireSignedIn } from "@/lib/auth-helpers";
import { VIEWS, type BaggageView } from "@/lib/baggage-views";
import {
  analyzeBaggageWithGemini,
  validateBaggageIdentityWithGemini,
  validateBaggageViewWithGemini,
} from "@/lib/local-gemini.functions";
import {
  saveCloudScan,
  updateCloudScanApprovals,
  type CloudScanSummary,
} from "@/lib/cloud-scan-store.functions";
import {
  saveLocalScan,
  updateLocalScanApprovals,
  type LocalScanSummary,
  type TravelContext,
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
type ValueApprovalStatus = "approved" | "corrected";
type ValueApproval = {
  status: ValueApprovalStatus;
  value: string;
  correctedValue?: string;
  updatedAt: string;
};
type ValueApprovalMap = Record<string, ValueApproval>;
type TravelContextForm = Record<
  Exclude<keyof TravelContext, "weight_kg" | "baggage_category_source">,
  string
> & {
  baggage_category_source: NonNullable<TravelContext["baggage_category_source"]> | "";
  weight_kg: string;
};
const MODEL = "gemini-3.5-flash";
const IDENTITY_MIN_OBSERVABLE_WEIGHT = 45;
const IDENTITY_ACCEPT_SCORE = 0.82;
const IDENTITY_STRONG_SCORE = 0.92;
const EMPTY_TRAVEL_CONTEXT: TravelContextForm = {
  pnr: "",
  airline: "",
  flight_number: "",
  flight_date: "",
  departure_airport: "",
  arrival_airport: "",
  terminal: "",
  bag_tag: "",
  baggage_category: "",
  baggage_category_source: "",
  weight_kg: "",
  special_handling: "",
};

function isCloudSavedScan(scan: CloudScanSummary | LocalScanSummary): scan is CloudScanSummary {
  return "storage" in scan && scan.storage === "cloud";
}

function notifyScanSaved(scanId: string) {
  const payload = JSON.stringify({ scanId, savedAt: Date.now() });
  window.dispatchEvent(new CustomEvent("bagscan:scan-saved", { detail: payload }));
  localStorage.setItem("bagscan:last-scan-saved", payload);
}

function LocalScanPage() {
  const analyzeWithGemini = useServerFn(analyzeBaggageWithGemini);
  const validateIdentityWithGemini = useServerFn(validateBaggageIdentityWithGemini);
  const validateViewWithGemini = useServerFn(validateBaggageViewWithGemini);
  const saveCloud = useServerFn(saveCloudScan);
  const saveLocal = useServerFn(saveLocalScan);
  const updateCloudApprovals = useServerFn(updateCloudScanApprovals);
  const updateLocalApprovals = useServerFn(updateLocalScanApprovals);
  const [images, setImages] = useState<ImageMap>({});
  const [activeView, setActiveView] = useState<BaggageView>("front");
  const [viewStatuses, setViewStatuses] = useState<Partial<Record<BaggageView, ViewStatus>>>({});
  const [approvedReviewViews, setApprovedReviewViews] = useState<
    Partial<Record<BaggageView, boolean>>
  >({});
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [travelContext, setTravelContext] = useState<TravelContextForm>(EMPTY_TRAVEL_CONTEXT);
  const [analysis, setAnalysis] = useState<unknown>(null);
  const [savedScan, setSavedScan] = useState<CloudScanSummary | LocalScanSummary | null>(null);
  const [valueApprovals, setValueApprovals] = useState<ValueApprovalMap>({});
  const [submitting, setSubmitting] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const captureApiRef = useRef<BaggageCaptureHandle | null>(null);

  const capturedCount = useMemo(() => VIEWS.filter((view) => images[view.key]).length, [images]);
  const allCaptured = capturedCount === VIEWS.length;

  useEffect(() => {
    if (!savedScan || Object.keys(valueApprovals).length === 0) return;
    localStorage.setItem(`bagscan:value-approvals:${savedScan.id}`, JSON.stringify(valueApprovals));
  }, [savedScan, valueApprovals]);

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

    const decision = identityDecision(identity, view);
    if (!decision.accepted) {
      return {
        accepted: false,
        warning: "",
        reason: decision.reason,
        issueSlots: decision.issueSlots,
      };
    }

    return {
      accepted: true,
      warning: decision.warning,
      reason: "",
      issueSlots: [] as BaggageView[],
    };
  };

  const analyze = async () => {
    if (!allCaptured || submitting) return;
    setSubmitting(true);
    setAnalysis(null);
    setSavedScan(null);
    setValueApprovals({});
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
      const completedTravelContext = withBaggageCategorySuggestion(travelContext, result.analysis);
      setTravelContext(completedTravelContext);

      const savePayload = {
        reference: name,
        notes,
        model: MODEL,
        travel_context: compactTravelContext(completedTravelContext),
        approved_review_views: approvedViews,
        images: VIEWS.map((view) => ({
          view: view.key,
          data_url: images[view.key]!,
        })),
        analysis: result.analysis,
      };

      try {
        const saved = await saveCloud({ data: savePayload });
        setSavedScan(saved.scan);
        notifyScanSaved(saved.scan.id);
        toast.success("Scan saved to cloud");
      } catch (cloudSaveError) {
        try {
          const saved = await saveLocal({ data: savePayload });
          setSavedScan(saved.scan);
          notifyScanSaved(saved.scan.id);
          toast.warning(
            cloudSaveError instanceof Error
              ? `Cloud save failed; saved locally instead: ${cloudSaveError.message}`
              : "Cloud save failed; saved locally instead",
          );
        } catch (localSaveError) {
          toast.error(
            localSaveError instanceof Error
              ? `Scan complete, but save failed: ${localSaveError.message}`
              : "Scan complete, but save failed",
          );
        }
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
      setValueApprovals({});
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
        const updated = isCloudSavedScan(savedScan)
          ? await updateCloudApprovals({
              data: {
                id: savedScan.id,
                approved_review_views: approvedViews,
              },
            })
          : await updateLocalApprovals({
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
      travelContext: compactTravelContext(travelContext),
      model: MODEL,
      savedScanId: savedScan?.id ?? null,
      approvedReviewViews: approvedViewList(approvedReviewViews),
      capturedViews: VIEWS.map((view) => ({
        view: view.key,
        imageDataUrl: images[view.key] ?? null,
      })),
      analysis,
      valueApprovals,
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

  const approveValue = (key: string, value: string) => {
    setValueApprovals((current) => ({
      ...current,
      [key]: {
        status: "approved",
        value,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const correctValue = (key: string, value: string, correctedValue: string) => {
    setValueApprovals((current) => ({
      ...current,
      [key]: {
        status: "corrected",
        value,
        correctedValue,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  return (
    <div className="min-h-screen bg-background text-foreground" style={cockpitBackgroundStyle}>
      <ScanOpsNav />
      <main className="mx-auto max-w-[1360px] px-4 py-7 sm:px-8">
        <div className="mb-6 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-foreground">
              New baggage scan{" "}
              <span className="font-normal text-muted-foreground">· Station 04</span>
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Capture the required views and generate a verified baggage profile.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:flex">
            <HudPill label="Views" value={`${capturedCount} / ${VIEWS.length}`} />
            <HudPill label="Status" value={submitting ? "Scan" : "Live"} />
            <HudPill label="Terminal" value={travelContext.terminal.trim() || "BS-09"} />
          </div>
        </div>

        <ReferencePanel
          name={name}
          setName={setName}
          notes={notes}
          setNotes={setNotes}
          travelContext={travelContext}
          setTravelContext={setTravelContext}
          savedScan={savedScan}
        />

        <div ref={captureRef}>
          <BaggageCapture
            ref={captureApiRef}
            images={images}
            onChange={handleImagesChange}
            onValidateImage={validateCapturedView}
            activeView={activeView}
            onActiveViewChange={setActiveView}
            viewStatuses={viewStatuses}
            asideActions={
              <>
                <ScanActionButton
                  variant="primary"
                  disabled={!allCaptured || submitting}
                  onClick={analyze}
                >
                  {submitting
                    ? "Scanning"
                    : !allCaptured
                      ? `Need ${VIEWS.length - capturedCount} views`
                      : "Generate profile"}
                </ScanActionButton>
                <ScanActionButton disabled={!analysis} onClick={exportReport}>
                  Export report
                </ScanActionButton>
                <ScanActionLink>Saved reports</ScanActionLink>
              </>
            }
          />
        </div>

        {analysis ? (
          <section className="mt-6 rounded-[14px] border bg-card p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-primary">
                  Baggage profile
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review the detected attributes and capture quality.
                </p>
              </div>
              <Button
                className="h-9 rounded-[10px] border border-primary/40 bg-transparent px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-primary hover:bg-primary/10"
                variant="outline"
                onClick={exportReport}
              >
                <Download className="mr-2 h-4 w-4" />
                Export report
              </Button>
            </div>
            <AnalysisSummary
              analysis={analysis}
              approvedReviewViews={approvedReviewViews}
              valueApprovals={valueApprovals}
              onApproveView={approveView}
              onCorrectView={correctView}
              onApproveValue={approveValue}
              onCorrectValue={correctValue}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}

const cockpitInputClass =
  "h-10 rounded-lg border-border bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-primary/20";

const cockpitTextareaClass =
  "min-h-20 rounded-lg border-border bg-surface-2 px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-primary/20";

const cockpitBackgroundStyle = {
  background:
    "radial-gradient(1000px 500px at 20% -10%, rgba(56,189,248,.12), transparent 60%), radial-gradient(700px 400px at 100% 100%, rgba(245,158,11,.08), transparent 60%), var(--color-background)",
};

function ScanOpsNav() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const supabaseConfigured = hasSupabaseConfig();

  useEffect(() => {
    if (!supabaseConfigured) return;

    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabaseConfigured]);

  const signOut = async () => {
    if (supabaseConfigured) await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <header className="border-b bg-background/80">
      <div className="mx-auto flex min-h-[52px] max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <Link
          to="/scan-local"
          className="flex items-center gap-3 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-foreground"
        >
          <Plane className="h-4 w-4 text-primary" />
          <span>BAGSCAN OPS</span>
        </Link>

        <nav className="order-3 flex w-full items-center gap-7 overflow-x-auto font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground sm:order-none sm:w-auto">
          <Link to="/scan-local" className="shrink-0 text-primary">
            New scan
          </Link>
          <Link to="/reports-local" className="shrink-0 hover:text-primary">
            Saved reports
          </Link>
          <Link to="/dashboard" className="shrink-0 hover:text-primary">
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden max-w-[220px] truncate font-mono text-[11px] text-muted-foreground sm:block">
            {user?.email ?? "operator"}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 font-mono text-[11px] text-muted-foreground hover:text-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

function HudPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border bg-card px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-base text-primary">{value}</div>
    </div>
  );
}

function ScanActionButton({
  variant = "secondary",
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      className={`rounded-[10px] border px-3 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === "primary"
          ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-surface-2 text-foreground hover:border-primary/60 hover:text-primary"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function ScanActionLink({ children }: { children: ReactNode }) {
  return (
    <Link
      to="/reports-local"
      className="rounded-[10px] border border-border bg-surface-2 px-3 py-3 text-center font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-foreground transition hover:border-primary/60 hover:text-primary"
    >
      {children}
    </Link>
  );
}

function ReferencePanel({
  name,
  setName,
  notes,
  setNotes,
  travelContext,
  setTravelContext,
  savedScan,
}: {
  name: string;
  setName: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  travelContext: TravelContextForm;
  setTravelContext: Dispatch<SetStateAction<TravelContextForm>>;
  savedScan: CloudScanSummary | LocalScanSummary | null;
}) {
  return (
    <section className="mb-6 rounded-[14px] border bg-card p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-primary">
            Reference and journey context
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Fill these fields before capture so analytics can connect the bag to passenger, airline,
            airport, and manufacturing signals.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-3">
          <TextField
            id="local-name"
            label="Reference"
            placeholder="e.g. BAG-1042"
            value={name}
            onChange={setName}
          />
        </div>
        <TextField
          id="travel-pnr"
          label="PNR"
          placeholder="e.g. Y7K9Q2"
          value={travelContext.pnr}
          onChange={(value) => updateTravelField(setTravelContext, "pnr", value)}
        />
        <TextField
          id="travel-bag-tag"
          label="Bag tag"
          placeholder="e.g. 0987654321"
          value={travelContext.bag_tag}
          onChange={(value) => updateTravelField(setTravelContext, "bag_tag", value)}
        />
        <TextField
          id="travel-airline"
          label="Airline"
          placeholder="e.g. IndiGo"
          value={travelContext.airline}
          onChange={(value) => updateTravelField(setTravelContext, "airline", value)}
        />
        <TextField
          id="travel-flight"
          label="Flight number"
          placeholder="e.g. 6E204"
          value={travelContext.flight_number}
          onChange={(value) => updateTravelField(setTravelContext, "flight_number", value)}
        />
        <TextField
          id="travel-date"
          label="Flight date"
          type="date"
          value={travelContext.flight_date}
          onChange={(value) => updateTravelField(setTravelContext, "flight_date", value)}
        />
        <TextField
          id="travel-terminal"
          label="Terminal"
          placeholder="e.g. T2"
          value={travelContext.terminal}
          onChange={(value) => updateTravelField(setTravelContext, "terminal", value)}
        />
        <TextField
          id="travel-departure"
          label="Departure airport"
          placeholder="e.g. BLR"
          value={travelContext.departure_airport}
          onChange={(value) => updateTravelField(setTravelContext, "departure_airport", value)}
        />
        <TextField
          id="travel-arrival"
          label="Arrival airport"
          placeholder="e.g. DEL"
          value={travelContext.arrival_airport}
          onChange={(value) => updateTravelField(setTravelContext, "arrival_airport", value)}
        />
        <div className="md:col-span-2">
          <div className="grid gap-1.5">
            <Label
              htmlFor="travel-category"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
            >
              Baggage category
            </Label>
            <Input
              id="travel-category"
              className={cockpitInputClass}
              placeholder="Auto after scan, or enter cabin / check-in"
              value={travelContext.baggage_category}
              onChange={(event) =>
                setTravelContext((current) => ({
                  ...current,
                  baggage_category: event.target.value,
                  baggage_category_source: event.target.value.trim() ? "operator_override" : "",
                }))
              }
            />
            <div className="font-mono text-[10px] text-muted-foreground">
              {travelContext.baggage_category_source === "system"
                ? "Suggested from dimensions. Operator can override."
                : "Leave blank to suggest cabin or check-in from detected dimensions."}
            </div>
          </div>
        </div>
        <TextField
          id="travel-weight"
          label="Weight kg"
          inputMode="decimal"
          placeholder="e.g. 18.5"
          value={travelContext.weight_kg}
          onChange={(value) => updateTravelField(setTravelContext, "weight_kg", value)}
        />
        <div className="md:col-span-2 xl:col-span-3">
          <div className="grid gap-1.5">
            <Label
              htmlFor="travel-special-handling"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
            >
              Special handling
            </Label>
            <Textarea
              id="travel-special-handling"
              className={cockpitTextareaClass}
              placeholder="Fragile, wheelchair support, priority handling, or claim notes"
              value={travelContext.special_handling}
              onChange={(event) =>
                updateTravelField(setTravelContext, "special_handling", event.target.value)
              }
            />
          </div>
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <div className="grid gap-1.5">
            <Label
              htmlFor="local-notes"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
            >
              Operator notes
            </Label>
            <Textarea
              id="local-notes"
              className={cockpitTextareaClass}
              placeholder="Visible marks, handling notes, or exception context"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
      </div>

      {savedScan ? (
        <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-primary/30 bg-primary/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                Saved profile
              </div>
              <div className="truncate text-xs text-muted-foreground">{savedScan.id}</div>
            </div>
          </div>
          <Button
            className="h-9 rounded-[10px] border border-primary/40 bg-transparent px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-primary hover:bg-primary/10"
            variant="outline"
            asChild
          >
            <Link to="/reports-local/$id" params={{ id: savedScan.id }}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open report
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function TextField({
  id,
  label,
  type = "text",
  inputMode,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  type?: string;
  inputMode?: ComponentProps<"input">["inputMode"];
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={id}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
      >
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        className={cockpitInputClass}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function AnalysisSummary({
  analysis,
  approvedReviewViews,
  valueApprovals,
  onApproveView,
  onCorrectView,
  onApproveValue,
  onCorrectValue,
}: {
  analysis: unknown;
  approvedReviewViews: Partial<Record<BaggageView, boolean>>;
  valueApprovals: ValueApprovalMap;
  onApproveView: (view: BaggageView) => void | Promise<void>;
  onCorrectView: (view: BaggageView) => void;
  onApproveValue: (key: string, value: string) => void;
  onCorrectValue: (key: string, value: string, correctedValue: string) => void;
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

      <ValueApprovalPanel
        fields={approvalFieldsForAnalysis(item)}
        approvals={valueApprovals}
        onApprove={onApproveValue}
        onCorrect={onCorrectValue}
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

type ApprovalField = {
  key: string;
  label: string;
  value: string;
  rationale: string;
};

function ValueApprovalPanel({
  fields,
  approvals,
  onApprove,
  onCorrect,
}: {
  fields: ApprovalField[];
  approvals: ValueApprovalMap;
  onApprove: (key: string, value: string) => void;
  onCorrect: (key: string, value: string, correctedValue: string) => void;
}) {
  const decided = fields.filter((field) => approvals[field.key]).length;
  return (
    <section className="mt-5 rounded-[14px] border bg-background/40 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
            Operator approval
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm or correct AI-generated values. These approvals are kept locally and included in
            report export.
          </p>
        </div>
        <div className="font-mono text-[12px] text-muted-foreground">
          {decided}/{fields.length} reviewed
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {fields.map((field) => {
          const approval = approvals[field.key];
          const correctedValue = approval?.correctedValue ?? "";
          return (
            <div
              key={field.key}
              className="grid gap-3 rounded-[10px] border bg-card p-3 lg:grid-cols-[0.8fr_1.1fr_auto]"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {field.label}
                </div>
                <div className="mt-1 text-sm text-foreground">{field.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{field.rationale}</div>
              </div>
              <div className="min-w-0">
                {approval?.status === "corrected" ? (
                  <Input
                    className={cockpitInputClass}
                    placeholder="Enter operator-corrected value"
                    value={correctedValue}
                    onChange={(event) =>
                      onCorrect(field.key, field.value, event.currentTarget.value)
                    }
                  />
                ) : (
                  <div className="flex h-full items-center text-xs text-muted-foreground">
                    {approval?.status === "approved"
                      ? "Approved by operator"
                      : "Awaiting operator decision"}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button
                  className="h-8 rounded-md px-3 text-xs"
                  variant={approval?.status === "approved" ? "default" : "outline"}
                  onClick={() => onApprove(field.key, field.value)}
                >
                  Approve
                </Button>
                <Button
                  className="h-8 rounded-md px-3 text-xs"
                  variant={approval?.status === "corrected" ? "secondary" : "outline"}
                  onClick={() => onCorrect(field.key, field.value, correctedValue)}
                >
                  Correct
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function approvalFieldsForAnalysis(item: JsonObject): ApprovalField[] {
  const colors = toObject(item.colors);
  const dimensions = toObject(item.dimensions_cm);
  const wheels = toObject(item.wheels);
  const features = Array.isArray(item.features) ? item.features.map(String) : [];
  const lockFeatures = features.filter((feature) => /lock/i.test(feature));

  return [
    {
      key: "bag_type",
      label: "Bag type",
      value: formatValue(item.bag_type),
      rationale: "Used by airline, airport, insurance, and manufacturer dashboards.",
    },
    {
      key: "size_class",
      label: "Size class",
      value: formatValue(item.size_class),
      rationale: "Drives cabin/check-in suggestion and size planning.",
    },
    {
      key: "dimensions_cm",
      label: "Dimensions",
      value: formatValue(formatDimensions(dimensions)),
      rationale: "Used for capacity, oversize, product range, and customer claim decisions.",
    },
    {
      key: "primary_color",
      label: "Primary color",
      value: formatValue(colors?.primary),
      rationale: "Feeds color preference and manufacturer demand analytics.",
    },
    {
      key: "material_shell",
      label: "Material / shell",
      value: [item.material, item.shell_type].map(formatValue).join(" / "),
      rationale: "Separates hard-shell, soft-shell, hybrid, and material demand signals.",
    },
    {
      key: "form_factor",
      label: "Form factor",
      value: formatValue(item.luggage_form_factor),
      rationale: "Segments spinner suitcase, duffel, backpack, carton, and other shapes.",
    },
    {
      key: "wheels",
      label: "Wheels",
      value: `${formatValue(wheels?.count)} ${formatValue(wheels?.type)}`,
      rationale: "Helps compare spinner, inline, and no-wheel preferences.",
    },
    {
      key: "locks",
      label: "Lock features",
      value: lockFeatures.length ? lockFeatures.join(", ") : "No lock visible",
      rationale: "Useful for TSA-lock and security-feature demand planning.",
    },
    {
      key: "brand_guess",
      label: "Brand signal",
      value: [item.brand_guess, item.brand_confidence].filter(Boolean).map(formatValue).join(" · "),
      rationale: "Supports brand drill-down only when visible make/logo is reliable.",
    },
    {
      key: "overall_condition",
      label: "Condition",
      value: formatValue(item.overall_condition),
      rationale: "Feeds quality, claims, and design durability analytics.",
    },
  ];
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

function identityDecision(identity: JsonObject | null, newView: BaggageView) {
  const issueSlots = identityIssueSlots(identity, newView);
  if (!identity) {
    return {
      accepted: false,
      warning: "",
      issueSlots,
      reason: "Could not verify that this photo belongs to the same suitcase. Retake it.",
    };
  }

  const score = scoreIdentityEvidence(identity);
  const evidence = identityEvidence(identity);
  const hardMismatchReasons = hardIdentityMismatchReasons(identity, score);
  const confidence = String(identity.confidence ?? "").toLowerCase();
  const scoreText = formatPercent(score.score);

  if (identity.same_baggage !== true) {
    return {
      accepted: false,
      warning: "",
      issueSlots,
      reason:
        operatorIdentityMessage(identity) ||
        evidence.join(" ") ||
        `${titleCase(newView)} appears to show a different suitcase. Retake this photo.`,
    };
  }

  if (hardMismatchReasons.length > 0) {
    return {
      accepted: false,
      warning: "",
      issueSlots,
      reason: `Identity mismatch detected (${scoreText} score): ${hardMismatchReasons.join(" ")}`,
    };
  }

  if (confidence === "low") {
    return {
      accepted: false,
      warning: "",
      issueSlots,
      reason: `Same-suitcase confidence is low (${scoreText} score). Retake this photo with clearer shared identity details.`,
    };
  }

  if (score.observableWeight < IDENTITY_MIN_OBSERVABLE_WEIGHT) {
    return {
      accepted: false,
      warning: "",
      issueSlots,
      reason: `Not enough shared identity evidence is visible. Observable score weight is ${score.observableWeight}; need at least ${IDENTITY_MIN_OBSERVABLE_WEIGHT}. Retake this photo with color/material/wheels/handles or a unique tag visible.`,
    };
  }

  if (score.score < IDENTITY_ACCEPT_SCORE) {
    return {
      accepted: false,
      warning: "",
      issueSlots,
      reason: `Same-suitcase score is too low (${scoreText}). Retake this photo so it clearly matches the previously captured suitcase.`,
    };
  }

  const warning =
    score.score < IDENTITY_STRONG_SCORE
      ? `Same-suitcase check passed with review score ${scoreText}. ${evidence.join(" ")}`
      : "";

  return {
    accepted: true,
    warning: warning.trim(),
    issueSlots: [] as BaggageView[],
    reason: "",
  };
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

function scoreIdentityEvidence(identity: JsonObject) {
  const features = Array.isArray(identity.feature_scores)
    ? identity.feature_scores.map(toObject).filter((item): item is JsonObject => Boolean(item))
    : [];

  let observableWeight = 0;
  let matchedWeight = 0;
  let mismatchedWeight = 0;
  let unknownWeight = 0;
  const mismatches: string[] = [];

  for (const feature of features) {
    const observable = feature.observable === true;
    const weight = identityFeatureWeight(feature);
    const match = String(feature.match ?? "").toLowerCase();
    const name = String(feature.feature ?? "feature");
    const evidence = String(feature.evidence ?? "").trim();

    if (!observable || weight <= 0) continue;

    observableWeight += weight;
    if (match === "match") matchedWeight += weight;
    else if (match === "mismatch") {
      mismatchedWeight += weight;
      mismatches.push(evidence ? `${name}: ${evidence}` : `${name}: mismatch`);
    } else {
      unknownWeight += weight;
    }
  }

  const modelScore = numericValue(identity.confidence_score);
  const score =
    observableWeight > 0
      ? matchedWeight / observableWeight
      : modelScore > 0
        ? modelScore
        : fallbackIdentityScore(identity);

  return {
    score: clamp(score, 0, 1),
    observableWeight,
    matchedWeight,
    mismatchedWeight,
    unknownWeight,
    mismatches,
  };
}

function identityFeatureWeight(feature: JsonObject) {
  const featureName = String(feature.feature ?? "").toLowerCase();
  const declared = numericValue(feature.weight);
  const fallbackWeights: Record<string, number> = {
    unique_marks: 30,
    color: 20,
    material: 15,
    texture_pattern: 15,
    wheels: 15,
    handles: 15,
    zipper_pockets_locks: 15,
    shape_proportion: 10,
  };
  return declared > 0 ? declared : (fallbackWeights[featureName] ?? 0);
}

function hardIdentityMismatchReasons(
  identity: JsonObject,
  score: ReturnType<typeof scoreIdentityEvidence>,
) {
  const explicit = Array.isArray(identity.hard_mismatches)
    ? identity.hard_mismatches
        .map(toObject)
        .filter((item): item is JsonObject => Boolean(item))
        .map((item) => {
          const feature = String(item.feature ?? "identity");
          const reason = String(item.reason ?? "").trim();
          return reason ? `${feature}: ${reason}` : `${feature}: hard mismatch`;
        })
    : [];

  return uniqueStrings([...explicit, ...score.mismatches]);
}

function identityEvidence(identity: JsonObject | null) {
  return Array.isArray(identity?.evidence) ? identity.evidence.map(String).filter(Boolean) : [];
}

function operatorIdentityMessage(identity: JsonObject | null) {
  return typeof identity?.operator_message === "string" && identity.operator_message.trim()
    ? identity.operator_message.trim()
    : "";
}

function fallbackIdentityScore(identity: JsonObject) {
  const confidence = String(identity.confidence ?? "").toLowerCase();
  if (confidence === "high") return 0.78;
  if (confidence === "medium") return 0.62;
  return 0.35;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index) => value.trim() && values.indexOf(value) === index);
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

function updateTravelField(
  setTravelContext: Dispatch<SetStateAction<TravelContextForm>>,
  field: keyof TravelContextForm,
  value: string,
) {
  setTravelContext((current) => ({ ...current, [field]: value }));
}

function withBaggageCategorySuggestion(
  form: TravelContextForm,
  analysis: unknown,
): TravelContextForm {
  if (form.baggage_category.trim()) {
    return { ...form, baggage_category_source: "operator_override" };
  }

  const suggestion = suggestBaggageCategory(analysis);
  if (!suggestion) return form;
  return {
    ...form,
    baggage_category: suggestion,
    baggage_category_source: "system",
  };
}

function suggestBaggageCategory(analysis: unknown) {
  const item = toObject(analysis);
  if (!item) return null;

  const formFactor = String(item.luggage_form_factor ?? item.bag_type ?? "").toLowerCase();
  if (
    formFactor.includes("carton") ||
    formFactor.includes("garment") ||
    formFactor.includes("sports")
  ) {
    return "special";
  }

  const dimensions = toObject(item.dimensions_cm);
  const width = positiveNumberValue(dimensions?.width);
  const height = positiveNumberValue(dimensions?.height);
  const depth = positiveNumberValue(dimensions?.depth);
  if (width == null || height == null || depth == null) return null;

  const linear = width + height + depth;
  const cabinCandidate = linear <= 115 && height <= 56 && width <= 45 && depth <= 25;
  return cabinCandidate ? "cabin" : "check-in";
}

function compactTravelContext(form: TravelContextForm): TravelContext | null {
  const category = textOrNull(form.baggage_category);
  const context: TravelContext = {
    pnr: textOrNull(form.pnr),
    airline: textOrNull(form.airline),
    flight_number: textOrNull(form.flight_number),
    flight_date: textOrNull(form.flight_date),
    departure_airport: textOrNull(form.departure_airport),
    arrival_airport: textOrNull(form.arrival_airport),
    terminal: textOrNull(form.terminal),
    bag_tag: textOrNull(form.bag_tag),
    baggage_category: category,
    baggage_category_source: category ? form.baggage_category_source || "operator_override" : null,
    weight_kg: positiveNumberOrNull(form.weight_kg),
    special_handling: textOrNull(form.special_handling),
  };
  return Object.values(context).some((value) => value != null) ? context : null;
}

function textOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function positiveNumberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
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
