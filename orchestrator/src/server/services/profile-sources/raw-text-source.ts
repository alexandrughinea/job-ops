import { logger } from "@infra/logger";
import { createId } from "@paralleldrive/cuid2";
import * as settingsRepo from "@server/repositories/settings";
import type { ResumeProfile } from "@shared/types";
import { LlmService } from "../llm/service";
import type { JsonSchemaDefinition } from "../llm/types";
import type { ProfileSource, ProfileSourceStatus } from "./types";

// ---------------------------------------------------------------------------
// LLM JSON schema for structured extraction
// ---------------------------------------------------------------------------

const PARSE_SCHEMA: JsonSchemaDefinition = {
  name: "resume_profile",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["basics"],
    properties: {
      basics: {
        type: "object",
        properties: {
          name: { type: "string" },
          label: { type: "string" },
          headline: { type: "string" },
          summary: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          location: { type: "string" },
        },
      },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            level: { type: "number" },
            keywords: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            position: { type: "string" },
            location: { type: "string" },
            date: { type: "string" },
            summary: { type: "string" },
          },
          required: ["company", "position"],
        },
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            date: { type: "string" },
            summary: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            area: { type: "string" },
            studyType: { type: "string" },
            date: { type: "string" },
            summary: { type: "string" },
          },
          required: ["institution"],
        },
      },
    },
  },
};

