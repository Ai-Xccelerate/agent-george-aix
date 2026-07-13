export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // No agent-branded wrapper — sign-in is just the shared AIX Core Clerk
  // widget on a plain page (matches the AIXDraw/Jules pattern; George does not
  // present its own sign-in UI).
  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-[var(--color-surface)] px-6">
      {children}
    </div>
  );
}
