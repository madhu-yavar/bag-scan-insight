import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  BarChart3,
  Briefcase,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Factory,
  Gauge,
  Image,
  Loader2,
  PackageSearch,
  Plane,
  Ruler,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { hasSupabaseConfig, supabase } from "@/integrations/supabase/client";
import { requireSignedIn } from "@/lib/auth-helpers";
import { getCloudAnalytics, type CloudAnalytics } from "@/lib/cloud-scan-store.functions";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
  },
  head: () => ({
    meta: [
      { title: "Analytics dashboard - BagScan" },
      {
        name: "description",
        content: "Role-based baggage analytics for operations, claims, product, and service teams.",
      },
    ],
  }),
  component: DashboardPage,
});

type DistributionItem = { label: string; count: number };
type IconType = ComponentType<{ className?: string }>;
type DashboardView = "airline" | "airport" | "insurance" | "manufacturing" | "service";
type TravelRecord = CloudAnalytics["travelRecords"][number];
type TravelLoadItem = CloudAnalytics["flightLoads"][number];
type AirlineFilters = {
  airline: string;
  date: string;
  airport: string;
  terminal: string;
};
type TravelRecordSummary = {
  scans: number;
  pnrLinkedScans: number;
  uniquePnrs: number;
  uniqueFlights: number;
  uniqueAirlines: number;
  weightedScans: number;
  totalWeightKg: number | null;
  avgWeightKg: number | null;
  dimensionReadyScans: number;
  oversizeCandidates: number;
  highVolumeCandidates: number;
  avgLinearCm: number | null;
  pnrReadiness: number | null;
};
type Prescription = {
  title: string;
  detail: string;
  tone?: "primary" | "accent" | "warning";
};
const DASHBOARD_REFRESH_INTERVAL_MS = 15_000;

const VIEWS: Array<{
  key: DashboardView;
  label: string;
  owner: string;
  icon: IconType;
}> = [
  { key: "airline", label: "Airline", owner: "Flight load planning", icon: Plane },
  { key: "airport", label: "Airport", owner: "Terminal readiness", icon: Gauge },
  { key: "insurance", label: "Insurance", owner: "Claims evidence", icon: ClipboardCheck },
  { key: "manufacturing", label: "Manufacturer", owner: "Product quality", icon: Factory },
  { key: "service", label: "Customer Service", owner: "Passenger support", icon: Users },
];

