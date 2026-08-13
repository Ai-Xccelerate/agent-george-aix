"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import CommandPalette from "@/components/common/CommandPalette";
import { useSidebar } from "@/context/SidebarContext";
import type { HeaderUser } from "@/components/header/UserDropdown";

export type SidebarUser = HeaderUser;

/**
 * Routes whose page owns the full viewport and manages its own scrolling —
 * chat's message list and the calendar's time grid both size themselves with
 * `h-full`. Everything else is a document page that flows and scrolls in the
 * main region.
 */
const APP_PANE_ROUTES = ["/chat", "/calendar"];

export function AppShell({
  user,
  children,
}: {
  user: SidebarUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { isExpanded, isHovered, isMobileOpen, toggleMobileSidebar } = useSidebar();

  const isAppPane = APP_PANE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );

  // Close the mobile drawer on navigation.
  useEffect(() => {
    if (isMobileOpen) toggleMobileSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The sidebar is fixed, so the content column is offset by margin instead.
  const contentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[240px]"
      : "lg:ml-[80px]";

  return (
    <div className="h-dvh overflow-hidden">
      <AppSidebar />
      <Backdrop />

      <div
        className={`flex h-dvh min-w-0 flex-col transition-all duration-300 ease-in-out ${contentMargin}`}
      >
        <AppHeader user={user} />

        {/*
          No padding here on purpose: every George page already supplies its own
          (`px-4 py-5 sm:px-6 md:px-8 ...`). The AIX theme's own layout adds
          `p-4 md:p-6` at this level, which would double it on all 30 routes.
        */}
        <main
          data-aix-id="AIX-F4"
          className={`min-h-0 w-full flex-1 ${
            isAppPane ? "overflow-hidden" : "overflow-y-auto"
          }`}
        >
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
