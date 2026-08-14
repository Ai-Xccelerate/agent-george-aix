"use client";

import Script from "next/script";
import { GRAB_KEY, grabScriptSrc } from "@/lib/grab";

/**
 * Loads the Grab reporter. Mounted in the root layout so it is available on
 * every surface — including /signin and the Core-access-denied screen, which
 * are exactly the places a broken sign-in needs reporting from.
 *
 * Gated on NEXT_PUBLIC_GRAB_KEY: with no key set the widget is not installed at
 * all, which keeps local development out of the feedback inbox and lets staging
 * and production carry different keys.
 */
export function GrabWidget() {
  if (!GRAB_KEY) return null;
  return <Script src={grabScriptSrc(GRAB_KEY)} strategy="afterInteractive" />;
}
