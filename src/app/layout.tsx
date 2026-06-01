import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { StudyThemeProvider } from "@/components/study-theme-provider";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Examora",
  description:
    "Examora helps university students understand, practice, and pass with AI-powered exam preparation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
        <AuthProvider>
          <StudyThemeProvider>{children}</StudyThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
