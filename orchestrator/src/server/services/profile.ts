import type { ResumeProfile } from "@shared/types";
import {
  clearAllProfileCaches,
  getActiveProfileSource,
} from "./profile-sources";

export { clearAllProfileCaches };

/**
 * Get the base resume profile from the configured source (RxResume or raw text).
 *
 * Results are cached inside each source implementation until clearProfileCache()
 * is called.
 *
 * @param forceRefresh  Force reload from the upstream source.
 * @throws Error if the source is not configured or the fetch fails.
 */
export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  const source = await getActiveProfileSource();
  return source.getProfile(forceRefresh);
}

/**
 * Get the person's name from the profile.
 */
export async function getPersonName(): Promise<string> {
  const profile = await getProfile();
  return profile?.basics?.name || "Resume";
}

/**
 * Clear the profile cache for all sources.
 */
export function clearProfileCache(): void {
  clearAllProfileCaches();
}