function DashboardPage() {
  const loadAnalytics = useServerFn(getCloudAnalytics);
  const refreshInFlightRef = useRef(false);
  const [analytics, setAnalytics] = useState<CloudAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAnalytics = useCallback(
    async (initial = false) => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const result = await loadAnalytics();
        setAnalytics(result.analytics);
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load dashboard analytics.");
      } finally {
        refreshInFlightRef.current = false;
        if (initial) setLoading(false);
        else setRefreshing(false);
      }
    },
    [loadAnalytics],
  );

  useEffect(() => {
    let active = true;
    refreshAnalytics(true).finally(() => {
      if (!active) return;
    });

    return () => {
      active = false;
    };
  }, [refreshAnalytics]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refreshAnalytics(false);
    };
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === "bagscan:last-scan-saved") void refreshAnalytics(false);
    };

    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("bagscan:scan-saved", refreshIfVisible);
    window.addEventListener("storage", refreshFromStorage);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("bagscan:scan-saved", refreshIfVisible);
      window.removeEventListener("storage", refreshFromStorage);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshAnalytics]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshAnalytics(false);
    }, DASHBOARD_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [refreshAnalytics]);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <DashboardTopNav />
      <main className="min-h-[calc(100vh-56px)] bg-background">
        <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
          {loading ? (
            <div className="mt-24 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="mt-8 rounded-md border border-destructive/40 bg-card p-4 text-sm text-destructive">
              {error}
            </div>
          ) : analytics ? (
            <DashboardContent
              analytics={analytics}
              lastUpdatedAt={lastUpdatedAt}
              refreshing={refreshing}
              onRefresh={() => void refreshAnalytics(false)}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function DashboardTopNav() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <header className="h-14 border-b border-border bg-background">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 sm:px-8">
        <Link to="/dashboard" className="flex items-center gap-3">
          <div className="grid h-5 w-5 place-items-center rounded-sm border border-primary text-primary">
            <span className="h-2 w-2 rounded-[2px] border border-primary" />
          </div>
          <span className="text-base font-semibold text-foreground">BagScan</span>
        </Link>
        <nav className="hidden h-full items-center gap-8 md:flex">
          <Link
            to="/dashboard"
            className="relative flex h-full items-center text-[13px] font-medium uppercase tracking-wide text-primary"
          >
            Dashboard
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
          </Link>
          <Link
            to="/scan-local"
            className="flex h-full items-center text-[13px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            New scan
          </Link>
          <Link
            to="/reports-local"
            className="flex h-full items-center text-[13px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            Saved reports
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <Link
            to="/scan-local"
            className="inline-flex h-9 items-center rounded-md border border-primary px-3 text-[13px] font-medium uppercase tracking-[0.08em] text-primary transition-colors hover:bg-surface-2 md:hidden"
          >
            New scan
          </Link>
          <span className="hidden max-w-[180px] truncate sm:inline">
            {user?.email ?? "ops@bagscan.com"}
          </span>
          <span className="hidden h-5 w-px bg-border sm:block" />
          <button
            className="transition-colors hover:text-foreground"
            type="button"
            onClick={signOut}
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

function DashboardContent({
  analytics,
  lastUpdatedAt,
  refreshing,
  onRefresh,
}: {
  analytics: CloudAnalytics;
  lastUpdatedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [activeView, setActiveView] = useState<DashboardView>("airline");

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <RoleTabs activeView={activeView} onChange={setActiveView} />
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {lastUpdatedAt ? (
            <span className="text-[12px] text-muted-foreground">
              Data refreshed {formatTime(lastUpdatedAt)}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-md border-border bg-transparent text-[13px] text-foreground hover:border-secondary hover:bg-surface-2"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BarChart3 className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {analytics.totals.scans === 0 ? (
        <EmptyState />
      ) : (
        <RolePanel view={activeView} analytics={analytics} />
      )}
    </div>
  );
}

function RoleTabs({
  activeView,
  onChange,
}: {
  activeView: DashboardView;
  onChange: (view: DashboardView) => void;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-card p-1 md:grid-cols-5">
      {VIEWS.map((view) => {
        const active = view.key === activeView;
        const Icon = view.icon;
        return (
          <button
            key={view.key}
            className={`rounded-md px-3 py-2 text-left transition-colors duration-150 ${
              active
                ? "bg-surface-2 text-foreground ring-1 ring-primary/60"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
            type="button"
            onClick={() => onChange(view.key)}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-primary" />
              <span className="text-[13px] font-medium">{view.label}</span>
            </div>
            <div
              className={`mt-0.5 text-[11px] ${active ? "text-muted-foreground" : "text-muted-foreground/70"}`}
            >
              {view.owner}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RolePanel({ view, analytics }: { view: DashboardView; analytics: CloudAnalytics }) {
  if (view === "airline") return <AirlineView analytics={analytics} />;
  if (view === "airport") return <AirportView analytics={analytics} />;
  if (view === "insurance") return <InsuranceView analytics={analytics} />;
  if (view === "manufacturing") return <ManufacturingView analytics={analytics} />;
  return <ServiceView analytics={analytics} />;
}

function AirlineView({ analytics }: { analytics: CloudAnalytics }) {
  const [airline, setAirline] = useState("all");
  const [date, setDate] = useState("all");
  const [airport, setAirport] = useState("all");
  const [terminal, setTerminal] = useState("all");
  const filters = useMemo(
    () => ({ airline, date, airport, terminal }),
    [airline, airport, date, terminal],
  );
  const scopedRecords = useMemo(
    () => filterTravelRecords(analytics.travelRecords, filters),
    [analytics.travelRecords, filters],
  );
  const scopedSummary = useMemo(() => summarizeTravelRecords(scopedRecords), [scopedRecords]);
  const flightLoads = useMemo(
    () => groupedRecordLoads(scopedRecords, flightRecordLabel),
    [scopedRecords],
  );
  const airportLoads = useMemo(
    () => groupedRecordLoads(scopedRecords, airportRecordLabel),
    [scopedRecords],
  );
  const terminalLoads = useMemo(
    () => groupedRecordLoads(scopedRecords, terminalRecordLabel),
    [scopedRecords],
  );
  const categoryDistribution = useMemo(
    () => distributionFromRecords(scopedRecords, "baggageCategory"),
    [scopedRecords],
  );
  return (
    <section className="space-y-6">
      <RoleIntro
        icon={Plane}
        title="Airline baggage planning"
        description="Plan baggage load by flight, airport, terminal, category, size, and captured weight."
        action={
          <Button
            variant="outline"
            className="h-9 rounded-md border-border bg-transparent px-3 text-[13px] font-medium uppercase tracking-[0.08em] text-foreground hover:border-secondary hover:bg-surface-2"
            onClick={() => downloadAirlineReport(scopedRecords, filters)}
            disabled={scopedRecords.length === 0}
          >
            <Download className="mr-2 h-3.5 w-3.5 text-primary" />
            Download report
          </Button>
        }
      />
      <FilterBar
        filters={[
          {
            label: "Date",
            value: date,
            onChange: setDate,
            options: analytics.filterOptions.flightDates,
          },
          {
            label: "Airline",
            value: airline,
            onChange: setAirline,
            options: analytics.filterOptions.airlines,
          },
          {
            label: "Airport",
            value: airport,
            onChange: setAirport,
            options: analytics.filterOptions.airports,
          },
          {
            label: "Terminal",
            value: terminal,
            onChange: setTerminal,
            options: analytics.filterOptions.terminals,
          },
        ]}
      />
      <MetricGrid>
        <MetricCard
          icon={Briefcase}
          label="Scope coverage"
          value={scopedSummary.scans}
          helper={`${scopedSummary.pnrLinkedScans} PNR-linked records`}
          tone="accent"
        />
        <MetricCard
          icon={Plane}
          label="Flights planned"
          value={scopedSummary.uniqueFlights}
          helper={`${scopedSummary.uniqueAirlines} airlines in selected data`}
        />
        <MetricCard
          icon={BarChart3}
          label="Bags captured"
          value={scopedSummary.scans}
          helper={`${topLabel(categoryDistribution)} is the leading category`}
        />
        <MetricCard
          icon={Gauge}
          label="Captured weight"
          value={formatKg(scopedSummary.totalWeightKg)}
          helper={`${scopedSummary.weightedScans} bags with manual weight`}
        />
      </MetricGrid>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <AirlinePlanningReadiness summary={scopedSummary} />
        <FlightDistributionPanel title="Flight baggage distribution" items={flightLoads} />
      </div>
      <PrescriptionPanel
        title="Airline prescriptions"
        items={airlinePrescriptions(scopedSummary, flightLoads, filters)}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <AirportDistributionPanel items={airportLoads} />
        <TerminalPressurePanel items={terminalLoads} />
      </div>
    </section>
  );
}

function AirportView({ analytics }: { analytics: CloudAnalytics }) {
  const [airport, setAirport] = useState("all");
  const [terminal, setTerminal] = useState("all");
  const airportRecords = useMemo(
    () =>
      analytics.travelRecords.filter((record) => {
        const airportMatch =
          airport === "all" ||
          record.departureAirport === airport ||
          record.arrivalAirport === airport;
        const terminalMatch = terminal === "all" || record.terminal === terminal;
        return airportMatch && terminalMatch;
      }),
    [airport, analytics.travelRecords, terminal],
  );
  const airportSummary = useMemo(() => summarizeTravelRecords(airportRecords), [airportRecords]);
  const airportLoads = useMemo(
    () => groupedRecordLoads(airportRecords, airportRecordLabel),
    [airportRecords],
  );
  const terminalLoads = useMemo(
    () => groupedRecordLoads(airportRecords, terminalRecordLabel),
    [airportRecords],
  );
  const airportCategories = useMemo(
    () => distributionFromRecords(airportRecords, "baggageCategory"),
    [airportRecords],
  );
  const airportSizeClasses = useMemo(
    () => distributionFromRecords(airportRecords, "sizeClass"),
    [airportRecords],
  );

  return (
    <section className="space-y-6">
      <RoleIntro
        icon={Gauge}
        title="Airport baggage readiness"
        description="Prepare terminal capacity, baggage belts, screening queues, ground movement, and exception desks from airline and terminal-level baggage flow."
      />
      <FilterBar
        filters={[
          {
            label: "Airport",
            value: airport,
            onChange: setAirport,
            options: analytics.filterOptions.airports,
          },
          {
            label: "Terminal",
            value: terminal,
            onChange: setTerminal,
            options: analytics.filterOptions.terminals,
          },
        ]}
      />
      <MetricGrid>
        <MetricCard
          icon={Plane}
          label="Airlines"
          value={airportSummary.uniqueAirlines}
          helper={`${airportSummary.uniqueFlights} flight groups represented`}
        />
        <MetricCard
          icon={TriangleAlert}
          label="Oversize candidates"
          value={airportSummary.oversizeCandidates}
          helper={`${formatCm(airportSummary.avgLinearCm)} average linear size`}
          tone="warning"
        />
        <MetricCard
          icon={Briefcase}
          label="Check-in pressure"
          value={topLabel(airportCategories)}
          helper={`${airportSummary.scans} scanned baggage records`}
        />
        <MetricCard
          icon={Activity}
          label="Planning readiness"
          value={formatPercent(airportSummary.pnrReadiness)}
          helper="PNR, flight, and weight coverage"
        />
      </MetricGrid>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <PlanningReadiness summary={airportSummary} />
        <TerminalPressurePanel items={terminalLoads} />
      </div>
      <PrescriptionPanel
        title="Airport prescriptions"
        items={airportPrescriptions(airportSummary, terminalLoads, airportLoads)}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <AirportDistributionPanel items={airportLoads} />
        <DistributionBarPanel
          title="Size pressure"
          icon={Ruler}
          items={airportSizeClasses}
          emptyLabel="No size classes yet"
        />
      </div>
    </section>
  );
}

function InsuranceView({ analytics }: { analytics: CloudAnalytics }) {
  return (
    <section className="space-y-6">
      <RoleIntro
        icon={ClipboardCheck}
        title="Insurance claims"
        description="Assess evidence completeness, damage patterns, condition at capture, and cases that need human review."
      />
      <MetricGrid>
        <MetricCard
          icon={TriangleAlert}
          label="Damage findings"
          value={analytics.totals.damages}
          helper={`${formatPercent(analytics.operational.damageRate)} findings per scan`}
          tone="warning"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Evidence quality"
          value={formatPercent(analytics.totals.avgQualityScore)}
          helper="Average capture quality"
          tone="accent"
        />
        <MetricCard
          icon={Activity}
          label="Needs review"
          value={analytics.totals.needsReview}
          helper={`${formatPercent(analytics.operational.reviewRate)} of scans`}
        />
        <MetricCard
          icon={Image}
          label="Photo evidence"
          value={analytics.totals.photos}
          helper="Captured image records"
        />
      </MetricGrid>
      <div className="grid gap-6 lg:grid-cols-3">
        <DistributionDonutPanel
          title="Damage severity"
          icon={TriangleAlert}
          items={analytics.damageSeverity}
          emptyLabel="No damage recorded"
        />
        <DistributionBarPanel
          title="Condition at scan"
          icon={Activity}
          items={analytics.conditions}
          emptyLabel="No condition data yet"
        />
        <QualityPanel analytics={analytics} />
      </div>
      <PrescriptionPanel title="Claims prescriptions" items={insurancePrescriptions(analytics)} />
    </section>
  );
}

function ManufacturingView({ analytics }: { analytics: CloudAnalytics }) {
  return (
    <section className="space-y-6">
      <RoleIntro
        icon={Factory}
        title="Baggage manufacturer insights"
        description="Understand product mix, material performance, condition trends, and damage patterns that can influence design standards."
      />
      <MetricGrid>
        <MetricCard
          icon={Briefcase}
          label="Detected brands"
          value={knownItemCount(analytics.brands)}
          helper="Visible make or logo only"
        />
        <MetricCard
          icon={PackageSearch}
          label="Product types"
          value={knownItemCount(
            analytics.formFactors.length ? analytics.formFactors : analytics.bagTypes,
          )}
          helper="Classified baggage shapes"
        />
        <MetricCard
          icon={Activity}
          label="Top condition"
          value={topLabel(analytics.conditions)}
          helper="Most frequent condition"
          tone="accent"
        />
        <MetricCard
          icon={TriangleAlert}
          label="Damage rate"
          value={formatPercent(analytics.operational.damageRate)}
          helper={`${analytics.totals.damages} findings across scans`}
          tone="warning"
        />
      </MetricGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        <DistributionBarPanel
          title="Visible brand signals"
          icon={Factory}
          items={analytics.brands}
          emptyLabel="No visible brand signals yet"
        />
        <DistributionDonutPanel
          title="Form factor mix"
          icon={Briefcase}
          items={analytics.formFactors}
          emptyLabel="No form-factor data yet"
        />
        <DistributionBarPanel
          title="Baggage type mix"
          icon={BarChart3}
          items={analytics.bagTypes}
          emptyLabel="No baggage types yet"
        />
        <DistributionBarPanel
          title="Material mix"
          icon={PackageSearch}
          items={analytics.materials}
          emptyLabel="No materials yet"
        />
      </div>
      <PrescriptionPanel
        title="Manufacturing prescriptions"
        items={manufacturingPrescriptions(analytics)}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <DistributionBarPanel
          title="Condition trend"
          icon={Activity}
          items={analytics.conditions}
          emptyLabel="No condition data yet"
        />
        <DistributionDonutPanel
          title="Damage severity"
          icon={TriangleAlert}
          items={analytics.damageSeverity}
          emptyLabel="No damage recorded"
        />
      </div>
    </section>
  );
}

function ServiceView({ analytics }: { analytics: CloudAnalytics }) {
  return (
    <section className="space-y-6">
      <RoleIntro
        icon={Users}
        title="Customer service"
        description="Prioritize baggage reviews, answer customer questions faster, and maintain a clear evidence trail."
      />
      <MetricGrid>
        <MetricCard
          icon={CheckCircle2}
          label="Completed scans"
          value={analytics.totals.completed}
          helper={`${analytics.totals.scans} total records`}
          tone="accent"
        />
        <MetricCard
          icon={TriangleAlert}
          label="Review queue"
          value={analytics.totals.needsReview}
          helper="Cases needing staff attention"
          tone="warning"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Capture quality"
          value={formatPercent(analytics.totals.avgQualityScore)}
          helper="Photo clarity and completeness"
        />
        <MetricCard
          icon={Image}
          label="Photo evidence"
          value={analytics.totals.photos}
          helper="Available customer-facing proof"
        />
      </MetricGrid>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <QualityPanel analytics={analytics} />
        <RecentScans scans={analytics.recentScans} />
      </div>
      <PrescriptionPanel title="Service prescriptions" items={servicePrescriptions(analytics)} />
    </section>
  );
}

function RoleIntro({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: IconType;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-6">
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-primary/45 bg-transparent text-primary">
          <Icon className="h-10 w-10" />
        </div>
        <div>
          <h1 className="font-sans text-2xl font-semibold leading-8 tracking-normal text-foreground">
            {title}
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

function FilterBar({
  filters,
}: {
  filters: Array<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
  }>;
}) {
  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-5">
      {filters.map((filter) => (
        <label key={filter.label} className="grid gap-2">
          <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
            {filter.label}
          </span>
          <select
            className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
          >
            <option value="all">All</option>
            {filter.options.map((option) => (
              <option key={option} value={option}>
                {formatLabel(option)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function PrescriptionPanel({ title, items }: { title: string; items: Prescription[] }) {
  return (
    <section className="rounded-md border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-primary">
          {title}
        </h3>
        <div className="grid h-6 w-6 place-items-center rounded-md border border-success/30 bg-success/15 text-success">
          <ClipboardCheck className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-5 grid gap-0 md:grid-cols-3 md:divide-x md:divide-border">
        {items.map((item) => (
          <div key={item.title} className="px-6 py-1 first:pl-0 last:pr-0">
            <div className="flex items-start gap-3">
              <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotTone(item.tone)}`} />
              <div>
                <div className="text-sm font-semibold uppercase tracking-wide text-foreground">
                  {item.title}
                </div>
                <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function airlinePrescriptions(
  summary: TravelRecordSummary,
  flightLoads: TravelLoadItem[],
  filters: AirlineFilters,
): Prescription[] {
  const topFlight = flightLoads[0];
  return [
    topFlight
      ? {
          title: "Plan by flight load",
          detail: `${topFlight.label} has ${topFlight.count} scanned bags and ${formatKg(
            topFlight.totalWeightKg,
          )} captured weight in ${airlineScopeLabel(
            filters,
          )}. Use this for staff, gate, belt, and internal transport planning.`,
          tone: topFlight.oversizeCount > 0 ? "warning" : "accent",
        }
      : {
          title: "No records in selected scope",
          detail: "Change the airline/date/flight filters or capture travel context during scan.",
          tone: "warning",
        },
    {
      title: "Watch exception baggage",
      detail: `${summary.oversizeCandidates} oversize and ${summary.highVolumeCandidates} high-volume bags may need gate, loading, or internal transport attention.`,
      tone:
        summary.oversizeCandidates > 0 || summary.highVolumeCandidates > 0 ? "warning" : "accent",
    },
    {
      title: "Improve load planning readiness",
      detail: `${formatPercent(
        summary.pnrReadiness,
      )} of scans have PNR, flight, and weight. Fuel planning remains advisory until integrated with airline load-control data.`,
      tone: (summary.pnrReadiness ?? 0) >= 0.8 ? "accent" : "primary",
    },
  ];
}

function airportPrescriptions(
  summary: TravelRecordSummary,
  terminalLoads: TravelLoadItem[],
  airportLoads: TravelLoadItem[],
): Prescription[] {
  const topTerminal = terminalLoads[0];
  return [
    topTerminal
      ? {
          title: "Prepare terminal capacity",
          detail: `${topTerminal.label} has ${topTerminal.count} scanned bags and ${
            topTerminal.oversizeCount
          } oversize candidates. Use this for belt, screening, and porter allocation.`,
          tone: topTerminal.oversizeCount > 0 ? "warning" : "accent",
        }
      : {
          title: "Capture airport context",
          detail:
            "Airport and terminal fields are missing. Operators should capture departure airport and terminal for infrastructure planning.",
          tone: "warning",
        },
    {
      title: "Balance airline peaks",
      detail:
        airportLoads.length > 0
          ? `${airportLoads.length} airport groups are visible. Compare their baggage mix before assigning shared baggage belts and exception desks.`
          : "Airline distribution is not available yet. Capture airline and flight number during scan.",
      tone: airportLoads.length > 0 ? "primary" : "warning",
    },
    {
      title: "Stage exception handling",
      detail: `${summary.oversizeCandidates} oversize and ${summary.highVolumeCandidates} high-volume bags should be planned before queue buildup.`,
      tone:
        summary.oversizeCandidates > 0 || summary.highVolumeCandidates > 0 ? "warning" : "accent",
    },
  ];
}

function insurancePrescriptions(analytics: CloudAnalytics): Prescription[] {
  return [
    analytics.totals.damages > 0
      ? {
          title: "Prioritize visible damage",
          detail: `${analytics.totals.damages} damage findings are available. Route high-severity cases to adjuster review first.`,
          tone: "warning",
        }
      : {
          title: "No visible damage trend",
          detail:
            "Current scans show no recorded damage findings. Claims should still check photo completeness before closure.",
          tone: "accent",
        },
    {
      title: "Validate evidence quality",
      detail:
        (analytics.totals.avgQualityScore ?? 0) >= 0.75
          ? `Average evidence quality is ${formatPercent(
              analytics.totals.avgQualityScore,
            )}. The scan set is usable for first-level claim review.`
          : `Average evidence quality is ${formatPercent(
              analytics.totals.avgQualityScore,
            )}. Ask for retakes before claim decisioning.`,
      tone: (analytics.totals.avgQualityScore ?? 0) >= 0.75 ? "accent" : "warning",
    },
    {
      title: "Separate review queue",
      detail: `${analytics.totals.needsReview} scans need manual review because of capture, identity, or validation uncertainty.`,
      tone: analytics.totals.needsReview > 0 ? "warning" : "accent",
    },
  ];
}

function manufacturingPrescriptions(analytics: CloudAnalytics): Prescription[] {
  const brand = topItem(analytics.brands);
  const type = topItem(analytics.formFactors.length ? analytics.formFactors : analytics.bagTypes);
  const condition = topItem(analytics.conditions);
  return [
    {
      title: "Track visible make",
      detail: brand
        ? `${formatLabel(brand.label)} is the strongest visible brand signal. Use this for portfolio and competitor benchmarking only when logo confidence is clear.`
        : "No visible make is detected yet. Operators need clearer logo/text photos for manufacturer analytics.",
      tone: brand ? "primary" : "warning",
    },
    {
      title: "Segment product design",
      detail: type
        ? `${formatLabel(type.label)} is the leading form factor. Compare dimensions, material, and damage concentration for this segment.`
        : "Form-factor mix is not mature yet. Capture more bags before design decisions.",
      tone: type ? "accent" : "warning",
    },
    {
      title: "Review quality standard",
      detail: condition
        ? `${formatLabel(condition.label)} is the most common condition. Damage rate is ${formatPercent(
            analytics.operational.damageRate,
          )}, which should feed product quality thresholds.`
        : "Condition trend is not mature yet. Capture more bags before making manufacturing decisions.",
      tone: (analytics.operational.damageRate ?? 0) > 0.15 ? "warning" : "primary",
    },
  ];
}

function servicePrescriptions(analytics: CloudAnalytics): Prescription[] {
  const recent = analytics.recentScans[0];
  return [
    {
      title: "Work the review queue",
      detail:
        analytics.totals.needsReview > 0
          ? `${analytics.totals.needsReview} customer cases need staff action before response or closure.`
          : "No scans are currently waiting for manual review.",
      tone: analytics.totals.needsReview > 0 ? "warning" : "accent",
    },
    {
      title: "Use PNR grouping in support",
      detail:
        analytics.travel.uniquePnrs > 0
          ? `${analytics.travel.uniquePnrs} PNR groups are available. Agents can connect multiple bags to the same customer journey.`
          : "PNR is missing. Ask operators to capture it so service can see all bags for the same journey.",
      tone: analytics.travel.uniquePnrs > 0 ? "accent" : "warning",
    },
    {
      title: "Respond from latest evidence",
      detail: recent
        ? `${recent.reference || recent.bagType || "Latest scan"} has ${
            recent.imageCount
          } photos and can be opened from recent customer cases.`
        : "Complete a scan before customer service can use evidence-based responses.",
      tone: recent ? "primary" : "warning",
    },
  ];
}

function dotTone(tone: Prescription["tone"] = "primary") {
  if (tone === "accent") return "bg-success";
  if (tone === "warning") return "bg-warning";
  return "bg-primary";
}

function MetricGrid({ children }: { children: ReactNode }) {
  return <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</section>;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
  tone = "primary",
}: {
  icon: IconType;
  label: string;
  value: string | number;
  helper: string;
  tone?: "primary" | "accent" | "warning";
}) {
  const toneClass =
    tone === "accent"
      ? "border-border bg-surface-2 text-success"
      : tone === "warning"
        ? "border-border bg-surface-2 text-warning"
        : "border-border bg-surface-2 text-primary";

  return (
    <div className="rounded-md border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase leading-4 tracking-[0.1em] text-primary">
            {label}
          </div>
          <div className="mt-6 truncate font-mono text-[36px] font-medium leading-10 tracking-[-0.01em] text-foreground">
            {value}
          </div>
        </div>
        <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-4 text-[13px] leading-5 text-muted-foreground">{helper}</div>
    </div>
  );
}

function PlanningReadiness({ summary }: { summary: TravelRecordSummary }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-muted-foreground">
        Prediction inputs
      </h3>
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        PNR, flight, terminal, dimensions, and manual weight combine into the first planning signal.
      </p>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-[13px] text-muted-foreground">Planning readiness</span>
          <span className="font-mono text-[28px] font-medium leading-8 text-foreground">
            {formatPercent(summary.pnrReadiness)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.round((summary.pnrReadiness ?? 0) * 100)}%` }}
          />
        </div>
      </div>
      <div className="mt-5 grid gap-2 text-sm">
        <PlanningRow
          label="Dimension coverage"
          value={`${summary.dimensionReadyScans} scans with dimensions`}
        />
        <PlanningRow label="PNR coverage" value={`${summary.pnrLinkedScans} scans`} />
        <PlanningRow label="Weight captured" value={formatKg(summary.totalWeightKg)} />
        <PlanningRow
          label="Volume pressure"
          value={`${summary.highVolumeCandidates} high-volume bags`}
        />
        <PlanningRow label="Avg linear size" value={formatCm(summary.avgLinearCm)} />
      </div>
    </div>
  );
}

function AirlinePlanningReadiness({ summary }: { summary: TravelRecordSummary }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-muted-foreground">
        Selected-scope readiness
      </h3>
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        These signals recalculate from the active date, airline, airport, terminal, and flight
        filters.
      </p>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-[13px] text-muted-foreground">Planning readiness</span>
          <span className="font-mono text-[28px] font-medium leading-8 text-foreground">
            {formatPercent(summary.pnrReadiness)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.round((summary.pnrReadiness ?? 0) * 100)}%` }}
          />
        </div>
      </div>
      <div className="mt-5 grid gap-2 text-sm">
        <PlanningRow label="Selected records" value={`${summary.scans} bags`} />
        <PlanningRow
          label="Dimension coverage"
          value={`${summary.dimensionReadyScans} scans with dimensions`}
        />
        <PlanningRow label="PNR coverage" value={`${summary.pnrLinkedScans} scans`} />
        <PlanningRow label="Weight captured" value={formatKg(summary.totalWeightKg)} />
        <PlanningRow
          label="Exception pressure"
          value={`${summary.oversizeCandidates} oversize · ${summary.highVolumeCandidates} high-volume`}
        />
      </div>
    </div>
  );
}

function PlanningRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-[13px] text-foreground">{value}</span>
    </div>
  );
}

function ChartFrame({
  title,
  icon: Icon = BarChart3,
  children,
  className = "",
}: {
  title: string;
  icon?: IconType;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-border bg-card p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-muted-foreground">
          {title}
        </h3>
        <div className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface-2 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function EmptyChartMessage({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-5 text-muted-foreground">{children}</p>;
}

function FlightDistributionPanel({ title, items }: { title: string; items: TravelLoadItem[] }) {
  const rows = items.slice(0, 6);
  const maxCount = Math.max(...rows.map((item) => item.count), 1);
  return (
    <ChartFrame title={title} icon={Plane}>
      {rows.length === 0 ? (
        <EmptyChartMessage>
          Add airline, flight, airport, terminal, and weight during scan capture.
        </EmptyChartMessage>
      ) : (
        <div className="overflow-hidden">
          <div className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr] gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
            <span>Flight</span>
            <span>Bags (kg)</span>
            <span>Vs capacity</span>
            <span>Status</span>
          </div>
          {rows.map((item) => {
            const pressure = item.count / maxCount;
            const hasException = item.oversizeCount > 0 || item.highVolumeCount > 0;
            return (
              <div
                key={item.label}
                className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr] gap-3 border-b border-border px-3 py-3 text-[13px] last:border-b-0 hover:bg-surface-2/60"
              >
                <div className="min-w-0 truncate text-foreground">{item.label}</div>
                <div className="font-mono text-foreground">
                  {item.count} · {formatKg(item.totalWeightKg)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-10 font-mono text-muted-foreground">
                    {formatPercent(pressure)}
                  </span>
                  <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${
                        hasException ? "bg-warning" : "bg-primary"
                      }`}
                      style={{ width: `${Math.max(8, Math.round(pressure * 100))}%` }}
                    />
                  </div>
                </div>
                <div>
                  <StatusPill
                    status={hasException ? "Review" : "Normal"}
                    tone={hasException ? "warning" : "accent"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartFrame>
  );
}

function AirportDistributionPanel({ items }: { items: TravelLoadItem[] }) {
  const rows = loadChartData(items).slice(0, 5);
  const max = Math.max(...rows.map((row) => row.bags), 1);
  return (
    <ChartFrame title="Airport distribution" icon={Gauge}>
      {rows.length === 0 ? (
        <EmptyChartMessage>No airport load data in the selected scope.</EmptyChartMessage>
      ) : (
        <div className="overflow-hidden">
          <div className="grid grid-cols-[4.5rem_1fr_0.85fr_4.75rem] gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
            <span>Airport</span>
            <span>Planned bags</span>
            <span>Vs capacity</span>
            <span>Status</span>
          </div>
          {rows.map((row) => {
            const pressure = row.bags / max;
            const hasException = row.alerts > 0;
            return (
              <div
                key={row.label}
                className="grid grid-cols-[4.5rem_1fr_0.85fr_4.75rem] items-center gap-3 border-b border-border px-3 py-3 text-[13px] last:border-b-0"
              >
                <span className="truncate font-mono text-foreground">{row.shortLabel}</span>
                <span className="font-mono text-foreground">
                  {row.weightKg > 0 ? formatKg(row.weightKg) : `${row.bags} bags`}
                </span>
                <div className="flex items-center gap-2">
                  <span className="w-10 font-mono text-muted-foreground">
                    {formatPercent(pressure)}
                  </span>
                  <div className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${hasException ? "bg-warning" : "bg-primary"}`}
                      style={{ width: `${Math.max(6, Math.round(pressure * 100))}%` }}
                    />
                  </div>
                </div>
                <StatusPill
                  status={hasException ? "Watch" : "Normal"}
                  tone={hasException ? "warning" : "success"}
                />
              </div>
            );
          })}
        </div>
      )}
    </ChartFrame>
  );
}

function TerminalPressurePanel({ items }: { items: TravelLoadItem[] }) {
  const rows = loadChartData(items).slice(0, 5);
  const max = Math.max(...rows.map((row) => row.bags), 1);
  return (
    <ChartFrame title="Terminal pressure" icon={Gauge}>
      {rows.length === 0 ? (
        <EmptyChartMessage>No terminal pressure data in the selected scope.</EmptyChartMessage>
      ) : (
        <div className="overflow-hidden">
          <div className="grid grid-cols-[5.5rem_0.8fr_1fr_4.75rem] gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
            <span>Terminal</span>
            <span>Pressure</span>
            <span>Vs threshold</span>
            <span>Status</span>
          </div>
          {rows.map((row) => {
            const pressure = row.bags / max;
            const tone = pressure >= 0.9 ? "danger" : pressure >= 0.7 ? "warning" : "success";
            return (
              <div
                key={row.label}
                className="grid grid-cols-[5.5rem_0.8fr_1fr_4.75rem] items-center gap-3 border-b border-border px-3 py-3 text-[13px] last:border-b-0"
              >
                <span className="truncate font-mono text-foreground">{row.shortLabel}</span>
                <span className="font-mono text-foreground">{formatPercent(pressure)}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${progressToneClass(tone)}`}
                    style={{ width: `${Math.max(6, Math.round(pressure * 100))}%` }}
                  />
                </div>
                <StatusPill
                  status={tone === "success" ? "Normal" : tone === "warning" ? "Watch" : "Critical"}
                  tone={tone === "danger" ? "warning" : tone}
                />
              </div>
            );
          })}
        </div>
      )}
    </ChartFrame>
  );
}

function DistributionDonutPanel({
  title,
  icon,
  items,
  emptyLabel,
}: {
  title: string;
  icon: IconType;
  items: DistributionItem[];
  emptyLabel: string;
}) {
  const data = distributionChartData(items).slice(0, 6);
  return (
    <ChartFrame title={title} icon={icon}>
      {data.length === 0 ? (
        <EmptyChartMessage>{emptyLabel}</EmptyChartMessage>
      ) : (
        <DistributionRows rows={data} />
      )}
    </ChartFrame>
  );
}

function DistributionBarPanel({
  title,
  icon,
  items,
  emptyLabel,
}: {
  title: string;
  icon: IconType;
  items: DistributionItem[];
  emptyLabel: string;
}) {
  const data = distributionChartData(items).slice(0, 8);
  return (
    <ChartFrame title={title} icon={icon}>
      {data.length === 0 ? (
        <EmptyChartMessage>{emptyLabel}</EmptyChartMessage>
      ) : (
        <DistributionRows rows={data} />
      )}
    </ChartFrame>
  );
}

function DistributionRows({ rows }: { rows: ReturnType<typeof distributionChartData> }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="grid gap-0">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 border-b border-border py-2.5 text-[13px] last:border-b-0"
        >
          <span className="truncate text-foreground">{row.shortLabel}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(6, Math.round((row.count / max) * 100))}%` }}
            />
          </div>
          <span className="text-right font-mono text-muted-foreground">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function progressToneClass(tone: "success" | "warning" | "danger") {
  if (tone === "danger") return "bg-destructive";
  if (tone === "warning") return "bg-warning";
  return "bg-success";
}

function StatusPill({ status, tone }: { status: string; tone: "accent" | "success" | "warning" }) {
  const resolvedTone = tone === "accent" ? "success" : tone;
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${
        resolvedTone === "warning" ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
      }`}
    >
      {status}
    </span>
  );
}

function QualityPanel({ analytics }: { analytics: CloudAnalytics }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-muted-foreground">
            Capture quality by view
          </h3>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            Shows which photo angles create the most review friction.
          </p>
        </div>
        <div className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface-2 text-primary">
          <Gauge className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {analytics.viewQuality.map((view) => (
          <ViewQualityRow key={view.view} view={view} />
        ))}
      </div>
    </div>
  );
}

function ViewQualityRow({ view }: { view: CloudAnalytics["viewQuality"][number] }) {
  const score = Math.round((view.avgQualityScore ?? 0) * 100);
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-[13px] capitalize text-foreground">{view.view}</span>
        <span className="font-mono text-[13px] text-foreground">{score || "n/a"}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {view.imageCount} photos · {view.rejectedCount} rejected
      </div>
    </div>
  );
}

function RecentScans({ scans }: { scans: CloudAnalytics["recentScans"] }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase leading-5 tracking-[0.08em] text-muted-foreground">
            Recent customer cases
          </h3>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            Latest scan reports for follow-up.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-md border-border bg-transparent text-[13px] text-foreground hover:border-secondary hover:bg-surface-2"
          asChild
        >
          <Link to="/reports-local">View all</Link>
        </Button>
      </div>
      <div className="mt-5 grid gap-3">
        {scans.map((scan) => (
          <Link
            key={scan.id}
            to="/reports-local/$id"
            params={{ id: scan.id }}
            className="rounded-md border border-border bg-surface-2 p-4 transition-colors hover:border-secondary"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {scan.reference || scan.bagType || "Baggage scan"}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {formatDate(scan.createdAt)}
                </div>
              </div>
              {scan.captureValidationStatus === "needs_review" ||
              scan.captureValidationStatus === "needs_retake" ? (
                <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-background px-2 py-0.5 font-mono text-muted-foreground">
                {scan.imageCount}/4 photos
              </span>
              {scan.bagType ? (
                <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground capitalize">
                  {formatLabel(scan.bagType)}
                </span>
              ) : null}
              {scan.travelContext?.pnr ? (
                <span className="rounded-full bg-background px-2 py-0.5 font-mono text-muted-foreground">
                  PNR {scan.travelContext.pnr}
                </span>
              ) : null}
              {scan.travelContext?.flight_number ? (
                <span className="rounded-full bg-background px-2 py-0.5 font-mono text-muted-foreground">
                  {scan.travelContext.flight_number}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-md border border-border bg-surface-2 text-primary">
        <BarChart3 className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">No analytics data yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-[13px] text-muted-foreground">
        Complete a scan to populate role-based analytics.
      </p>
      <Button
        className="mt-6 h-9 rounded-md bg-primary px-3 text-[13px] text-primary-foreground hover:bg-primary/90"
        asChild
      >
        <Link to="/scan-local">
          <Camera className="mr-2 h-4 w-4" />
          New scan
        </Link>
      </Button>
    </div>
  );
}

function filterTravelRecords(records: TravelRecord[], filters: AirlineFilters) {
  return records.filter((record) => {
    const airlineMatch = filters.airline === "all" || record.airline === filters.airline;
    const dateMatch = filters.date === "all" || record.flightDate === filters.date;
    const airportMatch =
      filters.airport === "all" ||
      record.departureAirport === filters.airport ||
      record.arrivalAirport === filters.airport;
    const terminalMatch = filters.terminal === "all" || record.terminal === filters.terminal;
    return airlineMatch && dateMatch && airportMatch && terminalMatch;
  });
}

function summarizeTravelRecords(records: TravelRecord[]): TravelRecordSummary {
  const weightedRows = records.filter((record) => record.weightKg != null);
  const dimensionRows = records.filter((record) => record.linearCm != null);
  return {
    scans: records.length,
    pnrLinkedScans: records.filter((record) => record.pnr).length,
    uniquePnrs: uniqueCount(records.map((record) => record.pnr)),
    uniqueFlights: uniqueCount(records.map(recordFlightIdentity)),
    uniqueAirlines: uniqueCount(records.map((record) => record.airline)),
    weightedScans: weightedRows.length,
    totalWeightKg: sumNullableNumbers(weightedRows.map((record) => record.weightKg)),
    avgWeightKg: averageNullableNumbers(weightedRows.map((record) => record.weightKg)),
    dimensionReadyScans: dimensionRows.length,
    oversizeCandidates: records.filter((record) => (record.linearCm ?? 0) > 158).length,
    highVolumeCandidates: records.filter((record) => (record.volumeLiters ?? 0) >= 90).length,
    avgLinearCm: averageNullableNumbers(dimensionRows.map((record) => record.linearCm)),
    pnrReadiness: ratio(
      records.filter((record) => record.pnr && record.flightNumber && record.weightKg != null)
        .length,
      records.length,
    ),
  };
}

function groupedRecordLoads(
  records: TravelRecord[],
  getLabel: (record: TravelRecord) => string | null,
): TravelLoadItem[] {
  const groups = new Map<
    string,
    {
      label: string;
      count: number;
      totalWeightKg: number;
      weightCount: number;
      oversizeCount: number;
      highVolumeCount: number;
    }
  >();

  for (const record of records) {
    const label = getLabel(record);
    if (!label) continue;
    const group = groups.get(label) ?? {
      label,
      count: 0,
      totalWeightKg: 0,
      weightCount: 0,
      oversizeCount: 0,
      highVolumeCount: 0,
    };
    group.count += 1;
    if (record.weightKg != null) {
      group.totalWeightKg += record.weightKg;
      group.weightCount += 1;
    }
    if ((record.linearCm ?? 0) > 158) group.oversizeCount += 1;
    if ((record.volumeLiters ?? 0) >= 90) group.highVolumeCount += 1;
    groups.set(label, group);
  }

  return [...groups.values()]
    .map((group) => ({
      label: group.label,
      count: group.count,
      totalWeightKg: group.weightCount > 0 ? Math.round(group.totalWeightKg * 10) / 10 : null,
      oversizeCount: group.oversizeCount,
      highVolumeCount: group.highVolumeCount,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

function distributionFromRecords(
  records: TravelRecord[],
  key: keyof Pick<TravelRecord, "baggageCategory" | "sizeClass" | "bagType" | "overallCondition">,
): DistributionItem[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const label = record[key] ?? "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 12);
}

function flightRecordLabel(record: TravelRecord) {
  if (!record.flightNumber && !record.airline) return null;
  const flight = [record.airline, record.flightNumber].filter(Boolean).join(" ");
  const route = [record.departureAirport, record.arrivalAirport].filter(Boolean).join("-");
  return [flight || "Unknown flight", record.flightDate, route].filter(Boolean).join(" · ");
}

function airportRecordLabel(record: TravelRecord) {
  return record.departureAirport ?? record.arrivalAirport ?? null;
}

function terminalRecordLabel(record: TravelRecord) {
  if (!record.terminal) return null;
  return [record.departureAirport, record.terminal].filter(Boolean).join(" · ");
}

function recordFlightIdentity(record: TravelRecord) {
  if (!record.flightNumber && !record.airline) return null;
  return [
    record.airline,
    record.flightNumber,
    record.flightDate,
    record.departureAirport,
    record.arrivalAirport,
  ]
    .filter(Boolean)
    .join("|");
}

function airlineScopeLabel(filters: AirlineFilters) {
  const parts = [
    filters.airline !== "all" ? filters.airline : "All airlines",
    filters.date !== "all" ? filters.date : null,
    filters.airport !== "all" ? filters.airport : null,
    filters.terminal !== "all" ? filters.terminal : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function downloadAirlineReport(records: TravelRecord[], filters: AirlineFilters) {
  const headers = [
    "scan_id",
    "created_at",
    "airline",
    "flight_number",
    "flight_date",
    "route",
    "terminal",
    "pnr",
    "bag_tag",
    "baggage_category",
    "weight_kg",
    "linear_cm",
    "volume_liters",
    "bag_type",
    "size_class",
    "condition",
    "status",
  ];
  const rows = records.map((record) => [
    record.id,
    record.createdAt,
    record.airline,
    record.flightNumber,
    record.flightDate,
    [record.departureAirport, record.arrivalAirport].filter(Boolean).join("-"),
    record.terminal,
    record.pnr,
    record.bagTag,
    record.baggageCategory,
    record.weightKg,
    record.linearCm,
    record.volumeLiters,
    record.bagType,
    record.sizeClass,
    record.overallCondition,
    record.status,
  ]);
  const csv = [headers, ...rows].map(csvRow).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bagscan-airline-${slugify(airlineScopeLabel(filters))}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadChartData(items: TravelLoadItem[]) {
  return items
    .filter((item) => isKnownLabel(item.label))
    .map((item) => ({
      label: item.label,
      shortLabel: shortChartLabel(item.label),
      bags: item.count,
      weightKg: item.totalWeightKg ?? 0,
      alerts: item.oversizeCount + item.highVolumeCount,
    }));
}

function distributionChartData(items: DistributionItem[]) {
  return items
    .filter((item) => isKnownLabel(item.label))
    .map((item) => ({
      label: formatLabel(item.label),
      shortLabel: shortChartLabel(formatLabel(item.label)),
      count: item.count,
    }));
}

function shortChartLabel(value: string) {
  const label = value.length > 18 ? `${value.slice(0, 16)}...` : value;
  return label || "n/a";
}

function csvRow(values: Array<string | number | null>) {
  return values
    .map((value) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

function sumNullableNumbers(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

function averageNullableNumbers(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function ratio(value: number, total: number) {
  return total > 0 ? value / total : null;
}

function uniqueCount(values: Array<string | null>) {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function topLabel(items: DistributionItem[]) {
  const item = topItem(items);
  return item ? formatLabel(item.label) : "Not captured";
}

function topItem(items: DistributionItem[]) {
  return items.find((item) => isKnownLabel(item.label)) ?? null;
}

function knownItemCount(items: DistributionItem[]) {
  return items.filter((item) => isKnownLabel(item.label)).length;
}

function isKnownLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
    normalized !== "unknown" &&
    normalized !== "n/a" &&
    normalized !== "not captured" &&
    !normalized.startsWith("unknown "),
  );
}

function formatPercent(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`;
}

function formatCm(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value)} cm`;
}

function formatKg(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value * 10) / 10} kg`;
}

function formatLabel(value: string) {
  if (!value || value === "unknown") return "Unknown";
  return value.replace(/_/g, " ");
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report"
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
