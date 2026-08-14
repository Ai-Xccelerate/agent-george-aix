import Script from "next/script";
import { grabScriptSrc, readGrabKey } from "@/lib/grab";

/**
 * Loads the Grab reporter. Mounted in the root layout so it is available on
 * every surface — including /signin and the Core-access-denied screen, which
 * are exactly the places a broken sign-in needs reporting from.
 *
 * This is a SERVER component on purpose. The key is resolved here at request
 * time; if it were read inside client code it would be inlined during
 * `next build`, which in George's Docker image runs without any of Railway's
 * variables, and the widget would never install however the service is
 * configured.
 *
 * No key set = not rendered at all, which keeps local development out of the
 * feedback inbox and lets each environment opt in separately.
 */
export function GrabWidget() {
  const key = readGrabKey();
  if (!key) return null;
  return <Script src={grabScriptSrc(key)} strategy="afterInteractive" />;
}
