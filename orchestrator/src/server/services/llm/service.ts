import { logger } from "@infra/logger";
import { toStringOrNull } from "@shared/utils/type-conversion";
import {
  buildModeCacheKey,
  getOrderedModes,
  rememberSuccessfulMode,
} from "./policies/mode-selection";
import { getRetryDelayMs, shouldRetryAttempt } from "./policies/retry-policy";
import { strategies } from "./providers";
import type {
  JsonSchemaDefinition,
  LlmApiError,
  LlmProvider,
  LlmRequestOptions,
  LlmResponse,
  LlmServiceOptions,
  LlmValidationResult,
  ResponseMode,
  ToolMessage,
} from "./types";
import { buildHeaders, getResponseDetail } from "./utils/http";
import { parseJsonContent } from "./utils/json";
import { parseErrorMessage, truncate } from "./utils/string";

export class LlmService {
  private readonly provider: LlmProvider;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly strategy: (typeof strategies)[LlmProvider];

  constructor(options: LlmServiceOptions = {}) {
    const normalizedBaseUrl =
      toStringOrNull(options.baseUrl) ||
      toStringOrNull(process.env.LLM_BASE_URL) ||
      null;
    const resolvedProvider = normalizeProvider(
      options.provider ?? process.env.LLM_PROVIDER ?? null,
      normalizedBaseUrl,
    );

    const strategy = strategies[resolvedProvider];
    const baseUrl = normalizedBaseUrl || strategy.defaultBaseUrl;

    let apiKey =
      toStringOrNull(options.apiKey) ||
      toStringOrNull(process.env.LLM_API_KEY) ||
      null;

    // Backwards-compat migration: OPENROUTER_API_KEY -> LLM_API_KEY.
    // This prevents users from losing access when upgrading (keys are often only shown once).
    if (
      !apiKey &&
      resolvedProvider === "openrouter" &&
      toStringOrNull(process.env.OPENROUTER_API_KEY)
    ) {
      logger.warn(
        "[DEPRECATED] OPENROUTER_API_KEY is deprecated. Copying to LLM_API_KEY; please update your environment.",
      );
      const migrated = toStringOrNull(process.env.OPENROUTER_API_KEY);
      if (migrated) {
        process.env.LLM_API_KEY = migrated;
        apiKey = migrated;
      }
    }

    this.provider = resolvedProvider;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.strategy = strategy;
  }

  async callJson<T>(options: LlmRequestOptions<T>): Promise<LlmResponse<T>> {
    if (this.strategy.requiresApiKey && !this.apiKey) {
      return { success: false, error: "LLM API key not configured" };
    }

    const {
      model,
      messages,
      jsonSchema,
      maxRetries = 0,
      retryDelayMs = 500,
      signal,
    } = options;
    const jobId = options.jobId;

    const cacheKey = buildModeCacheKey(this.provider, this.baseUrl);
    const modes = getOrderedModes(cacheKey, this.strategy.modes);

    for (const mode of modes) {
      const result = await this.tryMode<T>({
        mode,
        model,
        messages,
        jsonSchema,
        maxRetries,
        retryDelayMs,
        jobId,
        signal,
      });

      if (result.success) {
        rememberSuccessfulMode(cacheKey, mode);
        return result;
      }

      if (!result.success && result.error.startsWith("CAPABILITY:")) {
        continue;
      }

      return result;
    }

    return { success: false, error: "All provider modes failed" };
  }

  getProvider(): LlmProvider {
    return this.provider;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Call the LLM with tools. Runs an agent loop: if the model returns tool_calls,
   * executes them and continues until the model returns content or maxToolRounds is reached.
   * Returns the final messages (including tool results) for the caller to process.
   */
  async callWithTools(args: {
    model: string;
    messages: ToolMessage[];
    tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    executeTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
    signal?: AbortSignal;
    maxToolRounds?: number;
  }): Promise<
    | { success: true; messages: ToolMessage[] }
    | { success: false; error: string }
  > {
    const { strategy } = this;
    if (!strategy.buildRequestWithTools || !strategy.extractToolCalls) {
      return {
        success: false,
        error: "Tool calling is not supported by this LLM provider",
      };
    }
    if (this.strategy.requiresApiKey && !this.apiKey) {
      return { success: false, error: "LLM API key not configured" };
    }

    const maxRounds = args.maxToolRounds ?? 5;
    let messages: ToolMessage[] = [...args.messages];

    for (let round = 0; round < maxRounds; round++) {
      args.signal?.throwIfAborted();

      const { url, headers, body } = strategy.buildRequestWithTools({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        model: args.model,
        messages,
        tools: args.tools,
      });

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: args.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const err = new Error(
          `LLM API error: ${response.status}${errorBody ? ` - ${truncate(errorBody, 200)}` : ""}`,
        ) as LlmApiError;
        err.status = response.status;
        err.body = truncate(errorBody, 600);
        throw err;
      }

      const data = (await response.json()) as Record<string, unknown>;
      const toolCalls = strategy.extractToolCalls(data);
      const content =
        strategy.extractMessageContent?.(data) ?? strategy.extractText(data);

      const choices = data?.choices as Array<{ message?: unknown }> | undefined;
      const assistantMessage = choices?.[0]?.message as
        | { role?: string; content?: string | null; tool_calls?: unknown[] }
        | undefined;
      const assistantToolCalls = assistantMessage?.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        messages = [
          ...messages,
          {
            role: "assistant",
            content: assistantMessage?.content ?? null,
            tool_calls: assistantToolCalls as Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>,
          },
        ];

        for (const tc of toolCalls) {
          let toolResult: unknown;
          try {
            const parsedArgs =
              typeof tc.function.arguments === "string"
                ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
                : {};
            toolResult = await args.executeTool(tc.function.name, parsedArgs);
          } catch (err) {
            toolResult = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
          messages.push({
            role: "tool",
            content: JSON.stringify(toolResult),
            tool_call_id: tc.id,
          });
        }
        continue;
      }

      if (content && typeof content === "string" && content.trim()) {
        messages = [
          ...messages,
          { role: "assistant", content: content.trim() },
        ];
      }
      return { success: true, messages };
    }

    return {
      success: false,
      error: `Tool loop exceeded ${maxRounds} rounds`,
    };
  }

