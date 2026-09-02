"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/context/SidebarContext";
import {
  BoltIcon,
  CalenderIcon,
  ChevronDownIcon,
  DocsIcon,
  GridIcon,
  GroupIcon,
  InfoIcon,
  MailIcon,
  PlugInIcon,
  TimeIcon,
} from "@/icons";
import { BrandLogo, GeorgeAvatar } from "@/components/brand-logo";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  /**
   * Prefix that keeps this item highlighted, when it's broader than `path`.
   * Settings links straight to /settings/profile to skip a redirect, but must
   * still read as active anywhere under /settings.
   */
  match?: string;
  subItems?: { name: string; path: string; new?: boolean }[];
};

/**
 * George's real routes. The AIX theme's demo nav (e-commerce, AI generators,
 * UI element galleries) is deliberately not carried over — only the surfaces
 * George actually serves.
 */
// No Chat entry. The standalone chat page was retired when George moved into
// the floating bubble that is on every screen — /chat now forwards to AI
// actions. A nav item pointing at a redirect is worse than no nav item: it
// promises a destination, and lands the user somewhere they did not ask for.
// (Deep links to a specific conversation still work at /chat/[id].)
const navItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/dashboard" },
  { icon: <BoltIcon />, name: "AI Actions", path: "/actions" },
  { icon: <GroupIcon />, name: "Customers", path: "/customers" },
];

/** The surfaces George operates across. */
const channelItems: NavItem[] = [
  { icon: <MailIcon />, name: "Mailbox", path: "/mailbox" },
  { icon: <CalenderIcon />, name: "Calendar", path: "/calendar" },
  { icon: <TimeIcon />, name: "Meetings", path: "/meetings" },
  { icon: <DocsIcon />, name: "Transcripts", path: "/transcripts" },
];

/**
 * Settings is a single link, not an expanding group. The settings screen has
 * its own left sub-nav (see settings/_nav.tsx) which is role-aware — a second
 * copy in the sidebar duplicated it, couldn't hide admin-only items, and drifted
 * out of step whenever the real one changed.
 *
 * It points straight at /settings/profile rather than /settings. The index route
 * only exists to role-check and redirect, and every hop through it costs a full
 * server render plus another getCurrentUser() (Clerk + Core entitlement check +
 * tenant mirror). Linking past it removes that round trip on every click.
 */
const accountItems: NavItem[] = [
  { icon: <PlugInIcon />, name: "Settings", path: "/settings/profile", match: "/settings" },
  { icon: <InfoIcon />, name: "Help & docs", path: "/help" },
];

type MenuType = "main" | "channels" | "account";

const MENUS: Record<MenuType, NavItem[]> = {
  main: navItems,
  channels: channelItems,
  account: accountItems,
};

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();

  // A user toggle, scoped to the path it was made on. Anything else is derived
  // from the route below, so navigating away drops the override without an
  // effect having to reset it.
  const [override, setOverride] = useState<{
    path: string;
    value: { type: MenuType; index: number } | null;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>({});
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /**
   * George has nested routes (/settings/agent/policy, /chat/[id]), so a section
   * stays active for anything beneath it. The template compares paths exactly,
   * which would blank the highlight as soon as you opened a detail page.
   */
  const isActive = useCallback(
    (path: string) => pathname === path || pathname.startsWith(path + "/"),
    [pathname],
  );

  // Which group the current route lives in — pure derivation, no state and no
  // manual memo. It walks ~10 static entries, so memoising it would cost more
  // than it saves; the compiler can cache it if that ever stops being true.
  const routeSubmenu = (() => {
    for (const menuType of Object.keys(MENUS) as MenuType[]) {
      const items = MENUS[menuType];
      for (let index = 0; index < items.length; index++) {
        const nav = items[index];
        if (nav.subItems?.some((s) => isActive(s.path))) {
          return { type: menuType, index };
        }
      }
    }
    return null;
  })();

  const openSubmenu = override?.path === pathname ? override.value : routeSubmenu;

  useEffect(() => {
    if (openSubmenu === null) return;
    const key = `${openSubmenu.type}-${openSubmenu.index}`;
    if (subMenuRefs.current[key]) {
      setSubMenuHeight((prev) => ({
        ...prev,
        [key]: subMenuRefs.current[key]?.scrollHeight || 0,
      }));
    }
  }, [openSubmenu]);

  const handleSubmenuToggle = (index: number, menuType: MenuType) => {
    const isOpen =
      openSubmenu?.type === menuType && openSubmenu?.index === index;
    setOverride({
      path: pathname,
      value: isOpen ? null : { type: menuType, index },
    });
  };

  const showLabels = isExpanded || isHovered || isMobileOpen;

  const renderMenuItems = (items: NavItem[], menuType: MenuType) => (
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered ? "lg:justify-center" : "lg:justify-start"
              }`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center [&>svg]:size-5 [&>svg]:shrink-0 ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {showLabels && <span className="menu-item-text">{nav.name}</span>}
              {showLabels && (
                <ChevronDownIcon
                  className={`ml-auto h-5 w-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType && openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                className={`menu-item group ${
                  isActive(nav.match ?? nav.path)
                    ? "menu-item-active"
                    : "menu-item-inactive"
                } ${
                  !isExpanded && !isHovered ? "lg:justify-center" : "lg:justify-start"
                }`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center [&>svg]:size-5 [&>svg]:shrink-0 ${
                    isActive(nav.match ?? nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {showLabels && <span className="menu-item-text">{nav.name}</span>}
              </Link>
            )
          )}
          {nav.subItems && showLabels && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="ml-9 mt-2 space-y-1">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      href={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      {subItem.new && (
                        <span className="ml-auto flex items-center gap-1">
                          <span
                            className={`${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            new
                          </span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  const sectionHeading = (label: string) => (
    <h2
      className={`mb-4 flex items-center text-xs font-medium uppercase leading-[20px] tracking-wider text-gray-500 dark:text-gray-400 ${
        !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
      }`}
    >
      {showLabels ? (
        label
      ) : (
        <span className="h-px w-6 rounded-full bg-gray-200 dark:bg-gray-700" />
      )}
    </h2>
  );

  return (
    <aside
      data-aix-id="AIX-F1"
      className={`glass-surface fixed left-0 top-0 z-50 mt-16 flex h-screen flex-col border-r border-gray-200 px-4 text-gray-900 transition-all duration-300 ease-in-out dark:border-gray-800 lg:mt-0
        ${
          isExpanded || isMobileOpen
            ? "w-[260px] lg:w-[240px]"
            : isHovered
              ? "w-[240px]"
              : "w-[80px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`flex h-22.5 shrink-0 items-center ${
          !isExpanded && !isHovered ? "justify-start lg:justify-center" : "justify-start"
        }`}
      >
        <Link href="/dashboard" aria-label="Agent George">
          {showLabels ? <BrandLogo avatarSize={40} /> : <GeorgeAvatar size={32} />}
        </Link>
      </div>

      <div className="no-scrollbar flex flex-col overflow-y-auto duration-300 ease-linear">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              {sectionHeading("Menu")}
              {renderMenuItems(navItems, "main")}
            </div>
            <div>
              {sectionHeading("Channels")}
              {renderMenuItems(channelItems, "channels")}
            </div>
            <div>
              {sectionHeading("Account")}
              {renderMenuItems(accountItems, "account")}
            </div>
          </div>
        </nav>
      </div>
    </aside>
  );
};

export default AppSidebar;
