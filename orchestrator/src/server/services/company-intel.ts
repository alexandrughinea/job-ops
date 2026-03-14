/**
 * Service for fetching company intelligence via DuckDuckGo search + LLM extraction.
 */

import { logger } from "@infra/logger";
import type { CompanyIntel } from "@shared/types";
import { getSetting } from "../repositories/settings";
import { COMPANY_INTEL_TOOLS, executeTool } from "./company-intel/tools";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";

/** Raw shape returned by the LLM (snake_case to match JSON schema conventions). */
interface CompanyIntelRaw {
  company_name: string;
  description: string;
  vitals: {
    revenue: number | null;
    profit: number | null;
    employees: number | null;
  };
  founders: Array<{ name: string; role: string; bio: string | null }>;
  headquarters: { address: string; city: string; country: string };
  capital: number | null;
  industry: string;
  locations: Array<{
    location_name: string;
    country: string;
    city: string;
  }>;
  general_opinion: string;
  political_affiliation: string;
  funding_sources: string[];
  project_references: Array<{
    project_name: string;
    description: string | null;
    year: number | null;
  }>;
}

function sanitizeString(s: string | null | undefined): string {
  if (s == null || s.trim() === "") return "Unknown";
  const t = s.trim();
  if (/^[?\-\s.]+$/i.test(t) || t.includes("??") || /^\.+$/.test(t))
    return "Unknown";
  return t;
}

/** Treat -1 or negative placeholder numbers as null. */
function sanitizeNumber(n: number | null | undefined): number | null {
  if (n == null || typeof n !== "number") return null;
  if (n < 0 || Number.isNaN(n)) return null;
  return n;
}

/** Maps the snake_case LLM response to the camelCase TypeScript type. */
function mapRawToIntel(
  raw: CompanyIntelRaw,
  options?: { companyName?: string },
): CompanyIntel {
  return {
    companyName:
      options?.companyName ??
      (sanitizeString(raw.company_name) || raw.company_name),
    description: sanitizeString(raw.description),
    vitals: {
      revenue: sanitizeNumber(raw.vitals?.revenue),
      profit: sanitizeNumber(raw.vitals?.profit),
      employees: sanitizeNumber(raw.vitals?.employees),
    },
    founders: (raw.founders ?? []).map((f) => {
      const bio = f.bio ? sanitizeString(f.bio) : null;
      return {
        name: sanitizeString(f.name) || "Unknown",
        role: sanitizeString(f.role) || "Unknown",
        bio: bio && bio !== "Unknown" ? bio : null,
      };
    }),
    headquarters: {
      address: sanitizeString(raw.headquarters?.address) || "Unknown",
      city: sanitizeString(raw.headquarters?.city) || "Unknown",
      country: sanitizeString(raw.headquarters?.country) || "Unknown",
    },
    capital: sanitizeNumber(raw.capital),
    industry: sanitizeString(raw.industry),
    locations: (raw.locations ?? []).map((loc) => ({
      locationName: sanitizeString(loc.location_name) || "Unknown",
      country: sanitizeString(loc.country) || "Unknown",
      city: sanitizeString(loc.city) || "Unknown",
    })),
    generalOpinion: sanitizeString(raw.general_opinion) || "None known",
    politicalAffiliation:
      sanitizeString(raw.political_affiliation) || "None known",
    fundingSources: Array.isArray(raw.funding_sources)
      ? raw.funding_sources.filter((s) => s && sanitizeString(s) !== "Unknown")
      : [],
    projectReferences: (raw.project_references ?? []).map((p) => ({
      projectName: sanitizeString(p.project_name) || "Unknown",
      description: p.description ? sanitizeString(p.description) : null,
      year: p.year != null && p.year > 0 ? p.year : null,
    })),
  };
}

