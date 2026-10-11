"use client";
import { useRef, useState } from "react";

/** Keep native constraints as the source of truth; add persistent, linked errors. */
export function useFormFeedback() {
  const formRef = useRef<HTMLFormElement>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  function validate(onInvalid?: (field: HTMLElement) => void) {
    if (!formRef.current) return true;
    const next: Record<string, string> = {};
    const nextLabels: Record<string, string> = {};
    for (const field of Array.from(formRef.current.elements)) {
      if (
        (field instanceof HTMLInputElement ||
          field instanceof HTMLSelectElement ||
          field instanceof HTMLTextAreaElement) &&
        field.willValidate &&
        !field.validity.valid
      ) {
        onInvalid?.(field);
        next[field.id] = field.validationMessage;
        nextLabels[field.id] = field.labels?.[0]?.textContent || "Field";
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", `${field.id}-error`);
      }
    }
    setErrors(next);
    setLabels(nextLabels);
    if (Object.keys(next).length) {
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>(".form-error-summary")
          ?.focus(),
      );
      return false;
    }
    return true;
  }
  function clear(
    field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ) {
    if (!field.validity.valid) return;
    field.removeAttribute("aria-invalid");
    if (field.getAttribute("aria-describedby") === `${field.id}-error`)
      field.removeAttribute("aria-describedby");
    setErrors((old) => {
      const next = { ...old };
      delete next[field.id];
      return next;
    });
  }
  return { formRef, errors, labels, validate, clear };
}
export function FormErrorSummary({
  errors,
  labels,
}: {
  errors: Record<string, string>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <div className="form-error-summary" role="alert" tabIndex={-1}>
      <strong>
        Check{" "}
        {entries.length === 1 ? "this field" : `these ${entries.length} fields`}{" "}
        before saving.
      </strong>
      <ul>
        {entries.map(([id, message]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.focus();
              }}
            >
              {labels[id] || "Field"}: {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
