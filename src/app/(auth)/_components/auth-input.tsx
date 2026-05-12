import { cn } from "@/lib/utils";

export function AuthField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[var(--color-fg)]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--color-fg-muted)]">{hint}</span>}
    </label>
  );
}

export function AuthInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-4 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-muted)] outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-light)]",
        className,
      )}
    />
  );
}

export function PrimaryButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-12 w-full items-center justify-center rounded-md bg-[var(--color-accent)] px-6 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] transition hover:bg-[var(--color-accent-hover)] disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostLink({
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className={cn(
        "text-[13px] font-medium text-[var(--color-accent)] hover:underline",
        className,
      )}
    />
  );
}
