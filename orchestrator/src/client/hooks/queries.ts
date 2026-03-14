/**
 * All useQuery* hooks for the orchestrator client.
 *
 * Naming: useQuery<Entity><Action>
 *   e.g. useQueryJobFindAll, useQueryJobFindById, useQuerySettingsFindCurrent
 *
 * Variable convention:
 *   const queryJobs = useQueryJobFindAll()
 *   const queryJobDetail = useQueryJobFindById(id)
 */

import * as api from "@client/api";
import type { BackupListResponse } from "@client/api/client";
import type {
  ApplicationTask,
  AppSettings,
  DemoInfoResponse,
  Job,
  JobSource,
  JobStatus,
  JobTracerLinksResponse,
  PostApplicationInboxItem,
  PostApplicationProvider,
  PostApplicationSyncRun,
  ProfileStatusResponse,
  ResumeProfile,
  ResumeProjectCatalogItem,
  RxResumeMode,
  StageEvent,
  TracerAnalyticsResponse,
  TracerReadinessResponse,
  VisaSponsor,
  VisaSponsorStatusResponse,
} from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function useQueryJobFindAll(options?: {
  statuses?: JobStatus[];
  view?: "list" | "full";
}) {
  return useQuery({
    queryKey: queryKeys.jobs.list(options),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: () => api.getJobs(options as any),
  });
}

export function useQueryJobFindById(id: string | null | undefined) {
  return useQuery<Job | null>({
    queryKey: queryKeys.jobs.detail(id ?? ""),
    queryFn: () => (id ? api.getJob(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  });
}

export function useQueryJobRevisionFindCurrent(options?: {
  statuses?: JobStatus[];
}) {
  return useQuery({
    queryKey: queryKeys.jobs.revision(options),
    queryFn: () => api.getJobsRevision(options),
  });
}

export function useQueryJobStageEventsFindAll(
  jobId: string | null | undefined,
) {
  return useQuery<StageEvent[]>({
    queryKey: queryKeys.jobs.stageEvents(jobId ?? ""),
    queryFn: () => (jobId ? api.getJobStageEvents(jobId) : Promise.resolve([])),
    enabled: Boolean(jobId),
  });
}

export function useQueryJobTasksFindAll(jobId: string | null | undefined) {
  return useQuery<ApplicationTask[]>({
    queryKey: queryKeys.jobs.tasks(jobId ?? ""),
    queryFn: () => (jobId ? api.getJobTasks(jobId) : Promise.resolve([])),
    enabled: Boolean(jobId),
  });
}

/**
 * Fetches in-progress jobs with their stage events for the Kanban board.
 */
export function useQueryJobInProgressBoardFindAll() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.jobs.inProgressBoard(),
    queryFn: async () => {
      const response = await api.getJobs({
        statuses: ["in_progress"],
        view: "list",
      });
      const jobs = response.jobs;
      const eventResults = await Promise.allSettled(
        jobs.map((job) =>
          queryClient.fetchQuery({
            queryKey: queryKeys.jobs.stageEvents(job.id),
            queryFn: () => api.getJobStageEvents(job.id),
            staleTime: 30_000,
          }),
        ),
      );
      return jobs.map((job, index) => {
        const result = eventResults[index];
        return {
          job,
          events:
            result?.status === "fulfilled"
              ? [...result.value].sort((a, b) => a.occurredAt - b.occurredAt)
              : null,
        };
      });
    },
  });
}

/**
 * Overview query for the homepage — applied + in-progress jobs with events.
 */
