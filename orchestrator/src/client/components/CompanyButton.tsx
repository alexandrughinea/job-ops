import {
  type CompanyIntelJobSource,
  jobToCompanyIntelContext,
} from "@client/api/client";
import { Building2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CompanyIntelModal } from "./CompanyIntelModal";

interface CompanyButtonProps {
  companyName: string;
  /** Job object for richer search (pass the full job from list/detail) */
  job?: CompanyIntelJobSource | null;
  className?: string;
}

/**
 * Renders the company name as a small pill button that opens
 * the CompanyIntelModal for AI-powered company research.
 */
export const CompanyButton: React.FC<CompanyButtonProps> = ({
  companyName,
  job,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const jobContext = jobToCompanyIntelContext(job);

  if (!companyName) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md",
          "border border-border/50 bg-muted/30",
          "px-2 py-0.5",
          "text-xs font-medium text-foreground/80",
          "hover:border-border hover:bg-muted/60 hover:text-foreground",
          "active:scale-[0.97]",
          "transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "cursor-pointer select-none",
          className,
        )}
        title={`Research ${companyName}`}
      >
        <Building2 className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span>{companyName}</span>
      </button>

      <CompanyIntelModal
        companyName={companyName}
        jobContext={jobContext}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
};
