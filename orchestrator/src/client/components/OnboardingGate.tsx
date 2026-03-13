import * as api from "@client/api";
import { ReactiveResumeConfigPanel } from "@client/components/ReactiveResumeConfigPanel";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useRxResumeConfigState } from "@client/hooks/useRxResumeConfigState";
import { useSettings } from "@client/hooks/useSettings";
import {
  getInitialRxResumeMode,
  getRxResumeCredentialDrafts,
  getRxResumeMissingCredentialLabels,
  validateAndMaybePersistRxResumeMode,
} from "@client/lib/rxresume-config";
import { BaseResumeSelection } from "@client/pages/settings/components/BaseResumeSelection";
import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import {
  getLlmProviderConfig,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  normalizeLlmProvider,
} from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type { RxResumeMode, ValidationResult } from "@shared/types.js";
import { Check } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ValidationState = ValidationResult & { checked: boolean };
type TimestampedValidationState = ValidationState & { testedAt: number | null };

type ProfileSourceMode = "rxresume" | "raw_text";

type OnboardingFormData = {
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKey: string;
  profileSourceMode: ProfileSourceMode;
  rxresumeMode: RxResumeMode;
  rxresumeEmail: string;
  rxresumePassword: string;
  rxresumeApiKey: string;
  rxresumeBaseResumeId: string | null;
};

const EMPTY_VALIDATION_STATE: ValidationState = {
  valid: false,
  message: null,
  checked: false,
};

const EMPTY_TIMESTAMPED_VALIDATION_STATE: TimestampedValidationState = {
  ...EMPTY_VALIDATION_STATE,
  testedAt: null,
};

function getStepPrimaryLabel(input: {
  currentStep: string | null;
  profileSourceMode: ProfileSourceMode;
  llmValidated: boolean;
  rxresumeValidated: boolean;
  baseResumeValidated: boolean;
  rawTextValidated: boolean;
}): string {
  const toLabel = (isValidated: boolean): string =>
    isValidated ? "Revalidate" : "Validate";

  if (input.currentStep === "llm") return toLabel(input.llmValidated);
  if (input.currentStep === "resume") {
    if (input.profileSourceMode === "raw_text") {
      return input.rawTextValidated ? "Re-save Text" : "Save Text";
    }
    return toLabel(input.rxresumeValidated);
  }
  if (input.currentStep === "baseresume")
    return toLabel(input.baseResumeValidated);
  return "Validate";
}

