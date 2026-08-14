/* eslint-disable @next/next/no-img-element */

/**
 * George workforce avatar — rounded-square orange tile with illustrated portrait.
 *
 * The source PNG is a circle drawn on a transparent square canvas, so rounding
 * the image alone would leave a circle with four empty corners. The wrapper
 * carries the same warm orange the artwork fades into, filling those corners so
 * the whole thing reads as one rounded square, matching the theme's tile shape
 * rather than the circular avatar treatment used for people.
 */
export function GeorgeAvatar({
  size = 48,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`block shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-300 to-brand-400 ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/george-avatar.png"
        alt="Agent George"
        width={size}
        height={size}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

/** Sidebar / header brand — Jules-style: George symbol + name + AI Xccelerate. */
export function BrandLogo({
  avatarSize = 52,
  withSubtext = true,
}: {
  avatarSize?: number;
  withSubtext?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <GeorgeAvatar size={avatarSize} />
      {withSubtext && (
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-bold tracking-tight text-gray-800 dark:text-white/90">
              George
            </span>
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">AI Xccelerate</span>
        </div>
      )}
    </div>
  );
}
