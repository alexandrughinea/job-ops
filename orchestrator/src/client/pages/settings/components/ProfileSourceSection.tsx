import * as api from "@client/api";
import {
  useMutationRawResumeTextSave,
  useMutationResumePdfUpload,
} from "@client/hooks";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type ProfileSourceSectionProps = {
  currentMode: "rxresume" | "raw_text";
  rawResumeCharCount: number;
  isLoading: boolean;
  isSaving: boolean;
};

export const ProfileSourceSection: React.FC<ProfileSourceSectionProps> = ({
  currentMode,
  rawResumeCharCount,
  isLoading,
  isSaving,
}) => {
  const { setValue, watch } = useFormContext<UpdateSettingsInput>();

  const [rawText, setRawText] = useState<string>("");
  const [isFetchingText, setIsFetchingText] = useState(false);
  const [isSavingText, setIsSavingText] = useState(false);
  const [textLoaded, setTextLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mutationSaveText = useMutationRawResumeTextSave();
  const mutationUploadPdf = useMutationResumePdfUpload();
  const watchedMode =
    (watch("profileSourceMode") as
      | "rxresume"
      | "raw_text"
      | null
      | undefined) ?? currentMode;

  const isRawText = watchedMode === "raw_text";

  useEffect(() => {
    if (!isRawText || textLoaded || isFetchingText) return;
    setIsFetchingText(true);
    api
      .getRawResumeText()
      .then(({ text }) => {
        setRawText(text);
        setTextLoaded(true);
      })
      .catch(() => {
        toast.error("Failed to load resume text");
      })
      .finally(() => setIsFetchingText(false));
  }, [isRawText, textLoaded, isFetchingText]);

  const handleSaveText = async () => {
    if (!rawText.trim()) {
      toast.info("Paste your resume text first");
      return;
    }
    try {
      setIsSavingText(true);
      const { charCount } = await mutationSaveText.mutateAsync(rawText);
      toast.success("Resume text saved", {
        description: `${charCount.toLocaleString()} characters stored`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save resume text";
      toast.error(message);
    } finally {
      setIsSavingText(false);
    }
  };

  const handlePdfUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;

    try {
      setIsSavingText(true);
      const buffer = await file.arrayBuffer();
      const { charCount } = await mutationUploadPdf.mutateAsync(buffer);
      const { text } = await api.getRawResumeText();
      setRawText(text);
      setTextLoaded(true);
      toast.success("PDF text extracted and saved", {
        description: `${charCount.toLocaleString()} characters stored`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to process PDF";
      toast.error(message);
    } finally {
      setIsSavingText(false);
    }
  };

  const disabled = isLoading || isSaving || isSavingText;

  return (
    <AccordionItem value="profile-source" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Profile Source</span>
          {currentMode === "raw_text" && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Plain text / PDF
            </span>
          )}
        </div>
      </AccordionTrigger>

      <AccordionContent className="pb-4">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose where the pipeline reads your profile for scoring, tailoring,
            and ghostwriting. Reactive Resume also handles PDF generation;
            plain-text mode is for scoring and tailoring only.
          </p>

          <RadioGroup
            value={watchedMode}
            onValueChange={(value) => {
              setValue("profileSourceMode", value as "rxresume" | "raw_text", {
                shouldDirty: true,
              });
            }}
            disabled={disabled}
            className="gap-3"
          >
            <div className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40 transition-colors">
              <RadioGroupItem
                value="rxresume"
                id="ps-rxresume"
                className="mt-0.5"
              />
              <div>
                <Label
                  htmlFor="ps-rxresume"
                  className="cursor-pointer font-medium"
                >
                  Reactive Resume
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Full pipeline including tailored PDF export. Requires a
                  connected Reactive Resume account.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40 transition-colors">
              <RadioGroupItem value="raw_text" id="ps-raw" className="mt-0.5" />
              <div>
                <Label htmlFor="ps-raw" className="cursor-pointer font-medium">
                  Plain text / PDF
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Paste your resume or upload a PDF. The LLM extracts a
                  structured profile for scoring and tailoring. PDF export is
                  not available in this mode.
                </p>
              </div>
            </div>
          </RadioGroup>

          {isRawText && (
            <>
              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="rawResumeTextarea"
                    className="text-sm font-medium"
                  >
                    Resume Text
                  </Label>
                  <div className="flex items-center gap-2">
                    {rawResumeCharCount > 0 && !isFetchingText && (
                      <span className="text-xs text-muted-foreground">
                        {rawResumeCharCount.toLocaleString()} chars saved
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload PDF
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={handlePdfUpload}
                    />
                  </div>
                </div>

                <Textarea
                  id="rawResumeTextarea"
                  className="font-mono text-xs min-h-[220px] resize-y"
                  placeholder={
                    isFetchingText
                      ? "Loading..."
                      : "Paste your resume here, or click 'Upload PDF' above to extract text from a PDF."
                  }
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  disabled={disabled || isFetchingText}
                  maxLength={100_000}
                />

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {rawText.length.toLocaleString()} / 100,000 chars
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled || isFetchingText || !rawText.trim()}
                    onClick={handleSaveText}
                  >
                    {isSavingText ? "Saving…" : "Save Text"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  After saving, the pipeline will use the LLM to extract a
                  structured profile on the next run. Use{" "}
                  <span className="font-mono">POST /api/profile/refresh</span>{" "}
                  or the refresh button on the profile page to force a re-parse.
                </p>
              </div>
            </>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};
