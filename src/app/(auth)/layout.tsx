/* eslint-disable @next/next/no-img-element */
import { Sparkles, ShieldCheck, Zap } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left brand panel — purple/deep brand gradient with white logo */}
      <aside className="brand-gradient-vertical relative hidden w-[520px] flex-col justify-between p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img
            src="/onyx-logo.svg"
            alt="Onyx"
            className="block h-8 w-auto"
          />
          <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/70">
            George
          </span>
        </div>

        <div className="space-y-6">
          <h1 className="text-[36px] font-bold leading-[1.15]">
            Your AI Customer Success teammate.
          </h1>
          <p className="max-w-[400px] text-[15px] leading-relaxed text-white/85">
            George handles onboarding, watches every customer’s health, and replies
            to email — so your CSMs stay on the conversations only humans can have.
          </p>

          <div className="space-y-3 pt-4">
            <TrustRow icon={Sparkles} text="Chat-first — built on Claude Agent SDK" />
            <TrustRow icon={ShieldCheck} text="Your data lives in your Supabase" />
            <TrustRow icon={Zap} text="Composio-native integrations" />
          </div>
        </div>

        <p className="text-[12px] text-white/65">
          © {new Date().getFullYear()} AIXccelerate · Built for Onyx
        </p>
      </aside>

      {/* Right content */}
      <main className="flex flex-1 items-center justify-center bg-[var(--color-surface)] px-8 py-16">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}

function TrustRow({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 text-white/85">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15">
        <Icon size={14} />
      </span>
      <span className="text-[13px]">{text}</span>
    </div>
  );
}
