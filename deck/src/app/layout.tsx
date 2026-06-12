import type { Metadata } from "next";
import { Lato } from "next/font/google";
import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-lato",
});

export const metadata: Metadata = {
  title: "Ground Crew Deck",
  description: "Live board of crew tasks, workspaces, and pull requests.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="en" className={lato.variable}>
      <body className="min-h-screen antialiased">
        <header
          className="flex h-12 items-center px-5"
          style={{ background: "var(--nav-gradient)" }}
        >
          <span
            className="text-sm font-bold tracking-wide"
            style={{ color: "var(--text-inverted)" }}
          >
            Ground Crew
          </span>
          <span className="ml-2 text-sm" style={{ color: "var(--nav-item-text)" }}>
            Deck
          </span>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
