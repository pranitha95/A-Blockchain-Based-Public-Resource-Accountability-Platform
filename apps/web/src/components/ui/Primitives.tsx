import { Copy, Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useToast } from '../../features/ui/ToastProvider';

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { notify } = useToast();
  return (
    <button
      type="button"
      className="copy-button"
      aria-label={label}
      title={label}
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        notify('Copied to clipboard.', 'success');
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

export function MonoValue({ value, display, copy = true }: { value: string; display?: ReactNode; copy?: boolean }) {
  return (
    <span className="mono-value">
      <code title={value}>{display ?? value}</code>
      {copy ? <CopyButton value={value} /> : null}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  required = false,
  className = '',
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="field__required" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? <small className="field__hint">{hint}</small> : null}
      {error ? <small className="field__error" role="alert">{error}</small> : null}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  required,
  hint,
  error,
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}
