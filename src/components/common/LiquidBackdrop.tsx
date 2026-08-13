import React from "react";

/**
 * LiquidBackdrop — the ambient gradient canvas the whole app floats on.
 *
 * A single fixed, full-viewport layer (z-index -1) carrying three slow-drifting,
 * heavily-blurred blobs (AIX orange + indigo + sky) over a theme-aware base.
 * Glass chrome (sidebar, header, modals, menus) refracts it; content cards stay
 * opaque above it. GPU-cheap: transform-only animation, pre-blurred gradients,
 * and it halts under `prefers-reduced-motion`. All styling lives in globals.css.
 *
 * Purely presentational — safe as a server component. Mount once at the app root.
 */
export default function LiquidBackdrop() {
  return (
    <div className="liquid-backdrop" aria-hidden="true">
      <div className="liquid-backdrop-blob liquid-blob-a" />
      <div className="liquid-backdrop-blob liquid-blob-b" />
      <div className="liquid-backdrop-blob liquid-blob-c" />
    </div>
  );
}