const COMPANY_INTEL_SCHEMA: JsonSchemaDefinition = {
  name: "company_intelligence",
  schema: {
    type: "object",
    properties: {
      company_name: {
        type: "string",
        description: "The name of the company.",
      },
      description: {
        type: "string",
        description:
          "A 2–4 sentence narrative description of what the company does, its market position, and what makes it distinctive. Write as if briefing a job candidate.",
      },
      vitals: {
        type: "object",
        properties: {
          revenue: {
            type: "number",
            description: "Annual revenue in USD. Use null if unknown.",
          },
          profit: {
            type: "number",
            description: "Annual profit in USD. Use null if unknown.",
          },
          employees: {
            type: "integer",
            description: "Total headcount. Use null if unknown.",
          },
        },
        required: ["revenue", "profit", "employees"],
        additionalProperties: false,
      },
      founders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            bio: {
              type: "string",
              description: "Brief biography. Use null if unknown.",
            },
          },
          required: ["name", "role", "bio"],
          additionalProperties: false,
        },
      },
      headquarters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Full address or best known address.",
          },
          city: { type: "string" },
          country: { type: "string" },
        },
        required: ["address", "city", "country"],
        additionalProperties: false,
      },
      capital: {
        type: "number",
        description: "Total capital raised in USD. Use null if unknown.",
      },
      industry: {
        type: "string",
        description: "Primary industry or sector.",
      },
      locations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            location_name: {
              type: "string",
              description: "e.g. London Office, Dublin Hub",
            },
            country: { type: "string" },
            city: { type: "string" },
          },
          required: ["location_name", "country", "city"],
          additionalProperties: false,
        },
      },
      general_opinion: {
        type: "string",
        description:
          "General public opinion and reputation. Be concise and balanced.",
      },
      political_affiliation: {
        type: "string",
        description:
          "Known political affiliations or leanings, or 'None known' if not applicable.",
      },
      funding_sources: {
        type: "array",
        items: {
          type: "string",
          description: "Name of funding source or investor.",
        },
      },
      project_references: {
        type: "array",
        items: {
          type: "object",
          properties: {
            project_name: { type: "string" },
            description: {
              type: "string",
              description: "Brief description. Use null if unknown.",
            },
            year: {
              type: "integer",
              description: "Year initiated or completed. Use null if unknown.",
            },
          },
          required: ["project_name", "description", "year"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "company_name",
      "description",
      "vitals",
      "founders",
      "headquarters",
      "capital",
      "industry",
      "locations",
      "general_opinion",
      "political_affiliation",
      "funding_sources",
      "project_references",
    ],
    additionalProperties: false,
  },
};

export interface CompanySearchResult {
  context: string;
  hasResults: boolean;
}

/**
 * Job context passed when researching a company from a job listing.
 * Used to build richer search queries (name, location, inferred terms).
 */
export interface CompanyIntelJobContext {
  jobTitle?: string;
  jobLocation?: string;
  jobDescriptionSnippet?: string;
  skills?: string;
  companyIndustry?: string;
  jobType?: string;
  jobFunction?: string;
}

/**
 * Build search query hints from job context for the LLM agent.
 * Instructs the model to use name, location, and inferred terms when calling web_search.
 */
