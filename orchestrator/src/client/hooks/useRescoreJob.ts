import { useCallback, useState } from "react";
import { toast } from "sonner";
import { trackProductEvent } from "@/lib/analytics";
import { useMutationJobRescore } from "./mutations";

export function useRescoreJob(onJobUpdated: () => void | Promise<void>) {
  const [isRescoring, setIsRescoring] = useState(false);
  const mutationRescore = useMutationJobRescore();

  const rescoreJob = useCallback(
    async (jobId?: string | null) => {
      if (!jobId) return;

      try {
        setIsRescoring(true);
        await mutationRescore.mutateAsync(jobId);
        trackProductEvent("jobs_job_action_completed", {
          action: "rescore",
          result: "success",
        });
        toast.success("Match recalculated");
        await onJobUpdated();
      } catch (error) {
        trackProductEvent("jobs_job_action_completed", {
          action: "rescore",
          result: "error",
        });
        const message =
          error instanceof Error
            ? error.message
            : "Failed to recalculate match";
        toast.error(message);
      } finally {
        setIsRescoring(false);
      }
    },
    [onJobUpdated, mutationRescore],
  );

  return { isRescoring, rescoreJob };
}
