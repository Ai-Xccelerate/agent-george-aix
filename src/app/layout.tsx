import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Figtree } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AIX George",
  description: "Your AI Customer Success teammate from AI Xccelerate.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("george-theme")?.value;
  const isDark = themeCookie === "dark";

  // Sign-in/up live on AIX Core; allowedRedirectOrigins lets Clerk send the
  // user back to George after Core login (without it, the redirect is refused
  // and you loop back to Core). Read server-side, passed to the provider.
  const allowedRedirectOrigins = parseList(
    process.env.CLERK_ALLOWED_REDIRECT_ORIGINS,
  );

  return (
    <ClerkProvider
      signInUrl={process.env.CLERK_SIGN_IN_URL}
      signUpUrl={process.env.CLERK_SIGN_UP_URL}
      allowedRedirectOrigins={allowedRedirectOrigins}
    >
      <html
        lang="en"
        className={`${figtree.variable} h-full ${isDark ? "dark" : ""}`}
        data-theme={isDark ? "dark" : "light"}
        suppressHydrationWarning
      >
        <body className="min-h-full antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
