"use client";

import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Density = "default" | "comfortable" | "compact";

/**
 * Site-wide density, server-seeded like the theme.
 *
 * The AIX theme keeps this in localStorage and applies it in a mount effect,
 * which means the whole UI renders at default spacing and then reflows once
 * hydration lands — visible on every navigation for anyone on compact. George
 * stores it in the `george-density` cookie instead so `src/app/layout.tsx` can
 * stamp `data-density` on <html> before the document is sent, and the provider
 * starts from the value the server already used.
 */

const DENSITY_COOKIE = "george-density";
const ONE_YEAR = 60 * 60 * 24 * 365;

type DensityContextType = {
  density: Density;
  setDensity: (density: Density) => void;
};

const DensityContext = createContext<DensityContextType | undefined>(undefined);

export const DensityProvider: React.FC<{
  children: React.ReactNode;
  initialDensity: Density;
}> = ({ children, initialDensity }) => {
  const [density, setDensityState] = useState<Density>(initialDensity);

  // Mirror the choice onto <html> + cookie. No initial-read effect: the server
  // already resolved it, so there is nothing to discover after mount.
  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    document.cookie = `${DENSITY_COOKIE}=${density}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }, [density]);

  const setDensity = useCallback((next: Density) => setDensityState(next), []);

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
};

export const useDensity = () => {
  const context = useContext(DensityContext);
  if (context === undefined) {
    throw new Error("useDensity must be used within a DensityProvider");
  }
  return context;
};
