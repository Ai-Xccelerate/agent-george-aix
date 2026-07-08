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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("george-theme")?.value;
  const isDark = themeCookie === "dark";

  return (
    <ClerkProvider>
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
