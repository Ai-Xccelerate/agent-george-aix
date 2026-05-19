import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agent George",
  description: "Your AI Customer Success Manager.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Dark-first: apply `.dark` unless the cookie explicitly says "light".
  // Server-rendered classname so there's no FOUC.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("george-theme")?.value;
  const isDark = themeCookie !== "light";

  return (
    <html
      lang="en"
      className={`${inter.variable} h-full ${isDark ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
