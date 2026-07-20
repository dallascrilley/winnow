import { Turnstile, PoweredByBadge, useT } from "@agent-native/core/client";
import type { FormField, FormSettings } from "@shared/types";
import { IconCircleCheck, IconRefresh } from "@tabler/icons-react";
import { useState, useMemo, useEffect } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { FieldRenderer } from "@/components/builder/FieldRenderer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicForm, useSubmitForm } from "@/hooks/use-forms";
import { normalizeFields } from "@/lib/normalize-fields";
import { cn } from "@/lib/utils";
import {
  expandRedirectUrl,
  safeRedirectUrl,
} from "@/lib/expand-redirect-url";


export function FormFillPage() {
  const t = useT();
  const params = useParams();
  const slug = params["*"] || "";
  const { data: form, isLoading, error } = usePublicForm(slug);
  const submitForm = useSubmitForm();

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const pageLoadTime = useState(() => Date.now())[0];

  useEffect(() => {
    try {
      const inIframe = window.self !== window.top;
      const forced = new URLSearchParams(window.location.search).has("embed");
      setEmbedded(inIframe || forced);
    } catch {
      setEmbedded(true);
    }
  }, []);

  const fields: FormField[] = useMemo(
    () => normalizeFields(form?.fields),
    [form?.fields],
  );
  const settings: FormSettings = form?.settings || {};

  // Scale fields render the slider at their minimum even before the user
  // interacts, so seed that displayed default into form state. Otherwise a
  // required scale field left untouched fails validation despite looking set.
  useEffect(() => {
    const scaleDefaults: Record<string, number> = {};
    for (const field of fields) {
      if (field.type === "scale") {
        scaleDefaults[field.id] = field.validation?.min ?? 1;
      }
    }
    if (Object.keys(scaleDefaults).length === 0) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, def] of Object.entries(scaleDefaults)) {
        if (next[id] === undefined) {
          next[id] = def;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [fields]);

  // Evaluate conditional visibility
  const visibleFields = useMemo(() => {
    return fields.filter((field) => {
      if (!field.conditional) return true;
      const { fieldId, operator, value: condValue } = field.conditional;
      const fieldVal = String(values[fieldId] ?? "");
      switch (operator) {
        case "equals":
          return fieldVal === condValue;
        case "not_equals":
          return fieldVal !== condValue;
        case "contains":
          return fieldVal.includes(condValue);
        default:
          return true;
      }
    });
  }, [fields, values]);

  function handleChange(fieldId: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setFieldErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of visibleFields) {
      const val = values[field.id];
      if (field.required) {
        if (val === undefined || val === null || val === "") {
          errors[field.id] = `${field.label} is required`;
          continue;
        }
      }
      if (!field.validation) continue;
      const hasNumericValue =
        val !== undefined &&
        val !== null &&
        val !== "" &&
        !Number.isNaN(Number(val));
      if (
        hasNumericValue &&
        field.validation.min !== undefined &&
        Number(val) < field.validation.min
      ) {
        errors[field.id] =
          field.validation.message ||
          `${field.label} must be at least ${field.validation.min}`;
        continue;
      }
      if (
        hasNumericValue &&
        field.validation.max !== undefined &&
        Number(val) > field.validation.max
      ) {
        errors[field.id] =
          field.validation.message ||
          `${field.label} must be at most ${field.validation.max}`;
        continue;
      }
      if (field.validation.pattern && typeof val === "string") {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(val)) {
          errors[field.id] =
            field.validation.message || `${field.label} is invalid`;
        }
      }
    }
    return errors;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    const firstId = Object.keys(errors)[0];
    if (firstId) {
      toast.error(errors[firstId]);
      const el = document.querySelector<HTMLElement>(
        `[data-field-id="${CSS.escape(firstId)}"]`,
      );
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    submitForm.mutate(
      {
        formId: form!.id,
        data: values,
        captchaToken,
        _hp: honeypot,
        _t: pageLoadTime,
      },
      {
        onSuccess: (result: { id?: string; success?: boolean }) => {
          setSubmitted(true);
          if (!settings.redirectUrl) return;
          const redirectUrl = safeRedirectUrl(settings.redirectUrl);
          if (!redirectUrl) return;
          const responseId =
            typeof result?.id === "string" && result.id.length > 0
              ? result.id
              : undefined;
          window.location.assign(
            expandRedirectUrl(redirectUrl, { responseId }),
          );
        },
        onError: (err: unknown) => {
          let message = t("publicForm.failedSubmit");
          if (err && typeof err === "object" && "error" in err) {
            const candidate = err.error;
            if (typeof candidate === "string" && candidate.length > 0) {
              message = candidate;
            }
          }
          toast.error(message);
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 px-4 py-10">
        <div className="mx-auto max-w-xl space-y-6 rounded-2xl border border-border/80 bg-background p-5 shadow-sm sm:p-8">
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="space-y-5 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div
        className={cn(
          "flex min-h-screen items-center justify-center p-4",
          embedded ? "bg-background" : "bg-muted/30",
        )}
      >
        <div
          className={cn(
            "text-center",
            !embedded &&
              "max-w-md rounded-2xl border border-border/80 bg-background p-8 shadow-sm sm:p-10",
          )}
        >
          <h1 className="text-2xl font-semibold mb-2">
            {t("publicForm.formNotFound")}
          </h1>
          <p className="text-muted-foreground mb-4">
            {t("publicForm.removedOrClosed")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="min-h-10 gap-2 transition-[scale,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96] motion-reduce:transition-none"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            {t("publicForm.tryAgain")}
          </Button>
        </div>
        {!embedded && <PoweredByBadge />}
      </div>
    );
  }

  if (submitted) {
    return (
      <div
        className={cn(
          "flex min-h-screen items-center justify-center p-4",
          embedded ? "bg-background" : "bg-muted/30",
        )}
      >
        <div
          className={cn(
            "max-w-md text-center",
            !embedded &&
              "rounded-2xl border border-border/80 bg-background p-8 shadow-sm sm:p-10",
          )}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600/10">
            <IconCircleCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">
            {t("publicForm.responseSubmitted")}
          </h1>
          <p className="text-muted-foreground">
            {settings.successMessage ||
              "Thank you! Your response has been recorded."}
          </p>
        </div>
        {!embedded && <PoweredByBadge />}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-screen items-center justify-center p-3 sm:p-4 py-8 sm:py-12",
        embedded ? "bg-background" : "bg-muted/30",
      )}
    >
      <div
        className={cn(
          "w-full max-w-2xl",
          !embedded &&
            "rounded-2xl border border-border/80 bg-background p-5 shadow-sm sm:p-8",
        )}
      >
        {!embedded && (
          <div className="mb-3 flex justify-end">
            <ThemeToggle className="h-10 w-10 transition-[scale,background-color,color,box-shadow] duration-150 active:scale-[0.96] motion-reduce:transition-none" />
          </div>
        )}
        {/* Form header */}
        <div className={embedded ? "mb-5" : "mb-6 sm:mb-8"}>
          <h1
            className={
              embedded
                ? "text-lg font-semibold"
                : "text-2xl sm:text-3xl font-semibold"
            }
          >
            {form.title}
          </h1>
          {form.description && (
            <p
              className={cn(
                "mt-2 text-muted-foreground",
                embedded && "text-sm",
              )}
            >
              {form.description}
            </p>
          )}
        </div>

        {slug === "talk-to-sales" && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setValues({
                  name: "Alex Rivera",
                  email: "alex.rivera@northwind.io",
                  company_size: "51-200",
                  message:
                    "Evaluating an agent-native inbound pipeline for our mid-market sales team.",
                });
                setFieldErrors({});
              }}
            >
              Fill sample ICP (demo)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setValues({
                  name: "Sam Chen",
                  email: "sam@startupmail.com",
                  company_size: "11-50",
                  message: "Curious about pricing for a small pilot.",
                });
                setFieldErrors({});
              }}
            >
              Fill mid-band (demo)
            </Button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Honeypot: bots fill this, humans don't see it. */}
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
            className="absolute -left-[9999px] opacity-0 pointer-events-none"
            autoComplete="off"
          />
          <div className="space-y-6">
            {visibleFields.map((field) => (
              <div key={field.id} className="space-y-1.5">
                <FieldRenderer
                  field={field}
                  value={values[field.id]}
                  onChange={(v) => handleChange(field.id, v)}
                />
                {fieldErrors[field.id] && (
                  <p
                    id={`${field.id}-error`}
                    role="alert"
                    className="text-sm text-destructive"
                    data-field-id={field.id}
                    tabIndex={-1}
                  >
                    {fieldErrors[field.id]}
                  </p>
                )}
              </div>
            ))}

            {visibleFields.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                {t("publicForm.noFields")}
              </p>
            )}
          </div>

          <div className="mt-6">
            <Turnstile onVerify={setCaptchaToken} />
          </div>

          <Button
            type="submit"
            className="mt-4 min-h-11 w-full transition-[scale,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96] motion-reduce:transition-none sm:w-auto"
            size="lg"
            disabled={submitForm.isPending}
          >
            {submitForm.isPending
              ? "Submitting..."
              : settings.submitText || "Submit"}
          </Button>
        </form>
      </div>

      {!embedded && <PoweredByBadge />}
    </div>
  );
}
