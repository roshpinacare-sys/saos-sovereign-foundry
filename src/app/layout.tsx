import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Heebo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// T-21d · Heebo: Hebrew-first UI face for the sovereign cockpit (latin fallback kept via Geist)
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "SAOS Sovereign Cockpit · תא-הפיקוד הריבוני",
  description:
    "תא-הפיקוד של המנוע-הריבוני-המקומי: אמת-מוטבעת-על-שרשרת, אפס-תלות-חיצונית. פיקוד · שוק · צבא · כלכלה · מערכת.",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${heebo.variable} antialiased bg-background text-foreground font-[family-name:var(--font-heebo),var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif]`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
