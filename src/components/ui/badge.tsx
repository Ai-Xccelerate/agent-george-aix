import AixBadge from "@/components/ui/badge/Badge";
import { cn } from "@/lib/utils";

/**
 * George's domain badges, rebuilt on the AIX theme's Badge primitive.
 *
 * The exported API is unchanged — `Badge` still takes `tone` / `withDot`, and
 * LifecycleBadge / StepStatusBadge / HealthBadge / KindBadge keep their exact
 * signatures — so none of the pages importing them need to change. What changes
 * is the rendering: colours, radius and type now come from the theme's Badge
 * rather than George's old hand-rolled token classes (which included two
 * hardcoded hexes, `#FBE5E5` and `#E6F0FA`, that no longer matched anything).
 */

type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "info";

/** George's semantic tones → the theme Badge's colour names. */
const toneColor: Record<
  Tone,
  "primary" | "success" | "error" | "warning" | "info" | "light"
> = {
  neutral: "light",
  accent: "primary",
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
};

/** Dot colours, kept as explicit classes so the dot reads in both themes. */
const toneDot: Record<Tone, string> = {
  neutral: "bg-gray-400 dark:bg-gray-500",
  accent: "bg-brand-500 dark:bg-brand-400",
  success: "bg-success-500",
  warning: "bg-warning-500",
  error: "bg-error-500",
  info: "bg-blue-light-500",
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
  return (
    <AixBadge
      variant="light"
      size="sm"
      color={toneColor[tone]}
      className={className}
      startIcon={
        withDot ? (
          <span
            className={cn("block h-1.5 w-1.5 rounded-full", toneDot[tone])}
            aria-hidden="true"
          />
        ) : undefined
      }
    >
      {children}
    </AixBadge>
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
