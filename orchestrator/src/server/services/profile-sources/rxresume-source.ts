import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import { getResume, RxResumeAuthConfigError } from "../rxresume";
import { getConfiguredRxResumeBaseResumeId } from "../rxresume/baseResumeId";
import type { ProfileSource, ProfileSourceStatus } from "./types";

export class RxResumeProfileSource implements ProfileSource {
  private cachedProfile: ResumeProfile | null = null;
  private cachedResumeId: string | null = null;

  async getProfile(forceRefresh = false): Promise<ResumeProfile> {
    const { resumeId } = await getConfiguredRxResumeBaseResumeId();

    if (!resumeId) {
      throw new Error(
        "Base resume not configured. Please select a base resume from your RxResume account in Settings.",
      );
    }

    if (
      this.cachedProfile &&
      this.cachedResumeId === resumeId &&
      !forceRefresh
    ) {
      return this.cachedProfile;
    }

    try {
      logger.info("Fetching profile from Reactive Resume", { resumeId });
      const resume = await getResume(resumeId);

      if (!resume.data || typeof resume.data !== "object") {
        throw new Error("Resume data is empty or invalid");
      }

      this.cachedProfile = resume.data as unknown as ResumeProfile;
      this.cachedResumeId = resumeId;
      logger.info("Profile loaded from Reactive Resume", { resumeId });
      return this.cachedProfile;
    } catch (error) {
      if (error instanceof RxResumeAuthConfigError) {
        throw new Error(error.message);
      }
      logger.error("Failed to load profile from Reactive Resume", {
        resumeId,
        error,
      });
      throw error;
    }
  }

  clearCache(): void {
    this.cachedProfile = null;
    this.cachedResumeId = null;
  }

  async getStatus(): Promise<ProfileSourceStatus> {
    const { resumeId } = await getConfiguredRxResumeBaseResumeId();

    if (!resumeId) {
      return {
        exists: false,
        error:
          "No base resume selected. Please select a resume from your Reactive Resume account in Settings.",
      };
    }

    try {
      const resume = await getResume(resumeId);
      if (!resume.data || typeof resume.data !== "object") {
        return { exists: false, error: "Selected resume is empty or invalid." };
      }
      return { exists: true, error: null };
    } catch (error) {
      if (error instanceof RxResumeAuthConfigError) {
        return { exists: false, error: error.message };
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return { exists: false, error: message };
    }
  }
}
