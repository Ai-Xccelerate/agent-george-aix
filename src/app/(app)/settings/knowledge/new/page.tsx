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
        className="inline-flex items-center gap-1 text-[13px] text-[var(--color-fg-secondary)] hover:text-[var(--color-fg)]"
      >
        <ChevronLeft size={14} />
        All knowledge
      </Link>

      <header>
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">New knowledge doc</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          Adds a doc for {user.orgName}. UI-managed docs are independent of{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
            pnpm sync:knowledge
          </code>{" "}
          — that script only manages files committed under{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
            knowledge/
          </code>
          .
        </p>
      </header>

      <DocForm mode="create" saveAction={createDocAction} />
    </div>
  );
}
