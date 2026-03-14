/**
 * All useMutation* hooks for the orchestrator client.
 *
 * Naming: useMutation<Entity><Action>
 *   e.g. useMutationJobUpdate, useMutationPipelineRun, useMutationSettingsUpdate
 *
 * Variable convention:
 *   const mutationUpdateJob = useMutationJobUpdate()
 *   const mutationRunPipeline = useMutationPipelineRun()
 */

import * as api from "@client/api";
import type { UpdateSettingsInput } from "@shared/settings-schema";
import type {
  ApplicationStage,
  Job,
  JobOutcome,
  StageEventMetadata,
} from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";
import {
  invalidateJobData,
  invalidateSettingsData,
} from "./queries/invalidate";

// ─── Jobs: Core CRUD ─────────────────────────────────────────────────────────

export function useMutationJobUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: Partial<Job> }) =>
      api.updateJob(id, update),
    onSuccess: async (_data, variables) => {
      await invalidateJobData(queryClient, variables.id);
    },
  });
}

export function useMutationJobMarkAsApplied() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markAsApplied(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.jobs.detail(id) });
      const previousJob = queryClient.getQueryData<Job>(
        queryKeys.jobs.detail(id),
      );
      queryClient.setQueryData<Job>(queryKeys.jobs.detail(id), (current) =>
        current ? { ...current, status: "applied" } : current,
      );
      return { previousJob, id };
    },
    onError: (_error, _id, context) => {
      if (context?.id) {
        queryClient.setQueryData(
          queryKeys.jobs.detail(context.id),
          context.previousJob,
        );
      }
    },
    onSettled: async (_data, _error, id) => {
      await invalidateJobData(queryClient, id);
    },
  });
}

export function useMutationJobSkip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.skipJob(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.jobs.detail(id) });
      const previousJob = queryClient.getQueryData<Job>(
        queryKeys.jobs.detail(id),
      );
      queryClient.setQueryData<Job>(queryKeys.jobs.detail(id), (current) =>
        current ? { ...current, status: "skipped" } : current,
      );
      return { previousJob, id };
    },
    onError: (_error, _id, context) => {
      if (context?.id) {
        queryClient.setQueryData(
          queryKeys.jobs.detail(context.id),
          context.previousJob,
        );
      }
    },
    onSettled: async (_data, _error, id) => {
      await invalidateJobData(queryClient, id);
    },
  });
}

export function useMutationJobRescore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rescoreJob(id),
    onSuccess: async (_data, id) => {
      await invalidateJobData(queryClient, id);
    },
  });
}

export function useMutationJobSummarize() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force = false }: { id: string; force?: boolean }) =>
      api.summarizeJob(id, { force }),
    onSuccess: async (_data, variables) => {
      await invalidateJobData(queryClient, variables.id);
    },
  });
}

export function useMutationJobGeneratePdf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.generateJobPdf(id),
    onSuccess: async (_data, id) => {
      await invalidateJobData(queryClient, id);
    },
  });
}

export function useMutationJobCheckSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.checkSponsor(id),
    onSuccess: async (_data, id) => {
      await invalidateJobData(queryClient, id);
    },
  });
}

export function useMutationJobProcess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.processJob(id),
    onSuccess: async (_data, id) => {
      await invalidateJobData(queryClient, id);
    },
  });
}

// ─── Jobs: Stage Transitions ─────────────────────────────────────────────────

export function useMutationJobTransitionStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      toStage,
      metadata,
    }: {
      jobId: string;
      toStage: ApplicationStage;
      metadata?: StageEventMetadata;
    }) =>
      api.transitionJobStage(jobId, {
        toStage,
        metadata,
      }),
    onSuccess: async (_data, variables) => {
      await invalidateJobData(queryClient, variables.jobId);
    },
  });
}

export function useMutationJobStageEventUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      eventId,
      patch,
    }: {
      jobId: string;
      eventId: string;
      patch: { notes?: string; occurredAt?: number };
    }) => api.updateJobStageEvent(jobId, eventId, patch),
    onSuccess: async (_data, variables) => {
      await invalidateJobData(queryClient, variables.jobId);
    },
  });
}

export function useMutationJobStageEventDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, eventId }: { jobId: string; eventId: string }) =>
      api.deleteJobStageEvent(jobId, eventId),
    onSuccess: async (_data, variables) => {
      await invalidateJobData(queryClient, variables.jobId);
    },
  });
}

export function useMutationJobOutcomeUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      outcome,
      closedAt,
    }: {
      jobId: string;
      outcome: JobOutcome | null;
      closedAt?: number | null;
    }) => api.updateJobOutcome(jobId, { outcome, closedAt }),
    onSuccess: async (_data, variables) => {
      await invalidateJobData(queryClient, variables.jobId);
    },
  });
}

// ─── Jobs: Manual Import ──────────────────────────────────────────────────────

export function useMutationJobFetchFromUrl() {
  return useMutation({
    mutationFn: ({ url }: { url: string }) => api.fetchJobFromUrl({ url }),
  });
}

