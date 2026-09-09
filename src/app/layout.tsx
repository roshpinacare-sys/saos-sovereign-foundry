import type { Metadata, Viewport } from "next";
import { Heebo, Space_Grotesk } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  display: "swap"
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SAOS — מרכז שליטה מבצעי | Sovereign Foundry v4",
  description:
    "מרכז שליטה לרשתות בלוקצ'יין: אימות שרשרת, עוגנים חיצוניים, חתימות keyless, מצב רשתות, קופה חיה חוצת-שרשראות, גיבויים, אבטחה והחלטות בעלים — נתונים חיים בלבד."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${grotesk.variable}`}>
      <body className="min-h-screen text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
