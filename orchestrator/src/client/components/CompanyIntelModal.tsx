import {
  type CompanyIntelJobContext,
  extractCompanyIntel,
} from "@client/api/client";
import type {
  CompanyFounder,
  CompanyIntel,
  CompanyLocation,
  CompanyProjectReference,
} from "@shared/types";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  DollarSign,
  Globe,
  Loader2,
  MapPin,
  Users,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface CompanyIntelModalProps {
  companyName: string;
  jobContext?: CompanyIntelJobContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = { label: string; detail?: string; done: boolean };

type FetchState =
  | { status: "idle" }
  | { status: "loading"; steps: Step[] }
  | { status: "error"; message: string }
  | { status: "success"; intel: CompanyIntel };

// ─── Formatting helpers ────────────────────────────────────────────────────

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function formatHeadcount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

// ─── Sub-components ────────────────────────────────────────────────────────

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium mb-2">
    {children}
  </div>
);

const DataRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/20 last:border-0">
    <span className="text-xs text-muted-foreground shrink-0">{label}</span>
    <span className="text-xs text-foreground/90 text-right font-mono">
      {value ?? "—"}
    </span>
  </div>
);

const VitalsCard: React.FC<{ intel: CompanyIntel }> = ({ intel }) => (
  <div className="grid grid-cols-3 gap-2">
    {[
      {
        icon: DollarSign,
        label: "Revenue",
        value: formatCurrency(intel.vitals.revenue),
      },
      {
        icon: DollarSign,
        label: "Profit",
        value: formatCurrency(intel.vitals.profit),
      },
      {
        icon: Users,
        label: "Employees",
        value: formatHeadcount(intel.vitals.employees),
      },
    ].map(({ icon: Icon, label, value }) => (
      <div
        key={label}
        className="rounded-md border border-border/30 bg-muted/20 px-3 py-2.5"
      >
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className="h-3 w-3 text-muted-foreground/40" />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
            {label}
          </span>
        </div>
        <div className="text-sm font-mono font-medium text-foreground/90">
          {value}
        </div>
      </div>
    ))}
  </div>
);

const FoundersList: React.FC<{ founders: CompanyFounder[] }> = ({
  founders,
}) => {
  if (founders.length === 0)
    return <p className="text-xs text-muted-foreground/60">None known</p>;
  return (
    <div className="space-y-2">
      {founders.map((f) => (
        <div
          key={`${f.name}::${f.role}`}
          className="rounded-md border border-border/30 bg-muted/10 px-3 py-2"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-foreground/90">
              {f.name}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {f.role}
            </span>
          </div>
          {f.bio && (
            <p className="mt-1 text-[11px] text-muted-foreground/70 leading-relaxed">
              {f.bio}
            </p>
          )}
        </div>
      ))}
    </div>
  );
};

const LocationsList: React.FC<{ locations: CompanyLocation[] }> = ({
  locations,
}) => {
  if (locations.length === 0)
    return <p className="text-xs text-muted-foreground/60">None known</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {locations.map((loc) => (
        <span
          key={`${loc.city}::${loc.country}::${loc.locationName}`}
          className="inline-flex items-center gap-1 rounded border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] text-foreground/80"
        >
          <MapPin className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
          {loc.city}, {loc.country}
          {loc.locationName && loc.locationName !== loc.city && (
            <span className="text-muted-foreground/50">
              · {loc.locationName}
            </span>
          )}
        </span>
      ))}
    </div>
  );
};