type ParsedResume = {
  basics?: {
    name?: string;
    label?: string;
    headline?: string;
    summary?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  skills?: Array<{ name: string; level?: number; keywords?: string[] }>;
  experience?: Array<{
    company: string;
    position: string;
    location?: string;
    date?: string;
    summary?: string;
  }>;
  projects?: Array<{
    name: string;
    description?: string;
    date?: string;
    summary?: string;
    keywords?: string[];
  }>;
  education?: Array<{
    institution: string;
    area?: string;
    studyType?: string;
    date?: string;
    summary?: string;
  }>;
};

function buildParsePrompt(resumeText: string): string {
  const truncated = resumeText.slice(0, 12000);
  return `Extract structured data from the following resume text. Return all fields you can identify.

RESUME TEXT:
${truncated}`;
}

/**
 * Convert LLM-parsed flat structure to the ResumeProfile shape the pipeline expects.
 * Assigns stable cuid2 IDs to each item so downstream logic that expects them works correctly.
 */
function toResumeProfile(parsed: ParsedResume): ResumeProfile {
  return {
    basics: {
      name: parsed.basics?.name,
      label: parsed.basics?.label,
      headline: parsed.basics?.headline ?? parsed.basics?.label,
      summary: parsed.basics?.summary,
      email: parsed.basics?.email,
      phone: parsed.basics?.phone,
      location: parsed.basics?.location
        ? { address: parsed.basics.location }
        : undefined,
    },
    sections: {
      summary: {
        id: createId(),
        visible: true,
        name: "Summary",
        content: parsed.basics?.summary ?? "",
      },
      skills: {
        id: createId(),
        visible: true,
        name: "Skills",
        items: (parsed.skills ?? []).map((s) => ({
          id: createId(),
          name: s.name,
          description: "",
          level:
            typeof s.level === "number" ? Math.min(5, Math.max(0, s.level)) : 0,
          keywords: s.keywords ?? [],
          visible: true,
        })),
      },
      experience: {
        id: createId(),
        visible: true,
        name: "Experience",
        items: (parsed.experience ?? []).map((e) => ({
          id: createId(),
          company: e.company,
          position: e.position,
          location: e.location ?? "",
          date: e.date ?? "",
          summary: e.summary ?? "",
          visible: true,
        })),
      },
      projects: {
        id: createId(),
        visible: true,
        name: "Projects",
        items: (parsed.projects ?? []).map((p) => ({
          id: createId(),
          name: p.name,
          description: p.description ?? "",
          date: p.date ?? "",
          summary: p.summary ?? "",
          keywords: p.keywords ?? [],
          visible: true,
        })),
      },
      education: {
        id: createId(),
        visible: true,
        name: "Education",
        items: (parsed.education ?? []).map((e) => ({
          id: createId(),
          institution: e.institution,
          area: e.area ?? "",
          studyType: e.studyType ?? "",
          date: e.date ?? "",
          summary: e.summary ?? "",
          visible: true,
        })),
      },
    },
  };
}

/**
 * Minimal fallback profile when LLM parsing is unavailable.
 * Puts the raw text in basics.summary so scoring prompts still receive the content.
 */
function buildFallbackProfile(rawText: string): ResumeProfile {
  return {
    basics: {
      summary: rawText.slice(0, 5000),
    },
    sections: {
      summary: {
        id: createId(),
        visible: true,
        name: "Summary",
        content: rawText.slice(0, 5000),
      },
      skills: { id: createId(), visible: true, name: "Skills", items: [] },
      experience: {
        id: createId(),
        visible: true,
        name: "Experience",
        items: [],
      },
      projects: { id: createId(), visible: true, name: "Projects", items: [] },
    },
  };
}

async function parseResumeText(rawText: string): Promise<ResumeProfile> {
  const [overrideModel, overrideModelTailoring] = await Promise.all([
    settingsRepo.getSetting("model"),
    settingsRepo.getSetting("modelTailoring"),
  ]);
  const model =
    overrideModelTailoring ||
    overrideModel ||
    process.env.MODEL ||
    "google/gemini-3-flash-preview";

  const llm = new LlmService();
  const result = await llm.callJson<ParsedResume>({
    model,
    messages: [{ role: "user", content: buildParsePrompt(rawText) }],
    jsonSchema: PARSE_SCHEMA,
  });

  if (!result.success || !result.data) {
    logger.warn("LLM resume parsing failed, using fallback profile", {
      error: "success" in result && !result.success ? result.error : undefined,
    });
    return buildFallbackProfile(rawText);
  }

  try {
    return toResumeProfile(result.data);
  } catch (error) {
    logger.warn(
      "Failed to convert LLM-parsed resume to profile, using fallback",
      { error },
    );
    return buildFallbackProfile(rawText);
  }
}

// ---------------------------------------------------------------------------

export class RawTextProfileSource implements ProfileSource {
  private cachedProfile: ResumeProfile | null = null;
  private cachedTextHash: number | null = null;

  async getProfile(forceRefresh = false): Promise<ResumeProfile> {
    const rawText = (await settingsRepo.getSetting("rawResumeText")) ?? "";

    if (!rawText.trim()) {
      throw new Error(
        "No resume text configured. Paste your resume in Settings → Profile Source, or upload a PDF.",
      );
    }

    const textHash = rawText.length;
    if (
      this.cachedProfile &&
      this.cachedTextHash === textHash &&
      !forceRefresh
    ) {
      return this.cachedProfile;
    }

    logger.info("Parsing raw-text resume via LLM", {
      charCount: rawText.length,
    });
    const profile = await parseResumeText(rawText);
    this.cachedProfile = profile;
    this.cachedTextHash = textHash;
    logger.info("Raw-text resume profile ready", {
      skills: profile.sections?.skills?.items?.length ?? 0,
      experience: profile.sections?.experience?.items?.length ?? 0,
      projects: profile.sections?.projects?.items?.length ?? 0,
    });
    return profile;
  }

  clearCache(): void {
    this.cachedProfile = null;
    this.cachedTextHash = null;
  }

  async getStatus(): Promise<ProfileSourceStatus> {
    const rawText = (await settingsRepo.getSetting("rawResumeText")) ?? "";
    if (!rawText.trim()) {
      return {
        exists: false,
        error:
          "No resume text saved. Paste your resume text or upload a PDF in Settings.",
      };
    }
    return { exists: true, error: null };
  }
}
