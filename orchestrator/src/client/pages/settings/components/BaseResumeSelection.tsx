import { useQueryRxResumesFindAll } from "@client/hooks";
import type { RxResumeMode } from "@shared/types.js";
import { RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type BaseResumeSelectionProps = {
  value: string | null;
  onValueChange: (value: string | null) => void;
  hasRxResumeAccess: boolean;
  rxresumeMode?: RxResumeMode;
  disabled?: boolean;
  isLoading?: boolean;
};

export const BaseResumeSelection: React.FC<BaseResumeSelectionProps> = ({
  value,
  onValueChange,
  hasRxResumeAccess,
  rxresumeMode,
  disabled = false,
  isLoading = false,
}) => {
  const effectiveMode: RxResumeMode = rxresumeMode ?? "v5";
  const queryResumes = useQueryRxResumesFindAll(effectiveMode);
  const resumes = hasRxResumeAccess ? (queryResumes.data ?? []) : [];
  const isFetchingResumes = queryResumes.isFetching;
  const fetchError =
    queryResumes.error instanceof Error
      ? queryResumes.error.message
      : queryResumes.error
        ? "Failed to fetch resumes"
        : null;

  useEffect(() => {
    if (resumes.length === 1 && !value) {
      onValueChange(resumes[0].id);
    }
  }, [resumes, value, onValueChange]);

  const fetchResumes = useCallback(() => {
    queryResumes.refetch();
  }, [queryResumes]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Template Resume</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchResumes}
          disabled={isFetchingResumes || isLoading || disabled}
          className="h-8 px-2"
        >
          <RefreshCw
            className={`h-3 w-3 mr-1 ${isFetchingResumes ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <Select
        value={value || ""}
        onValueChange={(val: string) => onValueChange(val || null)}
        disabled={disabled || isLoading || isFetchingResumes}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              resumes.length > 0
                ? "Select a template resume..."
                : "No resumes found"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {resumes.map((resume) => (
            <SelectItem key={resume.id} value={resume.id}>
              {resume.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {resumes.length === 0 && !isFetchingResumes && !fetchError && (
        <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">
          No resumes found in your account. Please create a resume on the{" "}
          <a
            href="https://rxresu.me"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            Reactive Resume website
          </a>{" "}
          first.
        </div>
      )}

      {fetchError && (
        <div className="text-xs text-destructive mt-1">{fetchError}</div>
      )}
    </div>
  );
};