export function useQueryJobOverviewWithEvents(options?: {
  statuses?: JobStatus[];
}) {
  const queryClient = useQueryClient();
  const statuses: JobStatus[] = options?.statuses ?? ["applied", "in_progress"];
  return useQuery({
    queryKey: queryKeys.jobs.list({ statuses, view: "list" }),
    queryFn: async () => {
      const response = await api.getJobs({ statuses, view: "list" });
      const jobs = response.jobs;
      const appliedJobs = jobs.filter(
        (j): j is typeof j & { appliedAt: string } => Boolean(j.appliedAt),
      );
      const results = await Promise.allSettled(
        appliedJobs.map((job) =>
          queryClient.fetchQuery({
            queryKey: queryKeys.jobs.stageEvents(job.id),
            queryFn: () => api.getJobStageEvents(job.id),
            staleTime: 0,
          }),
        ),
      );
      const eventsMap = new Map<string, StageEvent[]>();
      results.forEach((result, index) => {
        const jobId = appliedJobs[index]?.id;
        if (jobId && result.status === "fulfilled") {
          eventsMap.set(jobId, result.value);
        }
      });
      return {
        jobs: jobs.map((job) => ({
          id: job.id,
          source: job.source as JobSource,
          datePosted: job.datePosted,
          discoveredAt: job.discoveredAt,
          appliedAt: job.appliedAt,
          events: eventsMap.get(job.id) ?? [],
        })),
        byStatus: response.byStatus,
      };
    },
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function useQuerySettingsFindCurrent() {
  return useQuery<AppSettings | null>({
    queryKey: queryKeys.settings.current(),
    queryFn: api.getSettings,
  });
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export function useQueryProfileFindCurrent() {
  return useQuery<ResumeProfile | null>({
    queryKey: queryKeys.profile.current(),
    queryFn: api.getProfile,
  });
}

export function useQueryProfileStatusFindCurrent() {
  return useQuery<ProfileStatusResponse>({
    queryKey: queryKeys.profile.status(),
    queryFn: api.getProfileStatus,
  });
}

export function useQueryProfileProjectsFindAll() {
  return useQuery({
    queryKey: queryKeys.profile.projects(),
    queryFn: api.getProfileProjects,
  });
}

export function useQueryRawResumeTextFindCurrent() {
  return useQuery<{ text: string; charCount: number }>({
    queryKey: queryKeys.profile.rawText(),
    queryFn: api.getRawResumeText,
  });
}

// ─── Resume Projects ─────────────────────────────────────────────────────────

export function useQueryResumeProjectCatalogFindAll() {
  return useQuery<ResumeProjectCatalogItem[]>({
    queryKey: queryKeys.resumeProjects.catalog(),
    queryFn: api.getResumeProjectsCatalog,
  });
}

// ─── RxResume ─────────────────────────────────────────────────────────────────

export function useQueryRxResumesFindAll(mode: RxResumeMode) {
  return useQuery({
    queryKey: queryKeys.rxresume.list(mode),
    queryFn: () => api.getRxResumes(mode),
  });
}

export function useQueryRxResumeProjectsFindAll(resumeId: string | null) {
  return useQuery({
    queryKey: queryKeys.rxresume.projects(resumeId ?? ""),
    queryFn: () =>
      resumeId ? api.getRxResumeProjects(resumeId) : Promise.resolve([]),
    enabled: Boolean(resumeId),
  });
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export function useQueryPipelineStatusFindCurrent() {
  return useQuery({
    queryKey: queryKeys.pipeline.status(),
    queryFn: api.getPipelineStatus,
  });
}

// ─── Tracer ───────────────────────────────────────────────────────────────────

export function useQueryTracerReadinessFindCurrent(force = false) {
  return useQuery<TracerReadinessResponse | null>({
    queryKey: queryKeys.tracer.readiness(force),
    queryFn: () => api.getTracerReadiness({ force }),
  });
}

export function useQueryTracerAnalyticsFindAll(options?: {
  from?: number;
  to?: number;
  includeBots?: boolean;
  limit?: number;
}) {
  return useQuery<TracerAnalyticsResponse>({
    queryKey: queryKeys.tracer.analytics(options),
    queryFn: () => api.getTracerAnalytics(options),
  });
}

export function useQueryJobTracerLinksFindAll(
  jobId: string | null | undefined,
  options?: { from?: number; to?: number; includeBots?: boolean },
  enabled = true,
) {
  return useQuery<JobTracerLinksResponse>({
    queryKey: queryKeys.tracer.jobLinks(jobId ?? "", options),
    queryFn: () => api.getJobTracerLinks(jobId ?? "", options),
    enabled: Boolean(enabled && jobId),
  });
}

// ─── Visa Sponsors ────────────────────────────────────────────────────────────

export function useQueryVisaSponsorStatusFindCurrent() {
  return useQuery<VisaSponsorStatusResponse>({
    queryKey: queryKeys.visaSponsors.status(),
    queryFn: api.getVisaSponsorStatus,
  });
}

export function useQueryVisaSponsorSearch(
  query: string,
  limit = 50,
  minScore = 0,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.visaSponsors.search(query, limit, minScore),
    queryFn: () => api.searchVisaSponsors({ query, limit, minScore }),
    enabled: enabled && query.trim().length > 0,
  });
}

export function useQueryVisaSponsorOrganizationFindByName(
  name: string | null | undefined,
) {
  return useQuery<VisaSponsor[]>({
    queryKey: queryKeys.visaSponsors.organization(name ?? ""),
    queryFn: () =>
      name ? api.getVisaSponsorOrganization(name) : Promise.resolve([]),
    enabled: Boolean(name),
  });
}

// ─── Post Application ─────────────────────────────────────────────────────────

export function useQueryPostApplicationProviderStatusFindCurrent(
  provider: PostApplicationProvider,
  accountKey: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.postApplication.providerStatus(provider, accountKey),
    queryFn: () => api.postApplicationProviderStatus({ provider, accountKey }),
    enabled,
  });
}

export function useQueryPostApplicationInboxFindAll(
  provider: PostApplicationProvider,
  accountKey: string,
  limit = 100,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.postApplication.inbox(provider, accountKey, limit),
    queryFn: () => api.getPostApplicationInbox({ provider, accountKey, limit }),
    enabled,
  });
}

