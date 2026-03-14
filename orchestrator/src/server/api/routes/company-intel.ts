import { badRequest, requestTimeout, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { setupSse, writeSseData } from "@infra/sse";
import {
  type CompanyIntelProgressEvent,
  extractCompanyIntel,
  lookupCompanyIntel,
} from "@server/services/company-intel";
import type { CompanyIntelResponse } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const companyIntelRouter = Router();

const companyIntelBodySchema = z.object({
  companyName: z.string().trim().min(1).max(500),
});

const companyIntelQuerySchema = z.object({
  companyName: z.string().trim().min(1).max(500),
});

const SERVER_TIMEOUT_MS = 90_000;

function makeAbortController(
  req: Request,
  timeoutMs: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error("Server timeout")),
    timeoutMs,
  );
  const socket = req.socket;
  const onSocketClose = () => {
    clearTimeout(timeoutId);
    controller.abort(new Error("Client disconnected"));
  };
  socket?.on("close", onSocketClose);
  const cleanup = () => {
    clearTimeout(timeoutId);
    socket?.off("close", onSocketClose);
  };
  return { controller, cleanup };
}

const companyIntelJobContextSchema = z
  .object({
    jobTitle: z.string().trim().max(300).optional(),
    jobLocation: z.string().trim().max(200).optional(),
    jobDescriptionSnippet: z.string().max(2000).optional(),
    skills: z.string().max(500).optional(),
    companyIndustry: z.string().trim().max(200).optional(),
    jobType: z.string().trim().max(100).optional(),
    jobFunction: z.string().trim().max(100).optional(),
  })
  .optional();

const companyIntelExtractBodySchema = z.object({
  companyName: z.string().trim().min(1).max(500),
  searchContext: z.string().max(50_000).optional(),
  jobLocation: z.string().trim().max(200).optional(),
  jobContext: companyIntelJobContextSchema,
});

/**
 * POST /api/company-intel/extract
 * Extract company intelligence with AI (uses optional web_search/web_scrape tools).
 */
companyIntelRouter.post("/extract", async (req: Request, res: Response) => {
  const parsed = companyIntelExtractBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, badRequest("Invalid request", parsed.error.flatten()));
  }

  const { companyName, searchContext = "", jobLocation, jobContext } =
    parsed.data;
  const { controller, cleanup } = makeAbortController(req, SERVER_TIMEOUT_MS);

  try {
    const intel = await extractCompanyIntel(
      companyName,
      searchContext,
      controller.signal,
      jobLocation,
      jobContext,
    );
    cleanup();
    return ok(res, { intel });
  } catch (error) {
    cleanup();
    if (res.headersSent) return;
    const appError = toAppError(error);
    if (appError.status === 408) {
      return fail(
        res,
        requestTimeout("Company intelligence extraction timed out"),
      );
    }
    return fail(res, appError);
  }
});

/**
 * GET /api/company-intel/stream?companyName=...
 * Streams progress events via SSE, then emits the final result.
 */
companyIntelRouter.get("/stream", async (req: Request, res: Response) => {
  const parsed = companyIntelQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, badRequest("Invalid request", parsed.error.flatten()));
  }

  const { companyName } = parsed.data;

  logger.info("Company intel stream request received", {
    company: companyName,
  });

  setupSse(res, { disableBuffering: true, flushHeaders: true });

  const { controller, cleanup } = makeAbortController(req, SERVER_TIMEOUT_MS);

  const emit = (event: CompanyIntelProgressEvent) => {
    if (!res.writableEnded) writeSseData(res, event);
  };

  try {
    const result = await lookupCompanyIntel(
      companyName,
      controller.signal,
      emit,
    );
    cleanup();
    emit({ type: "done", intel: result.intel });
    res.end();
  } catch (error) {
    cleanup();
    if (res.writableEnded) return;
    const appError = toAppError(error);
    if (appError.status === 408) {
      logger.warn("Company intel stream timed out or was cancelled", {
        company: companyName,
      });
      emit({ type: "error", message: "Lookup timed out. Please try again." });
    } else {
      logger.error("Company intel stream failed", {
        company: companyName,
        error: appError.message,
      });
      emit({ type: "error", message: appError.message });
    }
    res.end();
  }
});

/**
 * POST /api/company-intel
 * Look up company intelligence via DuckDuckGo + LLM extraction (non-streaming).
 */
companyIntelRouter.post("/", async (req: Request, res: Response) => {
  const parsed = companyIntelBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, badRequest("Invalid request", parsed.error.flatten()));
  }

  const { companyName } = parsed.data;

  logger.info("Company intel request received", { company: companyName });

  const { controller, cleanup } = makeAbortController(req, SERVER_TIMEOUT_MS);

  try {
    const result = await lookupCompanyIntel(companyName, controller.signal);
    cleanup();
    return ok<CompanyIntelResponse>(res, result);
  } catch (error) {
    cleanup();
    if (res.headersSent) return;
    const appError = toAppError(error);
    if (appError.status === 408) {
      logger.warn("Company intel request timed out or was cancelled", {
        company: companyName,
      });
      return fail(res, requestTimeout("Company intelligence lookup timed out"));
    }
    logger.error("Company intel lookup failed", {
      company: companyName,
      error: appError.message,
    });
    return fail(res, appError);
  }
});
