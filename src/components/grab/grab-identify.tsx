"use client";

import { useEffect } from "react";
import { GRAB_KEY, identifyGrabUser, type GrabIdentity } from "@/lib/grab";

/**
 * Tells Grab who is reporting, so people are never asked for their details.
 *
 * Rendered from the (app) layout, which has already resolved the Clerk session
 * and the Core entitlement check — so by the time this mounts the identity is
 * known and trustworthy. Runs as an effect rather than the vendor's inline
 * <script>, which a security hook blocks (see AGENTS.md).
 */
export function GrabIdentify({ user }: { user: GrabIdentity }) {
  const { userId, email, name } = user;

  useEffect(() => {
    if (!GRAB_KEY) return;
    identifyGrabUser({ userId, email, name });
  }, [userId, email, name]);

  return null;
}