export function useQueryPostApplicationRunsFindAll(
  provider: PostApplicationProvider,
  accountKey: string,
  limit = 20,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.postApplication.runs(provider, accountKey, limit),
    queryFn: () => api.getPostApplicationRuns({ provider, accountKey, limit }),
    enabled,
  });
}

export function useQueryPostApplicationRunMessagesFindAll(
  runId: string | null | undefined,
  provider: PostApplicationProvider,
  accountKey: string,
  enabled = true,
) {
  return useQuery<{
    run: PostApplicationSyncRun;
    items: PostApplicationInboxItem[];
    total: number;
  } | null>({
    queryKey: queryKeys.postApplication.runMessages(
      runId ?? "",
      provider,
      accountKey,
    ),
    queryFn: () =>
      runId
        ? api.getPostApplicationRunMessages({ runId, provider, accountKey })
        : Promise.resolve(null),
    enabled: Boolean(enabled && runId),
  });
}

// ─── Backups ──────────────────────────────────────────────────────────────────

export function useQueryBackupsFindAll() {
  return useQuery<BackupListResponse>({
    queryKey: queryKeys.backups.list(),
    queryFn: api.getBackups,
  });
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

export function useQueryDemoInfoFindCurrent() {
  return useQuery<DemoInfoResponse | null>({
    queryKey: queryKeys.demo.info(),
    queryFn: async () => {
      try {
        return await api.getDemoInfo();
      } catch {
        return null;
      }
    },
  });
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export function useQueryLlmValidate(
  input: {
    apiKey?: string | null;
    provider?: string | null;
    baseUrl?: string | null;
  },
  enabled = false,
) {
  return useQuery({
    queryKey: ["onboarding", "validate-llm", input],
    queryFn: () =>
      api.validateLlm({
        apiKey: input.apiKey ?? undefined,
        provider: input.provider ?? undefined,
        baseUrl: input.baseUrl ?? undefined,
      }),
    enabled,
  });
}
