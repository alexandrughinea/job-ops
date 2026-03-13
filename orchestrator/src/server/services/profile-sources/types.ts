import type { ResumeProfile } from "@shared/types";

export interface ProfileSourceStatus {
  exists: boolean;
  error: string | null;
}

/**
 * Abstraction over resume data sources.
 *
 * Implementations:
 *  - RxResumeProfileSource  – fetches from a configured Reactive Resume account
 *  - RawTextProfileSource   – parses a pasted/uploaded plain-text or PDF-extracted resume via LLM
 */
export interface ProfileSource {
  /** Return the structured profile, using a cached copy when possible. */
  getProfile(forceRefresh?: boolean): Promise<ResumeProfile>;
  /** Evict the in-memory cache so the next call re-fetches. */
  clearCache(): void;
  /** Check whether this source is configured and ready. */
  getStatus(): Promise<ProfileSourceStatus>;
}

export type ProfileSourceMode = "rxresume" | "raw_text";
