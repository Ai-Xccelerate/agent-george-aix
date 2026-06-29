import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { UploadForm } from "../_upload-form";
import { uploadDocsAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UploadKnowledgePage() {
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
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Upload Markdown</h1>
        <p className="mt-1 max-w-[640px] text-sm text-[var(--color-fg-secondary)]">
          Import one or more <code>.md</code> files for {user.orgName}. Each file becomes a
          doc — the path is derived from the filename, the title from frontmatter or the
          first <code># heading</code>, and the body is chunked for search. Frontmatter
          round-trips and a doc&apos;s own <code>is_core: true</code> pins it to the core
          playbook.
        </p>
      </header>

      <UploadForm uploadAction={uploadDocsAction} />
    </div>
  );
}
