import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";

export default async function SettingsIndex() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  redirect(isAdmin ? "/settings/users" : "/settings/profile");
}
