"use client";

import React, { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { initials } from "@/lib/utils";

export type HeaderUser = {
  fullName: string;
  email: string | null;
  orgName: string;
};

/**
 * AIX theme user menu, wired to George's real identity.
 *
 * The template ships a hardcoded "Rahul / RB" mock; this takes the signed-in
 * Clerk user resolved server-side in (app)/layout.tsx and passed down, and
 * signs out through Clerk rather than a dead link.
 */
export default function UserDropdown({ user }: { user: HeaderUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const { signOut } = useClerk();

  const firstName = user.fullName.split(" ")[0] || user.fullName;

  function toggleDropdown(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  }

  return (
    <div className="relative">
      <button
        onClick={toggleDropdown}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="dropdown-toggle flex items-center text-gray-700 dark:text-gray-400"
      >
        <span className="mr-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">
          {initials(user.fullName)}
        </span>
        <span className="mr-1 block text-theme-sm font-medium">{firstName}</span>
        <svg
          className={`stroke-gray-500 transition-transform duration-200 dark:stroke-gray-400 ${
            isOpen ? "rotate-180" : ""
          }`}
          width="18"
          height="20"
          viewBox="0 0 18 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4.3125 8.65625L9 13.3437L13.6875 8.65625"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="w-[260px] p-3"
      >
        <div className="border-b border-gray-200 px-2 pb-3 dark:border-gray-800">
          <span className="block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
            {user.fullName}
          </span>
          {user.email && (
            <span className="mt-0.5 block truncate text-theme-xs text-gray-500 dark:text-gray-400">
              {user.email}
            </span>
          )}
          <span className="mt-1.5 inline-block rounded-lg bg-gray-100 px-2 py-0.5 text-theme-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
            {user.orgName}
          </span>
        </div>

        <ul className="flex flex-col gap-1 border-b border-gray-200 py-2 dark:border-gray-800">
          <li>
            <DropdownItem
              tag="a"
              href="/settings/profile"
              onItemClick={() => setIsOpen(false)}
              className="rounded-lg"
            >
              Profile
            </DropdownItem>
          </li>
          <li>
            <DropdownItem
              tag="a"
              href="/settings/organization"
              onItemClick={() => setIsOpen(false)}
              className="rounded-lg"
            >
              Organisation
            </DropdownItem>
          </li>
          <li>
            <DropdownItem
              tag="a"
              href="/help"
              onItemClick={() => setIsOpen(false)}
              className="rounded-lg"
            >
              Help &amp; docs
            </DropdownItem>
          </li>
        </ul>

        <div className="pt-2">
          <DropdownItem
            onItemClick={() => {
              setIsOpen(false);
              void signOut({ redirectUrl: "/" });
            }}
            className="rounded-lg"
          >
            Sign out
          </DropdownItem>
        </div>
      </Dropdown>
    </div>
  );
}
