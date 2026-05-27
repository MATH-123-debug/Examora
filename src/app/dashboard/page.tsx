"use client";

import { useEffect } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { useAuth } from "@/components/auth-provider";
import { useStudyTheme } from "@/components/study-theme-provider";
import { auth } from "@/lib/firebase";

const modeCards = [
  {
    id: "study",
    title: "Study mode",
    description: "Ask questions, upload notes, and study in a flowing chat conversation.",
    cta: "Open study workspace",
    href: "/study",
  },
  {
    id: "exam",
    title: "Exam mode",
    description: "Practice with CBT questions, submit your answers, and review your score.",
    cta: "Open exam mode",
    href: "/test",
  },
];

export default function DashboardHomePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { theme, toggleTheme } = useStudyTheme();
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, router, user]);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  if (isLoading) {
    return (
      <main className={`study-shell ${theme} flex min-h-screen items-center justify-center px-6 py-10`}>
        <div className="study-surface rounded-[2rem] px-6 py-5 text-sm text-[var(--study-text-muted)]">
          Loading your workspace...
        </div>
      </main>
    );
  }

  return (
    <main className={`study-shell ${theme}`}>
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.28em]"
              style={{ color: "var(--study-text-soft)" }}
            >
              Examora dashboard
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Choose what you want to do right now.
            </h1>
          </div>

          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setShowMenu((current) => !current)}
              className="rounded-full px-4 py-2.5 text-sm font-semibold"
              style={{
                border: "1px solid var(--study-border)",
                background: "var(--study-surface-soft)",
                color: "var(--study-text)",
              }}
            >
              Menu
            </button>
            {showMenu ? (
              <div
                className="study-surface absolute right-0 top-12 z-10 min-w-36 rounded-2xl p-1 shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => {
                    toggleTheme();
                    setShowMenu(false);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                  style={{ color: "var(--study-text)" }}
                >
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm"
                  style={{ color: "var(--study-text)" }}
                >
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="mt-6 grid flex-1 gap-3 sm:mt-8 sm:gap-4 lg:grid-cols-2">
          {modeCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => router.push(card.href)}
              className="study-surface flex min-h-[128px] flex-col justify-between rounded-[1.4rem] p-4 text-left transition hover:-translate-y-1 sm:min-h-[184px] sm:rounded-[1.7rem] sm:p-5"
            >
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-[0.24em]"
                  style={{ color: "var(--study-text-soft)" }}
                >
                  {card.id === "study" ? "Learn" : "Practice"}
                </p>
                <h2 className="mt-3 text-xl font-semibold sm:text-2xl">{card.title}</h2>
                <p
                  className="mt-3 max-w-md text-sm leading-6"
                  style={{ color: "var(--study-text-muted)" }}
                >
                  {card.description}
                </p>
              </div>

              <div className="mt-4 flex flex-col items-start gap-3 sm:mt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span
                  className="rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em]"
                  style={{
                    background: "var(--study-surface-soft)",
                    color: "var(--study-text-soft)",
                  }}
                >
                  {card.id === "study" ? "Chat workspace" : "Real exam room"}
                </span>
                <span className="study-button rounded-full px-4 py-2 text-sm font-semibold text-white">
                  {card.cta}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-[1.6rem] border px-4 py-4 sm:mt-6 sm:rounded-[1.8rem] sm:px-5" style={{ borderColor: "var(--study-border)" }}>
          <p className="text-sm font-semibold">Signed in as</p>
          <p className="mt-2 text-sm" style={{ color: "var(--study-text-muted)" }}>
            {user?.displayName || "Student"} - {user?.email}
          </p>
        </div>
      </section>
    </main>
  );
}
