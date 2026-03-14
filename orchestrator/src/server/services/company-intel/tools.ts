/**
 * Optional tools for the company-intel LLM agent: WebSearch and WebScrape.
 * The model can call these to gather context before extracting structured data.
 */

import { logger } from "@infra/logger";
import { JSDOM } from "jsdom";

const SEARCH_TIMEOUT_MS = 30_000;
const SCRAPE_TIMEOUT_MS = 25_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchToolResult {
  results: WebSearchResult[];
  count: number;
  query: string;
  error?: string;
}

/**
 * Search the web using DuckDuckGo HTML and return titles, URLs, and snippets.
 */
export async function webSearch(args: {
  query: string;
  limit?: number;
}): Promise<WebSearchToolResult> {
  const maxLimit = 30;
  const limit = Math.min(args.limit ?? 10, maxLimit);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        body: new URLSearchParams({ q: args.query, kl: "wt-wt" }).toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        error: `DuckDuckGo request failed with status ${response.status}`,
        results: [],
        count: 0,
        query: args.query,
      };
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const results: WebSearchResult[] = [];

    for (const el of doc.querySelectorAll(".result")) {
      if (results.length >= limit) break;

      const titleEl =
        el.querySelector(".result__a") ?? el.querySelector(".result__title");
      const title = titleEl?.textContent?.trim() ?? "";

      const linkEl = el.querySelector(".result__a");
      const linkHref = linkEl?.getAttribute("href") ?? "";
      const displayUrl =
        el.querySelector(".result__url")?.textContent?.trim() ?? "";
      const rawUrl = linkHref || displayUrl;

      const snippet =
        el.querySelector(".result__snippet")?.textContent?.trim() ?? "";

      if (title && rawUrl) {
        const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
        results.push({ title, url, snippet });
      }
    }

    return { results, count: results.length, query: args.query };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Web search tool failed", {
      query: args.query,
      error: message,
    });
    return {
      error: `Web search failed: ${message}`,
      results: [],
      count: 0,
      query: args.query,
    };
  }
}

export interface WebScrapeToolResult {
  url: string;
  title: string;
  description: string;
  headings: Array<{ level: number; text: string }>;
  paragraphs: string[];
  links: Array<{ text: string; url: string }>;
  error?: string;
}

/**
 * Fetch a web page and extract title, description, headings, paragraphs, and links.
 */
export async function webScrape(args: {
  url: string;
}): Promise<WebScrapeToolResult> {
  const empty: WebScrapeToolResult = {
    url: args.url,
    title: "",
    description: "",
    headings: [],
    paragraphs: [],
    links: [],
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(args.url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        ...empty,
        error: `Failed to fetch page: HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const base = new URL(args.url).origin;

    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "");

    const extract = (tag: string): string[] => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
      const out: string[] = [];
      let m = re.exec(clean);
      while (m !== null) {
        const text = m[1]
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 20) out.push(text);
        m = re.exec(clean);
      }
      return out;
    };

    const extractLinks = (): Array<{ text: string; url: string }> => {
      const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const out: Array<{ text: string; url: string }> = [];
      let m = re.exec(clean);
      while (m !== null) {
        const href = m[1].startsWith("http") ? m[1] : `${base}${m[1]}`;
        const text = m[2].replace(/<[^>]+>/g, "").trim();
        if (text && !href.includes("javascript:"))
          out.push({ text, url: href });
        m = re.exec(clean);
      }
      return out;
    };

    const title =
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const description =
      html.match(/name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ??
      "";

    return {
      url: args.url,
      title,
      description,
      headings: [
        ...extract("h1").map((t) => ({ level: 1, text: t })),
        ...extract("h2").map((t) => ({ level: 2, text: t })),
        ...extract("h3").map((t) => ({ level: 3, text: t })),
      ],
      paragraphs: extract("p"),
      links: extractLinks(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Web scrape tool failed", { url: args.url, error: message });
    return {
      ...empty,
      error: `Scrape failed: ${message}`,
    };
  }
}

/** Tool definitions for the LLM API (OpenAI/OpenRouter format). */
export const COMPANY_INTEL_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web using DuckDuckGo and return titles, URLs, and snippets for the top results. Use when you need more information about a company.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query (e.g. 'BairesDev company Buenos Aires')",
          },
          limit: {
            type: "integer",
            description:
              "Maximum number of results to return (default: 10, max: 30)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_scrape",
      description:
        "Fetch a web page and extract its title, description, headings, paragraphs, and links as structured data. Use to get detailed content from a URL found via web_search.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL of the page to scrape",
          },
        },
        required: ["url"],
      },
    },
  },
];

export function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === "web_search") {
    return webSearch({
      query: String(args.query ?? ""),
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
  }
  if (name === "web_scrape") {
    return webScrape({ url: String(args.url ?? "") });
  }
  return Promise.resolve({ error: `Unknown tool: ${name}` });
}
