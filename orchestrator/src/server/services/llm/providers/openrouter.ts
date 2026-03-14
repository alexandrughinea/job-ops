import { buildHeaders, joinUrl } from "../utils/http";
import { getNestedValue } from "../utils/object";
import {
  buildChatCompletionsBody,
  buildChatCompletionsBodyWithTools,
  createProviderStrategy,
  extractChatCompletionsText,
} from "./factory";

function extractToolCalls(response: unknown): Array<{
  id: string;
  function: { name: string; arguments: string };
}> | null {
  const toolCalls = getNestedValue(response, [
    "choices",
    0,
    "message",
    "tool_calls",
  ]);
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  return toolCalls
    .filter(
      (
        tc,
      ): tc is { id: string; function: { name: string; arguments: string } } =>
        tc &&
        typeof tc === "object" &&
        typeof (tc as { id?: unknown }).id === "string" &&
        typeof (tc as { function?: unknown }).function === "object",
    )
    .map((tc) => ({
      id: tc.id,
      function: tc.function,
    }));
}

export const openRouterStrategy = createProviderStrategy({
  provider: "openrouter",
  defaultBaseUrl: "https://openrouter.ai",
  requiresApiKey: true,
  modes: ["json_schema", "none"],
  validationPaths: ["/api/v1/key"],
  buildRequest: ({ mode, baseUrl, apiKey, model, messages, jsonSchema }) => {
    return {
      url: joinUrl(baseUrl, "/api/v1/chat/completions"),
      headers: buildHeaders({ apiKey, provider: "openrouter" }),
      body: buildChatCompletionsBody({
        mode,
        model,
        messages,
        jsonSchema,
        extra: { plugins: [{ id: "response-healing" }] },
      }),
    };
  },
  buildRequestWithTools: ({ baseUrl, apiKey, model, messages, tools }) => ({
    url: joinUrl(baseUrl, "/api/v1/chat/completions"),
    headers: buildHeaders({ apiKey, provider: "openrouter" }),
    body: buildChatCompletionsBodyWithTools({
      model,
      messages: messages as Parameters<
        typeof buildChatCompletionsBodyWithTools
      >[0]["messages"],
      tools,
      extra: { plugins: [{ id: "response-healing" }] },
    }),
  }),
  extractText: extractChatCompletionsText,
  extractToolCalls,
  extractMessageContent: extractChatCompletionsText,
});
