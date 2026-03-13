import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import { DEMO_PROJECT_CATALOG } from "@server/config/demo-defaults";
import * as settingsRepo from "@server/repositories/settings";
import { clearProfileCache, getProfile } from "@server/services/profile";
import { getActiveProfileSource } from "@server/services/profile-sources";
import { extractProjectsFromProfile } from "@server/services/resumeProjects";
import { applySettingsUpdates } from "@server/services/settings-update";
import { type Request, type Response, Router } from "express";

export const profileRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/profile/projects
// ---------------------------------------------------------------------------
profileRouter.get("/projects", async (_req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      res.json({ success: true, data: DEMO_PROJECT_CATALOG });
      return;
    }
    const profile = await getProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    ok(res, catalog);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

// ---------------------------------------------------------------------------
// GET /api/profile
// ---------------------------------------------------------------------------
profileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await getProfile();
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

// ---------------------------------------------------------------------------
// GET /api/profile/status — source-agnostic health check
// ---------------------------------------------------------------------------
profileRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const source = await getActiveProfileSource();
    const status = await source.getStatus();
    ok(res, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ok(res, { exists: false, error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/refresh — evict cache and refetch
// ---------------------------------------------------------------------------
profileRouter.post("/refresh", async (_req: Request, res: Response) => {
  try {
    clearProfileCache();
    const profile = await getProfile(true);
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

// ---------------------------------------------------------------------------
// GET /api/profile/raw-text — return the stored raw resume text
// ---------------------------------------------------------------------------
profileRouter.get("/raw-text", async (_req: Request, res: Response) => {
  try {
    const text = (await settingsRepo.getSetting("rawResumeText")) ?? "";
    ok(res, { text, charCount: text.length });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

// ---------------------------------------------------------------------------
// PUT /api/profile/raw-text — save raw resume text and invalidate cache
// ---------------------------------------------------------------------------
profileRouter.put("/raw-text", async (req: Request, res: Response) => {
  try {
    const body = req.body as { text?: unknown };
    if (typeof body.text !== "string") {
      fail(res, toAppError(new Error("body.text must be a string")));
      return;
    }
    const text = body.text.trim();
    if (text.length > 100_000) {
      fail(
        res,
        toAppError(new Error("Resume text exceeds 100,000 character limit")),
      );
      return;
    }
    await applySettingsUpdates({
      rawResumeText: text || null,
      profileSourceMode: "raw_text",
    });
    clearProfileCache();
    ok(res, { charCount: text.length });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/upload-pdf — extract text from a PDF upload, save as raw text
// ---------------------------------------------------------------------------

// The installed pdf-parse package exposes a class-based API:
//   new PDFParse({ data: Buffer }).getText() → { pages: [{ text, num }] }
// We use createRequire for reliable synchronous CJS loading in an ESM/tsx context.
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

interface PdfPage {
  text: string;
  num: number;
}
interface PdfParseClass {
  new (opts: { data: Buffer }): { getText(): Promise<{ pages: PdfPage[] }> };
}

function getPDFParse(): PdfParseClass {
  const mod = _require("pdf-parse") as Record<string, unknown>;
  const PDFParse = mod.PDFParse;
  if (typeof PDFParse !== "function") {
    throw new Error(
      `pdf-parse module shape not recognized. Available keys: ${Object.keys(mod).join(", ")}`,
    );
  }
  return PDFParse as PdfParseClass;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const PDFParse = getPDFParse();
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.pages
    .map((p) => p.text)
    .join("\n")
    .trim();
}

profileRouter.post(
  "/upload-pdf",
  // Accept raw PDF body — caller must set Content-Type: application/pdf
  (req, _res, next) => {
    // Buffer the body before the route handler runs.
    // express.raw() must be applied per-route since the global parser is JSON.
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      (req as Request & { rawBuffer?: Buffer }).rawBuffer =
        Buffer.concat(chunks);
      next();
    });
    req.on("error", next);
  },
  async (req: Request, res: Response) => {
    try {
      const buffer = (req as Request & { rawBuffer?: Buffer }).rawBuffer;
      if (!buffer || buffer.length === 0) {
        fail(res, toAppError(new Error("No PDF data received")));
        return;
      }
      if (buffer.length > 10 * 1024 * 1024) {
        fail(res, toAppError(new Error("PDF exceeds 10 MB limit")));
        return;
      }

      logger.info("Extracting text from uploaded PDF", {
        bytes: buffer.length,
      });
      const text = await extractPdfText(buffer);

      if (!text) {
        fail(
          res,
          toAppError(
            new Error(
              "No text found — try a text-based PDF (not a scanned image)",
            ),
          ),
        );
        return;
      }

      const capped = text.slice(0, 100_000);
      await applySettingsUpdates({ rawResumeText: capped });
      clearProfileCache();

      logger.info("Raw resume text saved from PDF", {
        charCount: capped.length,
      });
      ok(res, { charCount: capped.length });
    } catch (error) {
      logger.error("PDF text extraction failed", { error });
      fail(res, toAppError(error));
    }
  },
);
