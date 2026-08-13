"use client";

const ROLES = ["admin", "csm", "sales", "viewer"] as const;

export function RoleSelect({
  userId,
  currentRole,
  action,
}: {
  userId: string;
  currentRole: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 py-1 text-theme-xs text-gray-800 dark:text-white/90"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}
