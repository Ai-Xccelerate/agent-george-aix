import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";

const toneStyles: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: {
    bg: "bg-[var(--color-surface-2)]",
    fg: "text-[var(--color-fg-secondary)]",
    dot: "bg-[var(--color-fg-muted)]",
  },
  accent: {
    bg: "bg-[var(--color-accent-light)]",
    fg: "text-[var(--color-accent)]",
    dot: "bg-[var(--color-accent)]",
  },
  success: {
    bg: "bg-[var(--color-badge-active-bg)]",
    fg: "text-[var(--color-badge-active-fg)]",
    dot: "bg-[var(--color-success)]",
  },
  warning: {
    bg: "bg-[var(--color-badge-training-bg)]",
    fg: "text-[var(--color-badge-training-fg)]",
    dot: "bg-[var(--color-warning)]",
  },
  error: {
    bg: "bg-[#FBE5E5]",
    fg: "text-[var(--color-error)]",
    dot: "bg-[var(--color-error)]",
  },
  info: {
    bg: "bg-[#E6F0FA]",
    fg: "text-[var(--color-info)]",
    dot: "bg-[var(--color-info)]",
  },
};

export function Badge({
  tone = "neutral",
  withDot = true,
  children,
  className,
}: {
  tone?: Tone;
  withDot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const s = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-medium",
        s.bg,
        s.fg,
        className,
      )}
    >
      {withDot && <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />}
      {children}
    </span>
  );
}

const lifecycleTone: Record<string, Tone> = {
  prospect: "info",
  onboarding: "accent",
  active: "success",
  at_risk: "error",
  churned: "neutral",
};

export function LifecycleBadge({ value }: { value: string }) {
  const tone = lifecycleTone[value] ?? "neutral";
  return <Badge tone={tone}>{value.replace("_", " ")}</Badge>;
}

const stepTone: Record<string, Tone> = {
  planned: "neutral",
  in_progress: "accent",
  blocked: "warning",
  completed: "success",
  cancelled: "neutral",
};

export function StepStatusBadge({ value }: { value: string }) {
  return <Badge tone={stepTone[value] ?? "neutral"}>{value.replace("_", " ")}</Badge>;
}

const healthTone: Record<string, Tone> = {
  green: "success",
  yellow: "warning",
  red: "error",
};

export function HealthBadge({ band }: { band: string }) {
  return <Badge tone={healthTone[band] ?? "neutral"}>{band}</Badge>;
}

const kindLabel: Record<string, string> = {
  partner: "partner",
  end_customer: "end customer",
};

export function KindBadge({ kind }: { kind: "partner" | "end_customer" }) {
  return (
    <Badge tone={kind === "partner" ? "accent" : "info"}>
      {kindLabel[kind] ?? kind}
    </Badge>
  );
}