  async validateCredentials(): Promise<LlmValidationResult> {
    if (this.strategy.requiresApiKey && !this.apiKey) {
      return { valid: false, message: "LLM API key is missing." };
    }

    const urls = this.strategy.getValidationUrls({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
    });
    let lastMessage: string | null = null;

    for (const url of urls) {
      try {
        const validationApiKey =
          this.provider === "gemini" ? null : this.apiKey;
        const response = await fetch(url, {
          method: "GET",
          headers: buildHeaders({
            apiKey: validationApiKey,
            provider: this.provider,
          }),
        });

        if (response.ok) {
          return { valid: true, message: null };
        }

        const detail = await getResponseDetail(response);
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            message: "Invalid LLM API key. Check the key and try again.",
          };
        }
        logger.warn("LLM credential validation request failed", {
          provider: this.provider,
          status: response.status,
          detail: detail || null,
        });

        lastMessage = detail || `LLM provider returned ${response.status}`;
      } catch (error) {
        logger.warn("LLM credential validation request errored", {
          provider: this.provider,
          error: error instanceof Error ? error.message : String(error),
        });
        lastMessage =
          error instanceof Error ? error.message : "LLM validation failed.";
      }
    }

    return {
      valid: false,
      message: lastMessage || "LLM provider validation failed.",
    };
  }

  private async tryMode<T>(args: {
    mode: ResponseMode;
    model: string;
    messages: LlmRequestOptions<T>["messages"];
    jsonSchema: JsonSchemaDefinition;
    maxRetries: number;
    retryDelayMs: number;
    jobId?: string;
    signal?: AbortSignal;
  }): Promise<LlmResponse<T>> {
    const {
      mode,
      model,
      messages,
      jsonSchema,
      maxRetries,
      retryDelayMs,
      signal,
    } = args;
    const jobId = args.jobId;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info("LLM retry attempt", {
            jobId: jobId ?? "unknown",
            attempt,
            maxRetries,
          });
          await sleep(getRetryDelayMs(retryDelayMs, attempt));
        }

        const { url, headers, body } = this.strategy.buildRequest({
          mode,
          baseUrl: this.baseUrl,
          apiKey: this.apiKey,
          model,
          messages,
          jsonSchema,
        });

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "No error body");
          const parsedError = parseErrorMessage(errorBody);
          const detail = parsedError ? ` - ${truncate(parsedError, 400)}` : "";
          const err = new Error(
            `LLM API error: ${response.status}${detail}`,
          ) as LlmApiError;
          err.status = response.status;
          err.body = truncate(errorBody, 600);
          throw err;
        }

        const data = await response.json();
        const content = this.strategy.extractText(data);

        if (!content) {
          throw new Error("No content in response");
        }

        const parsed = parseJsonContent<T>(content, jobId);
        return { success: true, data: parsed };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = (error as LlmApiError).status;
        const body = (error as LlmApiError).body;

        if (
          this.strategy.isCapabilityError({
            mode,
            status,
            body,
          })
        ) {
          return { success: false, error: `CAPABILITY:${message}` };
        }

        if (attempt < maxRetries && shouldRetryAttempt({ message, status })) {
          logger.warn("LLM attempt failed, retrying", {
            jobId: jobId ?? "unknown",
            attempt: attempt + 1,
            maxRetries,
            status: status ?? "no-status",
            message,
          });
          continue;
        }

        return { success: false, error: message };
      }
    }

    return { success: false, error: "All retry attempts failed" };
  }
}

function normalizeProvider(
  raw: string | null,
  baseUrl: string | null,
): LlmProvider {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "openai_compatible") {
    if (
      baseUrl?.includes("localhost:1234") ||
      baseUrl?.includes("127.0.0.1:1234")
    ) {
      return "lmstudio";
    }
    return "openai";
  }
  if (normalized === "openai") return "openai";
  if (normalized === "gemini") return "gemini";
  if (normalized === "lmstudio") return "lmstudio";
  if (normalized === "ollama") return "ollama";
  if (normalized && normalized !== "openrouter") {
    logger.warn("Unknown LLM provider, defaulting to openrouter", {
      normalized,
    });
  }
  return "openrouter";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
