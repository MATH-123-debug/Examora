"use client";

import Link from "next/link";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { auth } from "@/lib/firebase";

const featureCards = [
  {
    title: "Understand faster",
    text: "Turn difficult notes and topics into simple explanations that feel easier to study.",
  },
  {
    title: "Practice smarter",
    text: "Generate CBT, short-answer, and theory questions from your own course material.",
  },
  {
    title: "Pass with focus",
    text: "Revise key points, likely exam areas, and structured answers in one calm workflow.",
  },
];

export default function Home() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <main className="grid-surface flex-1">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="glass-panel flex items-center justify-between rounded-full px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="brand-button flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-semibold text-white">
              E
            </div>
            <div>
              <p className="text-base font-semibold tracking-[-0.03em] text-white">
                Examora
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
                Understand. Practice. Pass.
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-2 sm:gap-3">
            {!isLoading && user ? (
              <>
                <Link
                  href="/dashboard"
                  className="rounded-full px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-white sm:px-4 sm:text-sm"
                >
                  Dashboard
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/10 sm:px-5 sm:text-sm"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-full px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-white sm:px-4 sm:text-sm"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="brand-button rounded-full px-4 py-2.5 text-xs font-semibold text-white transition hover:scale-[1.02] sm:px-5 sm:text-sm"
                >
                  Start free
                </Link>
              </>
            )}
          </nav>
        </header>

        <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
              AI exam prep for university students
            </p>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-6xl">
              Study smarter,
              <br />
              pass faster.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--color-text-muted)] sm:text-xl">
              Examora helps students turn PDFs, topics, outlines, and plain
              text into explanations, revision notes, and exam practice for
              both CBT and theory exams.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {!isLoading && user ? (
                <>
                  <Link
                    href="/dashboard"
                    className="brand-button rounded-full px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:scale-[1.02]"
                  >
                    Go to dashboard
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="surface-panel rounded-full px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-white/8"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="brand-button rounded-full px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:scale-[1.02]"
                  >
                    Start free
                  </Link>
                  <Link
                    href="/dashboard"
                    className="surface-panel rounded-full px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-white/8"
                  >
                    Preview workspace
                  </Link>
                </>
              )}
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {featureCards.map((item) => (
                <div key={item.title} className="soft-card rounded-[1.5rem] p-5">
                  <h2 className="text-sm font-semibold text-white">{item.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute left-6 top-8 h-28 w-28 rounded-full bg-[rgba(124,58,237,0.32)] blur-3xl" />
            <div className="absolute right-4 top-24 h-36 w-36 rounded-full bg-[rgba(59,130,246,0.24)] blur-3xl" />

            <div className="surface-panel relative rounded-[2rem] p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-text-soft)]">
                    Live session
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    GST 101: Communication in English
                  </h2>
                </div>
                <span className="rounded-full border border-[rgba(255,255,255,0.1)] bg-white/6 px-3 py-1 font-mono text-xs text-[var(--color-text-muted)]">
                  Theory + CBT
                </span>
              </div>

              <div className="mt-6 rounded-[1.5rem] bg-[rgba(2,6,23,0.52)] p-5">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-text-soft)]">
                  Input
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">
                  Formal and informal communication, barriers to effective
                  communication, listening skills, academic writing, and public
                  speaking basics.
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="soft-card rounded-[1.35rem] p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-text-soft)]">
                    Output
                  </p>
                  <p className="mt-3 text-sm font-medium text-white">
                    Quick revision notes
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                    Short key points ready for fast study before tests.
                  </p>
                </div>

                <div className="soft-card rounded-[1.35rem] p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-text-soft)]">
                    Practice
                  </p>
                  <p className="mt-3 text-sm font-medium text-white">
                    MCQ and theory questions
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                    Practice with both objective and writing exam formats.
                  </p>
                </div>
              </div>

              <div className="mt-5 soft-card rounded-[1.5rem] p-5">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-text-soft)]">
                  Core promise
                </p>
                <p className="mt-3 text-base font-medium leading-7 text-white">
                  Turn your notes into understanding, practice, and exam-ready confidence.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
