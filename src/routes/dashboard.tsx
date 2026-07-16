import { createFileRoute, Link } from "@tanstack/react-router";
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

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
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
  flight: string;
  category: string;
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
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {loading ? (
          <div className="mt-24 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-destructive/35 bg-destructive/10 p-5 text-sm text-destructive">
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
      </main>
    </div>
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
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-sm font-medium text-primary">BagScan analytics</div>
          <h1 className="mt-1 font-display text-3xl font-extrabold sm:text-4xl">
            BagScan Intelligence Console
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastUpdatedAt ? (
            <span className="text-xs text-muted-foreground">
              Updated {formatTime(lastUpdatedAt)}
            </span>
          ) : null}
          <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BarChart3 className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button className="bg-gradient-brand text-primary-foreground shadow-brand" asChild>
            <Link to="/scan-local">
              <Camera className="mr-2 h-4 w-4" />
              New scan
            </Link>
          </Button>
        </div>
      </header>

      <RoleTabs activeView={activeView} onChange={setActiveView} />

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
    <div className="grid gap-2 rounded-2xl border bg-card p-2 shadow-elevated md:grid-cols-5">
      {VIEWS.map((view) => {
        const active = view.key === activeView;
        const Icon = view.icon;
        return (
          <button
            key={view.key}
            className={`rounded-xl px-4 py-3 text-left transition ${
              active
                ? "bg-primary text-primary-foreground shadow-brand"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
            type="button"
            onClick={() => onChange(view.key)}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span className="font-semibold">{view.label}</span>
            </div>
            <div className={`mt-1 text-xs ${active ? "text-primary-foreground/80" : ""}`}>
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
  const [flight, setFlight] = useState("all");
  const [category, setCategory] = useState("all");
  const filters = useMemo(
    () => ({ airline, date, flight, category }),
    [airline, category, date, flight],
  );
  const scopedRecords = useMemo(
    () => filterTravelRecords(analytics.travelRecords, filters),
    [analytics.travelRecords, filters],
  );
  const availableFlights = useMemo(
    () =>
      sortedUniqueStrings(
        filterTravelRecords(analytics.travelRecords, {
          airline,
          date,
          flight: "all",
          category,
        }).map((record) => record.flightNumber),
      ),
    [airline, analytics.travelRecords, category, date],
  );
  const scopedSummary = useMemo(() => summarizeTravelRecords(scopedRecords), [scopedRecords]);
  const flightLoads = useMemo(
    () => groupedRecordLoads(scopedRecords, flightRecordLabel),
    [scopedRecords],
  );
  const pnrLoads = useMemo(
    () => groupedRecordLoads(scopedRecords, pnrRecordLabel),
    [scopedRecords],
  );
  const categoryDistribution = useMemo(
    () => distributionFromRecords(scopedRecords, "baggageCategory"),
    [scopedRecords],
  );
  const sizeDistribution = useMemo(
    () => distributionFromRecords(scopedRecords, "sizeClass"),
    [scopedRecords],
  );

  useEffect(() => {
    if (flight !== "all" && !availableFlights.includes(flight)) setFlight("all");
  }, [availableFlights, flight]);

  return (
    <section className="space-y-6">
      <RoleIntro
        icon={Plane}
        title="Airline baggage planning"
        description="Plan staff, gate readiness, internal transport, exception handling, and load advisory from PNR, flight, size, and weight signals."
      />
      <FilterBar
        filters={[
          {
            label: "Airline",
            value: airline,
            onChange: setAirline,
            options: analytics.filterOptions.airlines,
          },
          {
            label: "Flight date",
            value: date,
            onChange: setDate,
            options: analytics.filterOptions.flightDates,
          },
          {
            label: "Flight number",
            value: flight,
            onChange: setFlight,
            options: availableFlights,
          },
          {
            label: "Baggage category",
            value: category,
            onChange: setCategory,
            options: analytics.filterOptions.baggageCategories,
          },
        ]}
      />
      <ReportActionBar
        count={scopedRecords.length}
        label={airlineScopeLabel(filters)}
        onDownload={() => downloadAirlineReport(scopedRecords, filters)}
      />
      <MetricGrid>
        <MetricCard
          icon={Briefcase}
          label="PNR-linked bags"
          value={scopedSummary.pnrLinkedScans}
          helper={`${scopedSummary.uniquePnrs} PNR groups in selected data`}
          tone="accent"
        />
        <MetricCard
          icon={Plane}
          label="Flight groups"
          value={scopedSummary.uniqueFlights}
          helper={`${scopedSummary.uniqueAirlines} airlines in selected data`}
        />
        <MetricCard
          icon={BarChart3}
          label="Baggage mix"
          value={topLabel(categoryDistribution)}
          helper={`${scopedSummary.oversizeCandidates} oversize, ${scopedSummary.highVolumeCandidates} high-volume`}
        />
        <MetricCard
          icon={Gauge}
          label="Captured weight"
          value={formatKg(scopedSummary.totalWeightKg)}
          helper={`${scopedSummary.weightedScans} bags with manual weight`}
        />
      </MetricGrid>
      <PrescriptionPanel
        title="Airline prescriptions"
        items={airlinePrescriptions(scopedSummary, flightLoads, filters)}
      />
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <AirlinePlanningReadiness summary={scopedSummary} />
        <TravelLoadPanel title="Flight baggage distribution" items={flightLoads} />
        <TravelLoadPanel title="PNR baggage groups" items={pnrLoads} compact />
        <DistributionPanel
          title="Cabin vs check-in"
          icon={Briefcase}
          items={categoryDistribution}
          emptyLabel="No baggage category data yet"
        />
        <DistributionPanel
          title="Size pressure"
          icon={Ruler}
          items={sizeDistribution}
          emptyLabel="No size data in selected scope"
        />
      </div>
    </section>
  );
}

function AirportView({ analytics }: { analytics: CloudAnalytics }) {
  const [airport, setAirport] = useState("all");
  const [terminal, setTerminal] = useState("all");
  const terminalLoads = analytics.terminalLoads.filter((item) => {
    const label = item.label.toLowerCase();
    const airportMatch = airport === "all" || label.startsWith(airport.toLowerCase());
    const terminalMatch = terminal === "all" || label.includes(terminal.toLowerCase());
    return airportMatch && terminalMatch;
  });

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
          value={analytics.travel.uniqueAirlines}
          helper={`${analytics.travel.uniqueFlights} flight groups represented`}
        />
        <MetricCard
          icon={TriangleAlert}
          label="Oversize candidates"
          value={analytics.operational.oversizeCandidates}
          helper={`${formatCm(analytics.operational.avgLinearCm)} average linear size`}
          tone="warning"
        />
        <MetricCard
          icon={Briefcase}
          label="Check-in pressure"
          value={topLabel(analytics.baggageCategories)}
          helper={`${analytics.totals.scans} scanned baggage records`}
        />
        <MetricCard
          icon={Activity}
          label="Planning readiness"
          value={formatPercent(analytics.travel.pnrReadiness)}
          helper="PNR, flight, and weight coverage"
        />
      </MetricGrid>
      <PrescriptionPanel title="Airport prescriptions" items={airportPrescriptions(analytics)} />
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <PlanningReadiness analytics={analytics} />
        <TravelLoadPanel title="Terminal pressure" items={terminalLoads} />
        <TravelLoadPanel title="Airport distribution" items={analytics.airportLoads} compact />
        <DistributionPanel
          title="Size pressure"
          icon={Ruler}
          items={analytics.sizeClasses}
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
      <PrescriptionPanel title="Claims prescriptions" items={insurancePrescriptions(analytics)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <DistributionPanel
          title="Damage severity"
          icon={TriangleAlert}
          items={analytics.damageSeverity}
          emptyLabel="No damage recorded"
        />
        <DistributionPanel
          title="Condition at scan"
          icon={Activity}
          items={analytics.conditions}
          emptyLabel="No condition data yet"
        />
        <QualityPanel analytics={analytics} />
      </div>
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
          label="Top brand signal"
          value={topLabel(analytics.brands)}
          helper="Visible make or logo when detected"
        />
        <MetricCard
          icon={PackageSearch}
          label="Top form factor"
          value={topLabel(analytics.formFactors)}
          helper="Spinner, duffel, carton, or other shape"
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
      <PrescriptionPanel
        title="Manufacturing prescriptions"
        items={manufacturingPrescriptions(analytics)}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <DistributionPanel
          title="Visible brand signals"
          icon={Factory}
          items={analytics.brands}
          emptyLabel="No visible brand signals yet"
        />
        <DistributionPanel
          title="Form factor mix"
          icon={Briefcase}
          items={analytics.formFactors}
          emptyLabel="No form-factor data yet"
        />
        <DistributionPanel
          title="Baggage type mix"
          icon={BarChart3}
          items={analytics.bagTypes}
          emptyLabel="No baggage types yet"
        />
        <DistributionPanel
          title="Material mix"
          icon={PackageSearch}
          items={analytics.materials}
          emptyLabel="No materials yet"
        />
        <DistributionPanel
          title="Condition trend"
          icon={Activity}
          items={analytics.conditions}
          emptyLabel="No condition data yet"
        />
        <DistributionPanel
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
      <PrescriptionPanel title="Service prescriptions" items={servicePrescriptions(analytics)} />
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <QualityPanel analytics={analytics} />
        <RecentScans scans={analytics.recentScans} />
      </div>
    </section>
  );
}

function RoleIntro({
  icon: Icon,
  title,
  description,
}: {
  icon: IconType;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
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
    <div className="grid gap-3 rounded-2xl border bg-card p-4 shadow-elevated md:grid-cols-2">
      {filters.map((filter) => (
        <label key={filter.label} className="grid gap-1.5 text-sm">
          <span className="font-medium text-muted-foreground">{filter.label}</span>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm font-medium outline-none focus:border-primary"
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

function ReportActionBar({
  count,
  label,
  onDownload,
}: {
  count: number;
  label: string;
  onDownload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-elevated sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {count} baggage records in the selected airline planning scope.
        </div>
      </div>
      <Button variant="outline" onClick={onDownload} disabled={count === 0}>
        <Download className="mr-2 h-4 w-4" />
        Download report
      </Button>
    </div>
  );
}

function PrescriptionPanel({ title, items }: { title: string; items: Prescription[] }) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent/12 text-accent">
          <ClipboardCheck className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl bg-surface-elevated p-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotTone(item.tone)}`} />
              <div>
                <div className="text-sm font-semibold">{item.title}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
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

function airportPrescriptions(analytics: CloudAnalytics): Prescription[] {
  const topTerminal = analytics.terminalLoads[0];
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
        analytics.airlineLoads.length > 0
          ? `${analytics.airlineLoads.length} airline groups are visible. Compare their baggage mix before assigning shared baggage belts and exception desks.`
          : "Airline distribution is not available yet. Capture airline and flight number during scan.",
      tone: analytics.airlineLoads.length > 0 ? "primary" : "warning",
    },
    {
      title: "Stage exception handling",
      detail: `${analytics.operational.oversizeCandidates} oversize and ${analytics.operational.highVolumeCandidates} high-volume bags should be planned before queue buildup.`,
      tone:
        analytics.operational.oversizeCandidates > 0 ||
        analytics.operational.highVolumeCandidates > 0
          ? "warning"
          : "accent",
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
  if (tone === "accent") return "bg-accent";
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
      ? "bg-accent/12 text-accent"
      : tone === "warning"
        ? "bg-warning/14 text-warning"
        : "bg-primary/10 text-primary";

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 truncate text-2xl font-extrabold">{value}</div>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-4 text-xs font-medium text-muted-foreground">{helper}</div>
    </div>
  );
}

function PlanningReadiness({ analytics }: { analytics: CloudAnalytics }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <h3 className="font-bold">Prediction inputs</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        PNR, flight, terminal, dimensions, and manual weight combine into the first planning signal.
      </p>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Planning readiness</span>
          <span className="font-bold">{formatPercent(analytics.travel.pnrReadiness)}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.round((analytics.travel.pnrReadiness ?? 0) * 100)}%` }}
          />
        </div>
      </div>
      <div className="mt-5 grid gap-2 text-sm">
        <PlanningRow
          label="Dimension coverage"
          value={`${analytics.operational.dimensionReadyScans} scans with dimensions`}
        />
        <PlanningRow label="PNR coverage" value={`${analytics.travel.pnrLinkedScans} scans`} />
        <PlanningRow label="Weight captured" value={formatKg(analytics.travel.totalWeightKg)} />
        <PlanningRow
          label="Volume pressure"
          value={`${analytics.operational.highVolumeCandidates} high-volume bags`}
        />
        <PlanningRow label="Avg linear size" value={formatCm(analytics.operational.avgLinearCm)} />
      </div>
    </div>
  );
}

function AirlinePlanningReadiness({ summary }: { summary: TravelRecordSummary }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <h3 className="font-bold">Selected-scope readiness</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        These signals recalculate from the active airline, date, flight, and category filters.
      </p>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Planning readiness</span>
          <span className="font-bold">{formatPercent(summary.pnrReadiness)}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
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
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-elevated px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function TravelLoadPanel({
  title,
  items,
  compact = false,
}: {
  title: string;
  items: CloudAnalytics["flightLoads"];
  compact?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <Plane className="h-4 w-4" />
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          Add PNR, airline, flight, airport, terminal, and weight during scan capture.
        </p>
      ) : (
        <div className="mt-5 grid gap-3">
          {items.slice(0, compact ? 4 : 6).map((item) => (
            <div key={item.label} className="rounded-xl bg-surface-elevated p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{item.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.count} bags · {formatKg(item.totalWeightKg)}
                  </div>
                </div>
                {item.oversizeCount > 0 || item.highVolumeCount > 0 ? (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                )}
              </div>
              {!compact ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-background px-2.5 py-1">
                    {item.oversizeCount} oversize
                  </span>
                  <span className="rounded-full bg-background px-2.5 py-1">
                    {item.highVolumeCount} high-volume
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QualityPanel({ analytics }: { analytics: CloudAnalytics }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Capture quality by view</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Shows which photo angles create the most review friction.
          </p>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent/12 text-accent">
          <Gauge className="h-4 w-4" />
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
    <div className="rounded-xl bg-surface-elevated p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold capitalize">{view.view}</span>
        <span className="font-bold">{score || "n/a"}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {view.imageCount} photos · {view.rejectedCount} rejected
      </div>
    </div>
  );
}

function DistributionPanel({
  title,
  icon: Icon,
  items,
  emptyLabel,
}: {
  title: string;
  icon: IconType;
  items: DistributionItem[];
  emptyLabel: string;
}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-5 grid gap-3">
          {items.slice(0, 6).map((item) => (
            <div key={item.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                <span className="truncate capitalize">{formatLabel(item.label)}</span>
                <span className="font-bold">{item.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(6, Math.round((item.count / max) * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentScans({ scans }: { scans: CloudAnalytics["recentScans"] }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-elevated">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold">Recent customer cases</h3>
          <p className="mt-1 text-sm text-muted-foreground">Latest scan reports for follow-up.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/reports-local">View all</Link>
        </Button>
      </div>
      <div className="mt-5 grid gap-3">
        {scans.map((scan) => (
          <Link
            key={scan.id}
            to="/reports-local/$id"
            params={{ id: scan.id }}
            className="rounded-xl border bg-surface-elevated p-4 transition hover:border-primary/70"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {scan.reference || scan.bagType || "Baggage scan"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(scan.createdAt)}
                </div>
              </div>
              {scan.captureValidationStatus === "needs_review" ||
              scan.captureValidationStatus === "needs_retake" ? (
                <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-background px-2.5 py-1 font-medium">
                {scan.imageCount}/4 photos
              </span>
              {scan.bagType ? (
                <span className="rounded-full bg-background px-2.5 py-1 font-medium capitalize">
                  {formatLabel(scan.bagType)}
                </span>
              ) : null}
              {scan.travelContext?.pnr ? (
                <span className="rounded-full bg-background px-2.5 py-1 font-medium">
                  PNR {scan.travelContext.pnr}
                </span>
              ) : null}
              {scan.travelContext?.flight_number ? (
                <span className="rounded-full bg-background px-2.5 py-1 font-medium">
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
    <div className="rounded-2xl border border-dashed bg-card p-10 text-center shadow-elevated">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-brand">
        <BarChart3 className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-xl font-bold">No analytics data yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        Complete a scan to populate role-based analytics.
      </p>
      <Button className="mt-6 bg-gradient-brand text-primary-foreground shadow-brand" asChild>
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
    const flightMatch = filters.flight === "all" || record.flightNumber === filters.flight;
    const categoryMatch = filters.category === "all" || record.baggageCategory === filters.category;
    return airlineMatch && dateMatch && flightMatch && categoryMatch;
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

function pnrRecordLabel(record: TravelRecord) {
  if (!record.pnr) return null;
  const flight = [record.airline, record.flightNumber].filter(Boolean).join(" ");
  return [record.pnr, flight].filter(Boolean).join(" · ");
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
    filters.flight !== "all" ? filters.flight : null,
    filters.category !== "all" ? formatLabel(filters.category) : null,
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

function csvRow(values: Array<string | number | null>) {
  return values
    .map((value) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

function sortedUniqueStrings(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 250);
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
  return item ? formatLabel(item.label) : "n/a";
}

function topItem(items: DistributionItem[]) {
  return items[0] ?? null;
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