const ProjectsList: React.FC<{ projects: CompanyProjectReference[] }> = ({
  projects,
}) => {
  if (projects.length === 0)
    return <p className="text-xs text-muted-foreground/60">None known</p>;
  return (
    <div className="space-y-1.5">
      {projects.map((p) => (
        <div
          key={`${p.projectName}::${p.year ?? "?"}`}
          className="rounded-md border border-border/30 bg-muted/10 px-3 py-2"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-foreground/90">
              {p.projectName}
            </span>
            {p.year && (
              <span className="text-[10px] font-mono text-muted-foreground/50">
                {p.year}
              </span>
            )}
          </div>
          {p.description && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/70 leading-relaxed">
              {p.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
};

// ─── Tab panels ────────────────────────────────────────────────────────────

const OverviewTab: React.FC<{ intel: CompanyIntel }> = ({ intel }) => (
  <div className="space-y-5 py-1">
    <VitalsCard intel={intel} />
    <div className="space-y-0">
      <DataRow label="Capital Raised" value={formatCurrency(intel.capital)} />
      <DataRow label="Industry" value={intel.industry} />
      <DataRow
        label="Headquarters"
        value={`${intel.headquarters.city}, ${intel.headquarters.country}`}
      />
      {intel.headquarters.address && (
        <DataRow label="Address" value={intel.headquarters.address} />
      )}
    </div>
    <div>
      <SectionLabel>Offices &amp; Locations</SectionLabel>
      <LocationsList locations={intel.locations} />
    </div>
  </div>
);

const TailoringTab: React.FC<{ intel: CompanyIntel }> = ({ intel }) => (
  <div className="space-y-5 py-1">
    <div>
      <SectionLabel>Public Reputation</SectionLabel>
      <p className="text-[12px] text-muted-foreground/80 leading-relaxed">
        {intel.generalOpinion || "—"}
      </p>
    </div>

    <div>
      <SectionLabel>Political Affiliation</SectionLabel>
      <p className="text-[12px] text-muted-foreground/80 leading-relaxed">
        {intel.politicalAffiliation || "None known"}
      </p>
    </div>

    {intel.fundingSources.length > 0 && (
      <div>
        <SectionLabel>Funding Sources</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {intel.fundingSources.map((src) => (
            <span
              key={src}
              className="rounded border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] text-foreground/80"
            >
              {src}
            </span>
          ))}
        </div>
      </div>
    )}

    <div>
      <SectionLabel>Founders</SectionLabel>
      <FoundersList founders={intel.founders} />
    </div>

    <div>
      <SectionLabel>Notable Projects</SectionLabel>
      <ProjectsList projects={intel.projectReferences} />
    </div>
  </div>
);

const DescriptionTab: React.FC<{ intel: CompanyIntel }> = ({ intel }) => (
  <div className="py-1">
    <p className="text-sm text-foreground/80 leading-relaxed">
      {intel.description || "No description available."}
    </p>
  </div>
);

// ─── Main modal ────────────────────────────────────────────────────────────

export const CompanyIntelModal: React.FC<CompanyIntelModalProps> = ({
  companyName,
  jobContext,
  open,
  onOpenChange,
}) => {
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const cleanupRef = useRef<(() => void) | null>(null);

  const startLookup = useCallback(() => {
    const abortController = new AbortController();
    cleanupRef.current?.();
    cleanupRef.current = () => abortController.abort();

    const addStep = (label: string, detail?: string) =>
      setState((prev) => {
        const prevSteps = prev.status === "loading" ? prev.steps : [];
        const updated = prevSteps.map((s) =>
          s.done ? s : { ...s, done: true },
        );
        return {
          status: "loading",
          steps: [...updated, { label, detail, done: false }],
        };
      });

    const run = async () => {
      setState({ status: "loading", steps: [] });

      addStep("Researching company…");
      const { intel } = await extractCompanyIntel(
        companyName,
        "",
        abortController.signal,
        jobContext?.jobLocation,
        jobContext,
      );

      cleanupRef.current = null;
      setState({ status: "success", intel });
    };

    run().catch((err: unknown) => {
      if (abortController.signal.aborted) return;
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Something went wrong",
      });
    });
  }, [companyName, jobContext]);

  // Radix Dialog never fires onOpenChange(true) when open is set externally,
  // so we watch the open prop directly to start/stop the lookup.
  // Only run lookup when modal opens (not when startLookup identity changes, e.g. from tab clicks).
  const didRunForOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      if (!didRunForOpenRef.current) {
        didRunForOpenRef.current = true;
        startLookup();
      }
    } else {
      didRunForOpenRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      setState({ status: "idle" });
    }
  }, [open, startLookup]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden",
        )}
      >
        {/* Header */}
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border/40 bg-muted/30">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground/70" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold leading-tight">
                {companyName}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                Company Intelligence
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {state.status === "idle" ||
          (state.status === "loading" && state.steps.length === 0) ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground/60">
                Researching company…
              </p>
            </div>
          ) : state.status === "loading" ? (
            <div className="flex flex-col gap-2.5 py-12 px-8">
              {state.steps.map((step, i) => (
                <div
                  key={`${step.label}-${i}`}
                  className="flex items-center gap-3"
                >
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500/80" />
                  ) : (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground/50" />
                  )}
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "text-sm",
                        step.done
                          ? "text-muted-foreground/50"
                          : "text-foreground/90",
                      )}
                    >
                      {step.label}
                    </span>
                    {step.detail && (
                      <span className="text-[11px] text-muted-foreground/40">
                        {step.detail}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : state.status === "error" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
                <AlertCircle className="h-4 w-4 text-destructive/70" />
              </div>
              <div className="space-y-1 text-center max-w-xs">
                <p className="text-sm text-foreground/80">Lookup failed</p>
                <p className="text-[11px] text-muted-foreground/60">
                  {state.message}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-7 text-xs"
                onClick={startLookup}
              >
                Try again
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="overview" className="flex flex-col h-full">
              <div className="shrink-0 px-5 pt-3 border-b border-border/30">
                <TabsList className="h-8 bg-transparent p-0 gap-1">
                  {(
                    [
                      { value: "overview", label: "Overview" },
                      { value: "tailoring", label: "Tailoring" },
                      { value: "description", label: "Description" },
                    ] as const
                  ).map(({ value, label }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className={cn(
                        "rounded-none border-b-2 border-transparent bg-transparent",
                        "px-3 pb-2 pt-0 h-8 text-xs font-medium",
                        "text-muted-foreground/60",
                        "hover:text-foreground/80",
                        "data-[state=active]:border-foreground/80 data-[state=active]:text-foreground",
                        "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
                        "transition-colors duration-150",
                      )}
                    >
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-5 pt-4">
                <TabsContent value="overview" className="mt-0">
                  <OverviewTab intel={state.intel} />
                </TabsContent>
                <TabsContent value="tailoring" className="mt-0">
                  <TailoringTab intel={state.intel} />
                </TabsContent>
                <TabsContent value="description" className="mt-0">
                  <DescriptionTab intel={state.intel} />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </div>

        {/* Footer */}
        {state.status === "success" && (
          <div className="shrink-0 px-5 py-2.5 border-t border-border/30 flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground/40" />
            <p className="text-[10px] text-muted-foreground/40">
              AI-powered research · May contain inaccuracies
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
