import { CompanyButton } from "@client/components/CompanyButton";
import type { JobListItem } from "@shared/types.js";
import { cn } from "@/lib/utils";
import { defaultStatusToken, statusTokens } from "./constants";

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  statusDotClassName?: string;
  className?: string;
}

function getSuitabilityScoreTone(score: number): string {
  if (score >= 70) return "text-emerald-400/90";
  if (score >= 50) return "text-foreground/60";
  return "text-muted-foreground/60";
}

export const JobRowContent = ({
  job,
  isSelected = false,
  showStatusDot = true,
  statusDotClassName,
  className,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);

  return (
    <div
      className={cn(
        "grid min-w-0 flex-1 gap-0.5",
        "grid-cols-[auto_1fr_auto] grid-rows-[auto_auto]",
        className,
      )}
    >
      <div
        className={cn(
          "truncate text-sm leading-tight col-span-3",
          isSelected ? "font-semibold" : "font-medium",
        )}
      >
        {job.title}
      </div>

      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0 self-center",
          statusToken.dot,
          !isSelected && "opacity-70",
          statusDotClassName,
          !showStatusDot && "hidden",
        )}
        title={statusToken.label}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 truncate text-xs text-muted-foreground">
        <CompanyButton
          companyName={job.employer}
          job={job}
          className="text-xs shrink-0"
        />
        {job.location && (
          <span className="before:content-['_in_']">{job.location}</span>
        )}
      </div>
      {hasScore && (
        <span
          className={cn(
            "text-xs tabular-nums text-right self-center",
            suitabilityTone,
          )}
        >
          {job.suitabilityScore}
        </span>
      )}

      {job.salary?.trim() && (
        <div className="col-span-3 truncate text-xs text-muted-foreground">
          {job.salary}
        </div>
      )}
    </div>
  );
};
