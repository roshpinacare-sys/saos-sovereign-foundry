import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAOS — מרכז שליטה מבצעי | Sovereign Foundry v2",
  description:
    "מרכז שליטה לרשתות בלוקצ'יין: אימות שרשרת, עוגנים חיצוניים, חתימות keyless, מצב רשתות, גיבויים, אבטחה והחלטות בעלים — נתונים חיים בלבד."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
