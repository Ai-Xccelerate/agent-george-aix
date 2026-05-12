/* eslint-disable @next/next/no-img-element */

/**
 * Onyx wordmark. The SVG is white with a #B87EFF accent slash — drawn for
 * dark surfaces. Per design-system.md §2.7, the SVG must NEVER sit on a raw
 * light surface (it disappears). We use a chip container in both themes:
 *
 *   - Dark theme  → transparent chip; the dark sidebar IS the backdrop.
 *   - Light theme → brand-gradient pill (#6D45F5 → #4C1FCF) so the white
 *                   wordmark reads sharply AND the chip itself looks like
 *                   product brand, not a debug rectangle.
 *
 * Both variants are rendered and toggled via Tailwind's `dark:` modifier so
 * the correct one appears without a JS hydration flicker.
 *
 * Never apply `filter: invert()` to the SVG — would corrupt the #B87EFF slash.
 */
export function BrandLogo({
  height = 22,
  withGeorgeTag = true,
}: {
  height?: number;
  withGeorgeTag?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Dark theme: bare logo on the already-dark sidebar */}
      <span className="hidden dark:inline-flex items-center">
        <img
          src="/onyx-logo.svg"
          alt="Onyx"
          height={height}
          style={{ height }}
          className="block w-auto"
        />
      </span>

      {/* Light theme: brand-gradient pill so the white SVG reads + stays on-brand */}
      <span
        className="inline-flex dark:hidden items-center rounded-md px-3 py-2 shadow-[0_2px_8px_rgba(109,69,245,0.25)]"
        style={{
          backgroundImage:
            "linear-gradient(135deg, #6D45F5 0%, #4C1FCF 100%)",
        }}
      >
        <img
          src="/onyx-logo.svg"
          alt="Onyx"
          height={height - 4}
          style={{ height: height - 4 }}
          className="block w-auto"
        />
      </span>

      {withGeorgeTag && (
        <span className="text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--color-fg-muted)]">
          george
        </span>
      )}
    </div>
  );
}