export const OnboardingGate: React.FC = () => {
  const {
    settings,
    isLoading: settingsLoading,
    refreshSettings,
  } = useSettings();
  const {
    storedRxResume,
    getBaseResumeIdForMode,
    setBaseResumeIdForMode,
    syncBaseResumeIdsForMode,
  } = useRxResumeConfigState(settings);

  const [wizardDone, setWizardDone] = useState(false);
  const [isSavingEnv, setIsSavingEnv] = useState(false);
  const [isValidatingLlm, setIsValidatingLlm] = useState(false);
  const [isValidatingRxresume, setIsValidatingRxresume] = useState(false);
  const [isValidatingBaseResume, setIsValidatingBaseResume] = useState(false);
  const [isSavingRawText, setIsSavingRawText] = useState(false);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [rawTextDraft, setRawTextDraft] = useState<string>("");
  const [llmValidation, setLlmValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [rxresumeValidation, setRxresumeValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [rxresumeVersionValidations, setRxresumeVersionValidations] = useState<{
    v4: TimestampedValidationState;
    v5: TimestampedValidationState;
  }>({
    v4: EMPTY_TIMESTAMPED_VALIDATION_STATE,
    v5: EMPTY_TIMESTAMPED_VALIDATION_STATE,
  });
  const [baseResumeValidation, setBaseResumeValidation] =
    useState<ValidationState>(EMPTY_VALIDATION_STATE);
  const [rawTextValidation, setRawTextValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const demoInfo = useDemoInfo();
  const demoMode = demoInfo?.demoMode ?? false;

  const { control, watch, getValues, reset, setValue } =
    useForm<OnboardingFormData>({
      defaultValues: {
        llmProvider: "",
        llmBaseUrl: "",
        llmApiKey: "",
        profileSourceMode: "rxresume",
        rxresumeMode: "v5",
        rxresumeEmail: "",
        rxresumePassword: "",
        rxresumeApiKey: "",
        rxresumeBaseResumeId: null,
      },
    });

  const llmProvider = watch("llmProvider");
  const profileSourceModeValue = watch("profileSourceMode") ?? "rxresume";

  const validateLlm = useCallback(async () => {
    const values = getValues();
    const selectedProvider = normalizeLlmProvider(
      values.llmProvider || settings?.llmProvider?.value || "openrouter",
    );
    const providerConfig = getLlmProviderConfig(selectedProvider);
    const { requiresApiKey, showBaseUrl } = providerConfig;

    setIsValidatingLlm(true);
    try {
      const result = await api.validateLlm({
        provider: selectedProvider,
        baseUrl: showBaseUrl
          ? values.llmBaseUrl.trim() || undefined
          : undefined,
        apiKey: requiresApiKey
          ? values.llmApiKey.trim() || undefined
          : undefined,
      });
      setLlmValidation({ ...result, checked: true });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "LLM validation failed";
      const result = { valid: false, message };
      setLlmValidation({ ...result, checked: true });
      return result;
    } finally {
      setIsValidatingLlm(false);
    }
  }, [getValues, settings?.llmProvider]);

  const validateBaseResume = useCallback(async () => {
    setIsValidatingBaseResume(true);
    try {
      const result = await api.validateResumeConfig();
      setBaseResumeValidation({ ...result, checked: true });
      return result;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Base resume validation failed";
      const result = { valid: false, message };
      setBaseResumeValidation({ ...result, checked: true });
      return result;
    } finally {
      setIsValidatingBaseResume(false);
    }
  }, []);

  const rxresumeModeValue = watch("rxresumeMode");
  const selectedProvider = normalizeLlmProvider(
    llmProvider || settings?.llmProvider?.value || "openrouter",
  );
  const providerConfig = getLlmProviderConfig(selectedProvider);
  const {
    normalizedProvider,
    showApiKey,
    showBaseUrl,
    requiresApiKey: requiresLlmKey,
  } = providerConfig;

  const llmKeyHint = settings?.llmApiKeyHint ?? null;
  const hasLlmKey = Boolean(llmKeyHint);
  const rxresumeModeCurrent = (rxresumeModeValue ||
    settings?.rxresumeMode?.value ||
    "v5") as RxResumeMode;
  const llmValidated = requiresLlmKey ? llmValidation.valid : true;

  const resumeStepChecked =
    profileSourceModeValue === "raw_text"
      ? rawTextValidation.checked
      : rxresumeValidation.checked && baseResumeValidation.checked;

  const profileSourceReady =
    profileSourceModeValue === "raw_text"
      ? rawTextValidation.valid
      : rxresumeValidation.valid && baseResumeValidation.valid;

  const hasCheckedValidations =
    (requiresLlmKey ? llmValidation.checked : true) && resumeStepChecked;

  const shouldOpen =
    !wizardDone &&
    !demoMode &&
    Boolean(settings && !settingsLoading) &&
    hasCheckedValidations &&
    !(llmValidated && profileSourceReady);

  const validateRxresumeVersion = useCallback(
    async (
      version: "v4" | "v5",
    ): Promise<ValidationResult & { checked: true; testedAt: number }> => {
      const values = getValues();
      const draftCredentials = getRxResumeCredentialDrafts(values);
      const testedAt = Date.now();
      const result = await validateAndMaybePersistRxResumeMode({
        mode: version,
        stored: storedRxResume,
        draft: draftCredentials,
        validate: api.validateRxresume,
        getPrecheckMessage: (failure) =>
          failure === "missing-v5-api-key"
            ? "v5 API key required. Add a v5 API key, then test again."
            : "v4 email and password required. Add both credentials, then test again.",
        getValidationErrorMessage: (error, mode) =>
          error instanceof Error
            ? error.message
            : `RxResume ${mode} validation failed`,
      });
      return { ...result.validation, checked: true, testedAt };
    },
    [getValues, storedRxResume],
  );

  const validateRxresume = useCallback(async () => {
    const values = getValues();
    const selectedMode = values.rxresumeMode;

    setIsValidatingRxresume(true);
    try {
      const versionResult = await validateRxresumeVersion(selectedMode);
      setRxresumeVersionValidations((current) => ({
        ...current,
        [selectedMode]: versionResult,
      }));

      const result: ValidationResult = {
        valid: versionResult.valid,
        message: versionResult.message,
      };
      setRxresumeValidation({ ...result, checked: true });
      return result;
    } finally {
      setIsValidatingRxresume(false);
    }
  }, [getValues, validateRxresumeVersion]);

  // Initialize form values from settings
  useEffect(() => {
    if (settings) {
      const initialMode = getInitialRxResumeMode({
        savedMode: (settings.rxresumeMode?.value ??
          null) as RxResumeMode | null,
        hasV4: storedRxResume.hasV4,
        hasV5: storedRxResume.hasV5,
      });
      const selectedId = syncBaseResumeIdsForMode(initialMode);
      const savedSourceMode =
        (settings.profileSourceMode?.value as ProfileSourceMode | undefined) ??
        "rxresume";
      reset({
        llmProvider: settings.llmProvider?.value || "",
        llmBaseUrl: settings.llmBaseUrl?.value || "",
        llmApiKey: "",
        profileSourceMode: savedSourceMode,
        rxresumeMode: initialMode,
        rxresumeEmail: "",
        rxresumePassword: "",
        rxresumeApiKey: "",
        rxresumeBaseResumeId: selectedId,
      });

      // Seed raw text validation state from saved char count
      if (savedSourceMode === "raw_text") {
        const charCount = settings.rawResumeCharCount ?? 0;
        setRawTextValidation({
          valid: charCount > 0,
          message: charCount > 0 ? null : "No resume text saved yet",
          checked: true,
        });
      }
    }
  }, [
    settings,
    reset,
    storedRxResume.hasV4,
    storedRxResume.hasV5,
    syncBaseResumeIdsForMode,
  ]);

  // Clear base URL when provider doesn't require it
  useEffect(() => {
    if (!showBaseUrl) {
      setValue("llmBaseUrl", "");
    }
  }, [showBaseUrl, setValue]);

  // Reset LLM validation when provider changes
  useEffect(() => {
    if (!selectedProvider) return;
    setLlmValidation({ valid: false, message: null, checked: false });
  }, [selectedProvider]);

  const steps = useMemo(() => {
    const base = [
      {
        id: "llm",
        label: "LLM Provider",
        subtitle: "Provider + credentials",
        complete: llmValidated,
        disabled: false,
      },
      {
        id: "resume",
        label: "Resume Source",
        subtitle:
          profileSourceModeValue === "raw_text"
            ? "Paste or upload PDF"
            : "Version + credentials",
        complete:
          profileSourceModeValue === "raw_text"
            ? rawTextValidation.valid
            : rxresumeValidation.valid,
        disabled: false,
      },
    ];

    if (profileSourceModeValue !== "raw_text") {
      base.push({
        id: "baseresume",
        label: "Select Template Resume",
        subtitle: "Template selection",
        complete: baseResumeValidation.valid,
        disabled: !rxresumeValidation.valid,
      });
    }

    return base;
  }, [
    llmValidated,
    profileSourceModeValue,
    rawTextValidation.valid,
    rxresumeValidation.valid,
    baseResumeValidation.valid,
  ]);

  const defaultStep = steps.find((step) => !step.complete)?.id ?? steps[0]?.id;

  useEffect(() => {
    if (!shouldOpen) return;
    if (!currentStep && defaultStep) {
      setCurrentStep(defaultStep);
    }
  }, [currentStep, defaultStep, shouldOpen]);

  const runAllValidations = useCallback(async () => {
    if (!settings) return;
    const validations: Promise<ValidationResult>[] = [];
    if (requiresLlmKey) {
      validations.push(validateLlm());
    } else {
      setLlmValidation({ valid: true, message: null, checked: true });
    }

    const sourceMode =
      (settings.profileSourceMode?.value as ProfileSourceMode | undefined) ??
      "rxresume";

    if (sourceMode === "raw_text") {
      const charCount = settings.rawResumeCharCount ?? 0;
      setRawTextValidation({
        valid: charCount > 0,
        message: charCount > 0 ? null : "No resume text saved yet",
        checked: true,
      });
    } else {
      validations.push(validateRxresume(), validateBaseResume());
    }

    const results = await Promise.allSettled(validations);

    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      const reason = failed.status === "rejected" ? failed.reason : null;
      const message =
        reason instanceof Error ? reason.message : "Validation checks failed";
      toast.error(message);
    }
  }, [
    settings,
    requiresLlmKey,
    validateLlm,
    validateRxresume,
    validateBaseResume,
  ]);

  // Run validations on mount when needed
  useEffect(() => {
    if (demoMode) return;
    if (!settings || settingsLoading) return;
    const needsValidation =
      (requiresLlmKey ? !llmValidation.checked : false) || !resumeStepChecked;
    if (!needsValidation) return;
    void runAllValidations();
  }, [
    settings,
    settingsLoading,
    requiresLlmKey,
    llmValidation.checked,
    resumeStepChecked,
    runAllValidations,
    demoMode,
  ]);

  const handleSaveLlm = async (): Promise<boolean> => {
    const values = getValues();
    const apiKeyValue = values.llmApiKey.trim();
    const baseUrlValue = values.llmBaseUrl.trim();

    if (requiresLlmKey && !apiKeyValue && !hasLlmKey) {
      toast.info("Add your LLM API key to continue");
      return false;
    }

    try {
      const validation = requiresLlmKey
        ? await validateLlm()
        : { valid: true, message: null };

      if (!validation.valid) {
        toast.error(validation.message || "LLM validation failed");
        return false;
      }

      const update: Partial<UpdateSettingsInput> = {
        llmProvider: normalizedProvider,
        llmBaseUrl: showBaseUrl ? baseUrlValue || null : null,
      };

      if (showApiKey && apiKeyValue) {
        update.llmApiKey = apiKeyValue;
      }

      setIsSavingEnv(true);
      await api.updateSettings(update);
      await refreshSettings();
      setValue("llmApiKey", "");
      toast.success("LLM provider connected");
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save LLM settings";
      toast.error(message);
      return false;
    } finally {
      setIsSavingEnv(false);
    }
  };

  const handleSaveRxresume = async (): Promise<boolean> => {
    const values = getValues();
    const modeValue = values.rxresumeMode;
    const draftCredentials = getRxResumeCredentialDrafts(values);
    const missing = getRxResumeMissingCredentialLabels({
      mode: modeValue,
      stored: storedRxResume,
      draft: draftCredentials,
    });

    if (missing.length > 0) {
      toast.info("Almost there", {
        description: `Missing: ${missing.join(", ")}`,
      });
      return false;
    }

    try {
      setIsValidatingRxresume(true);
      const result = await validateAndMaybePersistRxResumeMode({
        mode: modeValue,
        stored: storedRxResume,
        draft: draftCredentials,
        validate: api.validateRxresume,
        persist: async (update) => {
          setIsSavingEnv(true);
          try {
            await api.updateSettings(update);
            await refreshSettings();
          } finally {
            setIsSavingEnv(false);
          }
        },
        persistOnSuccess: true,
        getPrecheckMessage: (failure) =>
          failure === "missing-v5-api-key"
            ? "v5 API key required. Add a v5 API key, then test again."
            : "v4 email and password required. Add both credentials, then test again.",
        getValidationErrorMessage: (error) =>
          error instanceof Error ? error.message : "RxResume validation failed",
        getPersistErrorMessage: (error) =>
          error instanceof Error
            ? error.message
            : "Failed to save RxResume credentials",
      });

      setRxresumeVersionValidations((current) => ({
        ...current,
        [modeValue]: {
          ...result.validation,
          checked: true,
          testedAt: Date.now(),
        },
      }));
      setRxresumeValidation({ ...result.validation, checked: true });

      if (!result.validation.valid) {
        toast.error(result.validation.message || "RxResume validation failed");
        return false;
      }
      setValue("rxresumePassword", "");
      setValue("rxresumeApiKey", "");

      toast.success("RxResume connected");
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save RxResume credentials";
      toast.error(message);
      return false;
    } finally {
      setIsValidatingRxresume(false);
      setIsSavingEnv(false);
    }
  };

  const handleSaveBaseResume = async (): Promise<boolean> => {
    const values = getValues();

    if (!values.rxresumeBaseResumeId) {
      toast.info("Select a base resume to continue");
      return false;
    }

    try {
      setIsSavingEnv(true);
      await api.updateSettings({
        rxresumeMode: values.rxresumeMode,
        rxresumeBaseResumeId: values.rxresumeBaseResumeId,
      });
      const validation = await validateBaseResume();
      if (!validation.valid) {
        toast.error(validation.message || "Base resume validation failed");
        return false;
      }

      await refreshSettings();
      toast.success("Setup complete!");
      setWizardDone(true);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save base resume";
      toast.error(message);
      return false;
    } finally {
      setIsSavingEnv(false);
    }
  };

  const handleSaveRawText = async (): Promise<boolean> => {
    if (!rawTextDraft.trim()) {
      toast.info("Paste your resume text or upload a PDF to continue");
      return false;
    }

    try {
      setIsSavingRawText(true);
      // Server atomically saves rawResumeText + profileSourceMode = "raw_text"
      const { charCount } = await api.setRawResumeText(rawTextDraft);
      setRawTextValidation({ valid: true, message: null, checked: true });
      toast.success("Resume saved — setup complete!", {
        description: `${charCount.toLocaleString()} characters stored`,
      });
      // Explicit close: don't rely solely on reactive shouldOpen
      setWizardDone(true);
      void refreshSettings();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save resume text";
      toast.error(message);
      return false;
    } finally {
      setIsSavingRawText(false);
    }
  };

  const handlePdfUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    if (!file) return;

    try {
      setIsUploadingPdf(true);
      const buffer = await file.arrayBuffer();
      await api.uploadResumePdf(buffer);
      const { text } = await api.getRawResumeText();
      setRawTextDraft(text);
      toast.success("PDF extracted", {
        description: "Text loaded into the editor. Save it to confirm.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to process PDF";
      toast.error(message);
    } finally {
      setIsUploadingPdf(false);
    }
  };

  const resolvedStepIndex = currentStep
    ? steps.findIndex((step) => step.id === currentStep)
    : 0;
  const stepIndex = resolvedStepIndex >= 0 ? resolvedStepIndex : 0;
  const completedSteps = steps.filter((step) => step.complete).length;
  const progressValue =
    steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
  const isBusy =
    isSavingEnv ||
    settingsLoading ||
    isValidatingLlm ||
    isValidatingRxresume ||
    isValidatingBaseResume ||
    isSavingRawText ||
    isUploadingPdf;
  const canGoBack = stepIndex > 0;

  const handlePrimaryAction = async () => {
    if (!currentStep) return;
    const nextStep = steps[stepIndex + 1];
    if (currentStep === "llm") {
      const saved = await handleSaveLlm();
      if (saved && nextStep) setCurrentStep(nextStep.id);
      return;
    }
    if (currentStep === "resume") {
      if (profileSourceModeValue === "raw_text") {
        const saved = await handleSaveRawText();
        if (saved && nextStep) setCurrentStep(nextStep.id);
      } else {
        const saved = await handleSaveRxresume();
        if (saved && nextStep) setCurrentStep(nextStep.id);
      }
      return;
    }
    if (currentStep === "baseresume") {
      await handleSaveBaseResume();
      return;
    }
  };

  const handleBack = () => {
    if (!canGoBack) return;
    setCurrentStep(steps[stepIndex - 1]?.id ?? currentStep);
  };

  if (!shouldOpen || !currentStep) return null;

  return (
    <AlertDialog open>
      <AlertDialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden p-0"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="space-y-6 px-6 py-6 max-h-[calc(90vh-3.5rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Welcome to Job Ops</AlertDialogTitle>
            <AlertDialogDescription>
              Let's get your workspace ready. Add your keys and resume once,
              then the pipeline can run end-to-end.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Tabs value={currentStep} onValueChange={setCurrentStep}>
            <TabsList className="grid h-auto w-full grid-cols-1 gap-2 border-b border-border/60 bg-transparent p-0 text-left sm:grid-cols-3">
              {steps.map((step, index) => {
                const isActive = step.id === currentStep;
                const isComplete = step.complete;

                return (
                  <FieldLabel
                    key={step.id}
                    className={cn(
                      "w-full [&>[data-slot=field]]:border-0 [&>[data-slot=field]]:p-0 [&>[data-slot=field]]:rounded-none",
                      step.disabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <TabsTrigger
                      value={step.id}
                      disabled={step.disabled}
                      className={cn(
                        "w-full rounded-md hover:bg-muted/60 border-b-2 border-transparent px-3 py-4 text-left shadow-none",
                        isActive
                          ? "border-primary !bg-muted/60 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <Field orientation="horizontal" className="items-start">
                        <FieldContent>
                          <FieldTitle>{step.label}</FieldTitle>
                          <FieldDescription>{step.subtitle}</FieldDescription>
                        </FieldContent>
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold",
                            isComplete
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isComplete ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            index + 1
                          )}
                        </span>
                      </Field>
                    </TabsTrigger>
                  </FieldLabel>
                );
              })}
            </TabsList>

            <TabsContent value="llm" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Connect LLM provider</p>
                <p className="text-xs text-muted-foreground">
                  Used for job scoring, summaries, and tailoring.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="llmProvider" className="text-sm font-medium">
                    Provider
                  </label>
                  <Controller
                    name="llmProvider"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={selectedProvider}
                        onValueChange={(value) => {
                          field.onChange(value);
                        }}
                        disabled={isSavingEnv}
                      >
                        <SelectTrigger id="llmProvider">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {LLM_PROVIDERS.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {LLM_PROVIDER_LABELS[provider]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    {providerConfig.providerHint}
                  </p>
                </div>
                {showBaseUrl && (
                  <Controller
                    name="llmBaseUrl"
                    control={control}
                    render={({ field }) => (
                      <SettingsInput
                        label="LLM base URL"
                        inputProps={{
                          name: "llmBaseUrl",
                          value: field.value,
                          onChange: field.onChange,
                        }}
                        placeholder={providerConfig.baseUrlPlaceholder}
                        helper={providerConfig.baseUrlHelper}
                        current={settings?.llmBaseUrl?.value || "—"}
                        disabled={isSavingEnv}
                      />
                    )}
                  />
                )}
                {showApiKey && (
                  <Controller
                    name="llmApiKey"
                    control={control}
                    render={({ field }) => (
                      <SettingsInput
                        label="LLM API key"
                        inputProps={{
                          name: "llmApiKey",
                          value: field.value,
                          onChange: field.onChange,
                        }}
                        type="password"
                        placeholder="Enter key"
                        helper={
                          llmKeyHint
                            ? `${providerConfig.keyHelper}. Leave blank to use the saved key.`
                            : providerConfig.keyHelper
                        }
                        disabled={isSavingEnv}
                      />
                    )}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="resume" className="space-y-4 pt-6">
              {/* Source picker */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">
                    Choose your profile source
                  </p>
                  <p className="text-xs text-muted-foreground">
                    How the pipeline reads your profile for scoring and
                    tailoring.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setValue("profileSourceMode", "rxresume");
                      if (!rxresumeValidation.checked) {
                        setRxresumeValidation({
                          valid: false,
                          message: null,
                          checked: true,
                        });
                      }
                      if (!baseResumeValidation.checked) {
                        setBaseResumeValidation({
                          valid: false,
                          message: null,
                          checked: true,
                        });
                      }
                    }}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors hover:bg-muted/40",
                      profileSourceModeValue === "rxresume"
                        ? "border-primary bg-muted/40"
                        : "border-border",
                    )}
                  >
                    <p className="text-sm font-medium">Reactive Resume</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Full pipeline + tailored PDF export
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setValue("profileSourceMode", "raw_text");
                      if (!rawTextValidation.checked) {
                        const charCount = settings?.rawResumeCharCount ?? 0;
                        setRawTextValidation({
                          valid: charCount > 0,
                          message:
                            charCount > 0 ? null : "No resume text saved yet",
                          checked: true,
                        });
                      }
                    }}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors hover:bg-muted/40",
                      profileSourceModeValue === "raw_text"
                        ? "border-primary bg-muted/40"
                        : "border-border",
                    )}
                  >
                    <p className="text-sm font-medium">Plain text / PDF</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Paste resume or upload PDF. Scoring &amp; tailoring only.
                    </p>
                  </button>
                </div>
              </div>

              <Separator />

              {/* RxResume credentials panel */}
              {profileSourceModeValue === "rxresume" && (
                <ReactiveResumeConfigPanel
                  mode={rxresumeModeCurrent}
                  onModeChange={(mode) => {
                    setValue("rxresumeMode", mode);
                    setValue(
                      "rxresumeBaseResumeId",
                      getBaseResumeIdForMode(mode),
                    );
                    setRxresumeValidation((previous) => ({
                      ...EMPTY_VALIDATION_STATE,
                      checked: previous.checked,
                    }));
                  }}
                  disabled={isSavingEnv}
                  showValidationStatus
                  validationStatuses={rxresumeVersionValidations}
                  intro={{
                    title: "Link your RxResume account",
                    description:
                      "Used to export tailored PDFs. Choose between Reactive Resume version 4 and 5, and provide the credentials.",
                  }}
                  v5={{
                    apiKey: watch("rxresumeApiKey"),
                    onApiKeyChange: (value) =>
                      setValue("rxresumeApiKey", value),
                  }}
                  v4={{
                    email: watch("rxresumeEmail"),
                    onEmailChange: (value) => setValue("rxresumeEmail", value),
                    password: watch("rxresumePassword"),
                    onPasswordChange: (value) =>
                      setValue("rxresumePassword", value),
                  }}
                />
              )}

              {/* Raw text / PDF panel */}
              {profileSourceModeValue === "raw_text" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="rawResumeText"
                      className="text-sm font-medium"
                    >
                      Resume text
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handlePdfUpload}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => pdfInputRef.current?.click()}
                      >
                        {isUploadingPdf ? "Extracting…" : "Upload PDF"}
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    id="rawResumeText"
                    placeholder="Paste your resume here…"
                    className="min-h-[200px] font-mono text-xs"
                    value={rawTextDraft}
                    onChange={(e) => setRawTextDraft(e.target.value)}
                    disabled={isBusy}
                  />
                  {rawTextDraft.length > 0 && (
                    <p className="text-xs text-muted-foreground text-right">
                      {rawTextDraft.length.toLocaleString()} characters
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="baseresume" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">
                  Select your template resume
                </p>
                <p className="text-xs text-muted-foreground">
                  Choose the resume you want to use as a template. The selected
                  resume will be used as a template for tailoring.
                </p>
              </div>
              <Controller
                name="rxresumeBaseResumeId"
                control={control}
                render={({ field }) => (
                  <BaseResumeSelection
                    value={field.value}
                    onValueChange={(value) => {
                      const mode = (getValues("rxresumeMode") ??
                        "v5") as RxResumeMode;
                      setBaseResumeIdForMode(mode, value);
                      field.onChange(value);
                    }}
                    hasRxResumeAccess={rxresumeValidation.valid}
                    rxresumeMode={rxresumeModeCurrent}
                    disabled={isSavingEnv}
                  />
                )}
              />
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={!canGoBack || isBusy}
            >
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button onClick={handlePrimaryAction} disabled={isBusy}>
                {isBusy
                  ? "Validating..."
                  : getStepPrimaryLabel({
                      currentStep,
                      profileSourceMode: profileSourceModeValue,
                      llmValidated,
                      rxresumeValidated: rxresumeValidation.valid,
                      baseResumeValidated: baseResumeValidation.valid,
                      rawTextValidated: rawTextValidation.valid,
                    })}
              </Button>
            </div>
          </div>

          <Progress value={progressValue} className="h-2" />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
