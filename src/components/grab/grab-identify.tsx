"use client";

import { useEffect } from "react";
import { identifyGrabUser, type GrabIdentity } from "@/lib/grab";

/**
 * Tells Grab who is reporting, so people are never asked for their details.
 *
 * Rendered from the (app) layout, which has already resolved the Clerk session
 * and the Core entitlement check — so by the time this mounts the identity is
 * known and trustworthy. Runs as an effect rather than the vendor's inline
 * <script>, which a security hook blocks (see AGENTS.md).
 *
 * `enabled` is passed down from the server rather than checked here: client
 * code cannot see the key (see readGrabKey). When the widget isn't installed
 * this renders nothing rather than queuing calls nothing will ever drain.
 */
export function GrabIdentify({
  user,
  enabled,
}: {
  user: GrabIdentity;
  enabled: boolean;
}) {
  const { userId, email, name } = user;

  useEffect(() => {
    if (!enabled) return;
    identifyGrabUser({ userId, email, name });
  }, [enabled, userId, email, name]);

  return null;
}
