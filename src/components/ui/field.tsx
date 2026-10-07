import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Helper text shown under the input. */
  hint?: ReactNode;
  /** Error message; marks the input aria-invalid and links it via aria-describedby. */
  error?: string;
};

/** Labelled text input with hint and error states. Always has a visible label. */
export function Field({ label, hint, error, id, className, required, ...rest }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="type-label text-xs text-fg">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          // bible 7.2: paper inside a 2px ink rule; the danger role when invalid (banner, night-ink)
          "h-10 border-2 bg-bg px-3 text-base text-fg placeholder:text-fg-muted",
          error ? "border-danger" : "border-fg",
          className,
        )}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="type-body text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="type-body text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
