/* eslint-disable @next/next/no-img-element */

/** George workforce avatar — circular orange mark with illustrated portrait. */
export function GeorgeAvatar({
  size = 48,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/george-avatar.png"
      alt="Agent George"
      width={size}
      height={size}
      className={`block shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
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
            <span className="text-[15px] font-bold tracking-tight text-[var(--color-fg)]">
              George
            </span>
          </div>
          <span className="text-[11px] text-[var(--color-fg-muted)]">AI Xccelerate</span>
        </div>
      )}
    </div>
  );
}