export function useMutationJobInfer() {
  return useMutation({
    mutationFn: (input: Parameters<typeof api.inferManualJob>[0]) =>
      api.inferManualJob(input),
  });
}

export function useMutationJobImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.importManualJob>[0]) =>
      api.importManualJob(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

// ─── Jobs: Bulk Actions ───────────────────────────────────────────────────────

export function useMutationJobRunAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.runJobAction>[0]) =>
      api.runJobAction(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function useMutationSettingsUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateSettingsInput) => api.updateSettings(payload),
    onSuccess: async () => {
      await invalidateSettingsData(queryClient);
    },
  });
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export function useMutationProfileRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshProfile(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
    },
  });
}

export function useMutationRawResumeTextSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.setRawResumeText(text),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
    },
  });
}

export function useMutationResumePdfUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pdfBuffer: ArrayBuffer) => api.uploadResumePdf(pdfBuffer),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
    },
  });
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export function useMutationPipelineRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config?: Parameters<typeof api.runPipeline>[0]) =>
      api.runPipeline(config),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.pipeline.status(),
      });
    },
  });
}

export function useMutationPipelineCancel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelPipeline(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.pipeline.status(),
      });
    },
  });
}

// ─── Visa Sponsors ────────────────────────────────────────────────────────────

export function useMutationVisaSponsorListUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.updateVisaSponsorList(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.visaSponsors.all,
      });
    },
  });
}

// ─── Post Application ─────────────────────────────────────────────────────────

export function useMutationPostApplicationGmailOauthStart() {
  return useMutation({
    mutationFn: (
      input?: Parameters<typeof api.postApplicationGmailOauthStart>[0],
    ) => api.postApplicationGmailOauthStart(input),
  });
}

export function useMutationPostApplicationGmailOauthExchange() {
  return useMutation({
    mutationFn: (
      input: Parameters<typeof api.postApplicationGmailOauthExchange>[0],
    ) => api.postApplicationGmailOauthExchange(input),
  });
}

export function useMutationPostApplicationProviderSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input?: Parameters<typeof api.postApplicationProviderSync>[0],
    ) => api.postApplicationProviderSync(input),
    onSuccess: async (_data, variables) => {
      if (variables?.provider && variables.accountKey) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.postApplication.runs(
            variables.provider,
            variables.accountKey,
            20,
          ),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.postApplication.inbox(
            variables.provider,
            variables.accountKey,
            100,
          ),
        });
      } else {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.postApplication.all,
        });
      }
    },
  });
}

export function useMutationPostApplicationProviderDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input?: Parameters<typeof api.postApplicationProviderDisconnect>[0],
    ) => api.postApplicationProviderDisconnect(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.postApplication.all,
      });
    },
  });
}

export function useMutationPostApplicationInboxApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Parameters<typeof api.approvePostApplicationInboxItem>[0],
    ) => api.approvePostApplicationInboxItem(input),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.postApplication.inbox(
          variables.provider ?? "gmail",
          variables.accountKey ?? "default",
          100,
        ),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useMutationPostApplicationInboxDeny() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Parameters<typeof api.denyPostApplicationInboxItem>[0],
    ) => api.denyPostApplicationInboxItem(input),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.postApplication.inbox(
          variables.provider ?? "gmail",
          variables.accountKey ?? "default",
          100,
        ),
      });
    },
  });
}

export function useMutationPostApplicationInboxRunAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Parameters<typeof api.runPostApplicationInboxAction>[0],
    ) => api.runPostApplicationInboxAction(input),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.postApplication.inbox(
          variables.provider ?? "gmail",
          variables.accountKey ?? "default",
          100,
        ),
      });
    },
  });
}

// ─── Backups ──────────────────────────────────────────────────────────────────

export function useMutationBackupCreate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.createManualBackup(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.backups.list(),
      });
    },
  });
}

export function useMutationBackupDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.deleteBackup(filename),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.backups.list(),
      });
    },
  });
}

// ─── Database ─────────────────────────────────────────────────────────────────

export function useMutationDatabaseClear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearDatabase(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useMutationJobDeleteByStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: string) => api.deleteJobsByStatus(status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

export function useMutationJobDeleteBelowScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threshold: number) => api.deleteJobsBelowScore(threshold),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
  });
}

// ─── Company Intelligence ─────────────────────────────────────────────────────

export function useMutationCompanyIntelLookup() {
  return useMutation({
    mutationFn: (companyName: string) => api.lookupCompanyIntel(companyName),
  });
}

// ─── Onboarding / Validation ──────────────────────────────────────────────────

export function useMutationLlmValidate() {
  return useMutation({
    mutationFn: (input: Parameters<typeof api.validateLlm>[0]) =>
      api.validateLlm(input),
  });
}

export function useMutationRxResumeValidate() {
  return useMutation({
    mutationFn: (input?: Parameters<typeof api.validateRxresume>[0]) =>
      api.validateRxresume(input),
  });
}

export function useMutationResumeConfigValidate() {
  return useMutation({
    mutationFn: () => api.validateResumeConfig(),
  });
}
