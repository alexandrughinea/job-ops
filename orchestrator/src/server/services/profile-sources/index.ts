import * as settingsRepo from "@server/repositories/settings";
import { RawTextProfileSource } from "./raw-text-source";
import { RxResumeProfileSource } from "./rxresume-source";
import type { ProfileSource, ProfileSourceMode } from "./types";

export type {
  ProfileSource,
  ProfileSourceMode,
  ProfileSourceStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Singleton sources — each source manages its own in-memory cache.
// ---------------------------------------------------------------------------

const sources: Record<ProfileSourceMode, ProfileSource> = {
  rxresume: new RxResumeProfileSource(),
  raw_text: new RawTextProfileSource(),
};

function toMode(raw: string | null | undefined): ProfileSourceMode {
  return raw === "raw_text" ? "raw_text" : "rxresume";
}

/**
 * Return the active profile source based on the current setting.
 * Cheap to call — no I/O unless the DB setting hasn't been read yet.
 */
export async function getActiveProfileSource(): Promise<ProfileSource> {
  const raw = await settingsRepo.getSetting("profileSourceMode");
  return sources[toMode(raw)];
}

/**
 * Evict the cache for all sources (e.g. after settings change).
 */
export function clearAllProfileCaches(): void {
  for (const source of Object.values(sources)) {
    source.clearCache();
  }
}
