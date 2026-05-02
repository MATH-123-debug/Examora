import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Examora",
  description:
    "Examora helps university students understand, practice, and pass with AI-powered exam preparation.",
};

const rootClasses = [
  sora.variable,
  plexMono.variable,
  "h-full",
  "antialiased",
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={rootClasses}>
      <body className="min-h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
