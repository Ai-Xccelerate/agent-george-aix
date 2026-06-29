"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { syncTranscripts } from "@/lib/agent/transcript-sync";

export type SyncState = { error?: string; info?: string };

export async function syncTranscriptsNowAction(
  _: SyncState,
  _formData: FormData,
): Promise<SyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  const result = await syncTranscripts(user.orgId);
  revalidatePath("/transcripts");

  if (result.errors.length && result.transcripts_upserted === 0) {
    return { error: result.errors[0] };
  }
  if (result.transcripts_upserted > 0) {
    return {
      info: `Synced ${result.transcripts_upserted} transcript${
        result.transcripts_upserted === 1 ? "" : "s"
      }.`,
    };
  }
  return { info: "Up to date — no new transcripts." };
}
