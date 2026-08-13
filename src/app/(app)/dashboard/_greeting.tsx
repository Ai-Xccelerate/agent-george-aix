"use client";

import { useEffect, useState } from "react";

// Time-of-day greeting computed in the browser so it matches the viewer's
// local clock (the server runs in UTC). Falls back to "Welcome back" until
// hydration so there's no flash of a wrong greeting.
export function Greeting({ firstName }: { firstName: string | null }) {
  const [part, setPart] = useState<string | null>(null);

  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const lead = part ?? "Welcome back";
  return (
    <h1 className="font-display text-2xl font-semibold tracking-tight leading-tight text-gray-800 dark:text-white/90">
      {lead}{firstName ? `, ${firstName}` : ""}
    </h1>
  );
}
