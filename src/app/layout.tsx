import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import LiquidBackdrop from "@/components/common/LiquidBackdrop";
import { DensityProvider, type Density } from "@/context/DensityContext";
import { SidebarProvider } from "@/context/SidebarContext";
import { ThemeProvider } from "@/context/ThemeContext";
import "./globals.css";

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
  // George is dark-first, so an absent cookie resolves to dark. The AIX theme
  // defaults to light; that difference is deliberate and matches the product's
  // existing behaviour. The class is stamped here, server-side, rather than by
  // the template's inline no-flash <script> — inline script injection in
  // layouts is blocked by a security hook, and this has no flash anyway.
  const themeCookie = cookieStore.get("george-theme")?.value;
  const isDark = themeCookie !== "light";

  // Passed into ThemeProvider so the first client render matches this markup.
  const prefCookie = cookieStore.get("george-theme-pref")?.value;
  const initialPreference =
    prefCookie === "light" || prefCookie === "dark" || prefCookie === "system"
      ? prefCookie
      : "dark";

  // Density is stamped here too, so compact/comfortable users don't get a
  // default-spacing render that reflows once hydration lands. Validated inline
  // rather than with a helper from DensityContext — that module is "use client",
  // so a server component can import its *type* but never call into it.
  const densityCookie = cookieStore.get("george-density")?.value;
  const initialDensity: Density =
    densityCookie === "comfortable" || densityCookie === "compact"
      ? densityCookie
      : "default";

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
        className={`h-full ${isDark ? "dark" : ""}`}
        data-theme={isDark ? "dark" : "light"}
        data-density={initialDensity}
        suppressHydrationWarning
      >
        <body className="min-h-full font-outfit antialiased">
          <LiquidBackdrop />
          <ThemeProvider
            initialTheme={isDark ? "dark" : "light"}
            initialPreference={initialPreference}
          >
            <DensityProvider initialDensity={initialDensity}>
              <SidebarProvider>{children}</SidebarProvider>
            </DensityProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
