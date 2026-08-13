import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { DocForm } from "../_doc-form";
import { createDocAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewKnowledgeDocPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  return (
    <div className="space-y-5">
      <Link
        href="/settings/knowledge"
        className="inline-flex items-center gap-1 text-theme-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white/90"
      >
        <ChevronLeft size={14} />
        All knowledge
      </Link>

      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">New knowledge doc</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Adds a doc for {user.orgName}. UI-managed docs are independent of{" "}
          <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1 py-0.5 text-theme-xs">
            pnpm sync:knowledge
          </code>{" "}
          — that script only manages files committed under{" "}
          <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1 py-0.5 text-theme-xs">
            knowledge/
          </code>
          .
        </p>
      </header>

      <DocForm mode="create" saveAction={createDocAction} />
    </div>
  );
}