function buildSearchQueryHints(
  companyName: string,
  jobContext?: CompanyIntelJobContext | null,
): string {
  if (!jobContext) return "";

  const location = jobContext.jobLocation?.trim();
  const industry = jobContext.companyIndustry?.trim();
  const jobFunction = jobContext.jobFunction?.trim();
  const jobTitle = jobContext.jobTitle?.trim();

  // Infer industry/role terms from job title (e.g. "Senior React Developer" -> "software", "React")
  const inferredTerms: string[] = [];
  if (jobTitle) {
    const words = jobTitle
      .split(/\s+/)
      .filter((w) => w.length > 2 && !/^(the|and|for|or|at|in|of)$/i.test(w)) // skip stopwords
      .slice(0, 3);
    inferredTerms.push(...words);
  }
  if (jobFunction && !inferredTerms.includes(jobFunction)) {
    inferredTerms.push(jobFunction);
  }
  if (industry && !inferredTerms.includes(industry)) {
    inferredTerms.push(industry);
  }

  const queryExamples: string[] = [`"${companyName}" company`];
  if (location) {
    queryExamples.push(`"${companyName}" company ${location}`);
  }
  if (inferredTerms.length > 0) {
    const term = inferredTerms[0];
    queryExamples.push(`"${companyName}" ${term} company`);
  }

  return `${[
    location ? `Location: ${location}` : null,
    industry ? `Industry: ${industry}` : null,
    jobTitle ? `Job title: ${jobTitle}` : null,
    inferredTerms.length > 0
      ? `Inferred terms: ${inferredTerms.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(". ")}

When using web_search, build queries that include the company name and optionally location or industry (e.g. ${queryExamples.join(" or ")}).`;
}

/**
 * Build the DuckDuckGo search query from company name and job context.
 */
function buildSearchQuery(
  companyName: string,
  jobContext?: CompanyIntelJobContext | null,
): string {
  const location = jobContext?.jobLocation?.trim();
  const industry = jobContext?.companyIndustry?.trim();
  const jobTitle = jobContext?.jobTitle?.trim();

  const terms = [companyName, "company"];
  if (location) terms.push(location);
  const industryTerm = industry || (jobTitle ? jobTitle.split(/\s+/)[0] : null);
  if (industryTerm && industryTerm.length > 2) terms.push(industryTerm);

  return terms.join(" ");
}

/**
 * Search DuckDuckGo for company information via the instant answer API.
 * Returns a text summary for use as LLM context.
 */
async function searchDuckDuckGo(
  companyName: string,
  jobLocation?: string,
  jobContext?: CompanyIntelJobContext | null,
): Promise<string> {
  const queryTerms = jobContext
    ? buildSearchQuery(companyName, jobContext)
    : jobLocation
      ? `${companyName} company ${jobLocation}`
      : `${companyName} company`;
  const query = encodeURIComponent(queryTerms);
  const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "JobOps/1.0 (company-intel-lookup)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn("DuckDuckGo search returned non-OK status", {
        company: companyName,
        status: response.status,
      });
      return "";
    }

    const data = (await response.json()) as DuckDuckGoResponse;
    return buildContextFromDDG(data, companyName);
  } catch (error) {
    logger.warn("DuckDuckGo search failed", {
      company: companyName,
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
}

interface DuckDuckGoResponse {
  Abstract?: string;
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Heading?: string;
  Type?: string;
  RelatedTopics?: DuckDuckGoTopic[];
  Results?: DuckDuckGoTopic[];
  InfoBox?: {
    content?: Array<{ label?: string; value?: string }>;
  };
}

function buildContextFromDDG(
  data: DuckDuckGoResponse,
  companyName: string,
): string {
  const parts: string[] = [];

  if (data.Heading) {
    parts.push(`Company: ${data.Heading}`);
  }

  if (data.AbstractText) {
    parts.push(`Summary: ${data.AbstractText}`);
  } else if (data.Abstract) {
    parts.push(`Summary: ${data.Abstract}`);
  }

  if (data.AbstractSource) {
    parts.push(`Source: ${data.AbstractSource}`);
  }

  if (data.InfoBox?.content) {
    const infoItems = data.InfoBox.content
      .filter((item) => item.label && item.value)
      .slice(0, 20)
      .map((item) => `${item.label}: ${item.value}`)
      .join("\n");
    if (infoItems) {
      parts.push(`InfoBox:\n${infoItems}`);
    }
  }

  const relatedTexts = (data.RelatedTopics ?? [])
    .filter((t): t is DuckDuckGoTopic & { Text: string } => Boolean(t.Text))
    .slice(0, 5)
    .map((t) => t.Text);

  if (relatedTexts.length > 0) {
    parts.push(`Related:\n${relatedTexts.join("\n")}`);
  }

  if (parts.length === 0) {
    return `No DuckDuckGo results found for "${companyName}".`;
  }

  return parts.join("\n\n");
}

function buildCompanyIntelPrompt(
  companyName: string,
  searchContext: string,
  jobLocation?: string,
): string {
  const locationHint = jobLocation
    ? `\nJOB LOCATION HINT: The job posting is in "${jobLocation}" — use this to refine headquarters / office location data.\n`
    : "";

  return `You are a research analyst. Extract structured intelligence about the company named "${companyName}" using the search context below and your own knowledge.

SEARCH CONTEXT:
${searchContext || "(No search results available — use your own knowledge.)"}
${locationHint}
INSTRUCTIONS:
- Use JSON null for unknown numeric fields (revenue, profit, employees, capital). Never use -1, 0, or placeholder numbers.
- For unknown or empty string fields, use "Unknown" or "None known" — never use question marks (??), ellipses (...), dashes, or placeholder symbols.
- For "description", write 2–4 sentences. If unknown, use "Unknown".
- For "generalOpinion", provide a concise summary. If unknown, use "None known".
- For "politicalAffiliation", use "None known" if not applicable.
- For "headquarters" and "locations", use "Unknown" for city/country if unknown. Never use "??" or "..??".
- For "fundingSources" and "projectReferences", use empty arrays [] if none known.
- Revenue and profit: approximate annual USD, or null if unknown.
- "capital" is total funding raised (not valuation), or null if unknown.

Return ONLY valid JSON — no markdown, no explanation.`;
}

/**
 * Run only the DuckDuckGo search step — used for the two-step client flow.
 * Pass jobContext to improve search relevance (name, location, inferred terms).
 */
export async function searchCompanyContext(
  companyName: string,
  signal?: AbortSignal,
  jobLocation?: string,
  jobContext?: CompanyIntelJobContext | null,
): Promise<CompanySearchResult> {
  signal?.throwIfAborted();
  const context = await searchDuckDuckGo(
    companyName,
    jobLocation ?? jobContext?.jobLocation,
    jobContext,
  );
  const hasResults =
    context.length > 0 && !context.startsWith("No DuckDuckGo results");
  return { context, hasResults };
}

function buildAgentPrompt(
  companyName: string,
  searchContext: string,
  jobLocation?: string,
  jobContext?: CompanyIntelJobContext | null,
): string {
  const locationHint = jobLocation
    ? `\nJOB LOCATION: The job is in "${jobLocation}" — use this for headquarters/office data.\n`
    : "";

  const searchHints = buildSearchQueryHints(companyName, jobContext);
  const searchHintsBlock = searchHints
    ? `\nSEARCH QUERY HINTS:\n${searchHints}\n`
    : "";

  return `You are a research analyst. Extract structured intelligence about the company "${companyName}".

INITIAL CONTEXT:
${searchContext || "(No pre-fetched results — use web_search to find information.)"}
${locationHint}${searchHintsBlock}

You may optionally use web_search to find more information, and web_scrape to fetch detailed content from URLs. When you have enough context, respond with your analysis.`;
}

function formatConversationForExtraction(
  messages: Array<{ role: string; content: string | null }>,
): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.content) {
      parts.push(`[User] ${m.content}`);
    } else if (m.role === "assistant" && m.content) {
      parts.push(`[Assistant] ${m.content}`);
    } else if (m.role === "tool" && m.content) {
      try {
        const parsed = JSON.parse(m.content) as unknown;
        if (parsed && typeof parsed === "object" && "error" in parsed) {
          parts.push(`[Tool error] ${(parsed as { error: string }).error}`);
        } else if (
          parsed &&
          typeof parsed === "object" &&
          "results" in parsed
        ) {
          const r = parsed as {
            results?: Array<{ title?: string; url?: string; snippet?: string }>;
          };
          const items = (r.results ?? [])
            .slice(0, 8)
            .map(
              (x) =>
                `- ${x.title ?? ""} | ${x.url ?? ""}\n  ${(x.snippet ?? "").slice(0, 200)}`,
            )
            .join("\n");
          parts.push(`[Search results]\n${items || "(none)"}`);
        } else if (parsed && typeof parsed === "object" && "title" in parsed) {
          const s = parsed as {
            title?: string;
            description?: string;
            paragraphs?: string[];
          };
          const p = (s.paragraphs ?? []).slice(0, 5).join("\n");
          parts.push(
            `[Scraped page: ${s.title ?? ""}]\n${s.description ?? ""}\n${p}`,
          );
        } else {
          parts.push(`[Tool result] ${m.content.slice(0, 1500)}`);
        }
      } catch {
        parts.push(`[Tool result] ${m.content.slice(0, 1500)}`);
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Run only the LLM extraction step — used for the two-step client flow.
 * When the provider supports tools, uses web_search and web_scrape as optional tools.
 */
export async function extractCompanyIntel(
  companyName: string,
  searchContext: string,
  signal?: AbortSignal,
  jobLocation?: string,
  jobContext?: CompanyIntelJobContext | null,
): Promise<CompanyIntel> {
  const [overrideModel, overrideModelProjectSelection] = await Promise.all([
    getSetting("model"),
    getSetting("modelProjectSelection"),
  ]);

  const model =
    overrideModelProjectSelection ||
    overrideModel ||
    process.env.MODEL ||
    "google/gemini-3-flash-preview";

  signal?.throwIfAborted();

  const llm = new LlmService();

  let contextForExtraction: string =
    searchContext || "(No search results — use your knowledge.)";

  // Try agent flow with tools when provider supports it
  try {
    const toolsResult = await llm.callWithTools({
      model,
      messages: [
        {
          role: "user",
          content: buildAgentPrompt(
            companyName,
            searchContext,
            jobLocation ?? jobContext?.jobLocation,
            jobContext,
          ),
        },
      ],
      tools: COMPANY_INTEL_TOOLS,
      executeTool,
      signal,
      maxToolRounds: 5,
    });

    if (toolsResult.success && toolsResult.messages.length > 1) {
      contextForExtraction = formatConversationForExtraction(
        toolsResult.messages as Array<{ role: string; content: string | null }>,
      );
    }
  } catch (err) {
    logger.warn("Company intel tool loop failed, using pre-fetched context", {
      company: companyName,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const prompt = buildCompanyIntelPrompt(
    companyName,
    contextForExtraction,
    jobLocation,
  );

  const result = await llm.callJson<CompanyIntelRaw>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: COMPANY_INTEL_SCHEMA,
    maxRetries: 1,
    signal,
  });

  if (!result.success) {
    logger.error("Company intel LLM extraction failed", {
      company: companyName,
      error: result.error,
    });
    throw new Error(`Company intelligence extraction failed: ${result.error}`);
  }

  return mapRawToIntel(result.data, { companyName });
}

export type CompanyIntelProgressEvent =
  | { type: "step"; label: string; detail?: string }
  | { type: "done"; intel: CompanyIntel }
  | { type: "error"; message: string };

/**
 * Look up company intelligence using DuckDuckGo search + LLM extraction.
 */
export async function lookupCompanyIntel(
  companyName: string,
  signal?: AbortSignal,
  onProgress?: (event: CompanyIntelProgressEvent) => void,
  jobContext?: CompanyIntelJobContext | null,
): Promise<{ intel: CompanyIntel; searchContext: string }> {
  const [overrideModel, overrideModelProjectSelection] = await Promise.all([
    getSetting("model"),
    getSetting("modelProjectSelection"),
  ]);

  const model =
    overrideModelProjectSelection ||
    overrideModel ||
    process.env.MODEL ||
    "google/gemini-3-flash-preview";

  logger.info("Looking up company intel", { company: companyName, model });

  signal?.throwIfAborted();

  onProgress?.({ type: "step", label: "Searching the web…" });
  const searchContext = await searchDuckDuckGo(
    companyName,
    jobContext?.jobLocation,
    jobContext,
  );

  signal?.throwIfAborted();

  const hasContext =
    searchContext.length > 0 &&
    !searchContext.startsWith("No DuckDuckGo results");
  onProgress?.({
    type: "step",
    label: hasContext ? "Found results" : "No web results — using AI knowledge",
    detail: hasContext ? "DuckDuckGo" : undefined,
  });

  onProgress?.({ type: "step", label: "Extracting intelligence with AI…" });

  const prompt = buildCompanyIntelPrompt(companyName, searchContext);

  const llm = new LlmService();
  const result = await llm.callJson<CompanyIntelRaw>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: COMPANY_INTEL_SCHEMA,
    maxRetries: 1,
    signal,
  });

  if (!result.success) {
    logger.error("Company intel LLM call failed", {
      company: companyName,
      error: result.error,
    });
    throw new Error(`Company intelligence lookup failed: ${result.error}`);
  }

  logger.info("Company intel retrieved", { company: companyName });

  onProgress?.({ type: "step", label: "Preparing results…" });

  return {
    intel: mapRawToIntel(result.data, { companyName }),
    searchContext,
  };
}
