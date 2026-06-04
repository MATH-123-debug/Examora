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

const mobileFeatureCards = featureCards.slice(0, 2);

export default function Home() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <main className="grid-surface flex-1">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-10">
        <header className="glass-panel flex flex-col gap-4 rounded-[1.75rem] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:px-5">
          <div className="flex items-center gap-3">
            <div className="brand-button flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-semibold text-white">
              E
            </div>
            <div>
              <p className="text-base font-semibold tracking-[-0.03em] text-white">
                Examora
              </p>
              <p className="hidden font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-soft)] sm:block">
                Understand. Practice. Pass.
              </p>
            </div>
          </div>

          <nav className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
            {!isLoading && user ? (
              <>
                <Link
                  href="/dashboard"
                  className="flex-1 rounded-full px-3 py-2.5 text-center text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-white sm:flex-none sm:px-4 sm:text-sm"
                >
                  Dashboard
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex-1 rounded-full border border-[var(--color-border)] bg-white/6 px-4 py-2.5 text-center text-xs font-semibold text-white transition hover:bg-white/10 sm:flex-none sm:px-5 sm:text-sm"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="flex-1 rounded-full px-3 py-2.5 text-center text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-white sm:flex-none sm:px-4 sm:text-sm"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="brand-button flex-1 rounded-full px-4 py-2.5 text-center text-xs font-semibold text-white transition hover:scale-[1.02] sm:flex-none sm:px-5 sm:text-sm"
                >
                  Start free
                </Link>
              </>
            )}
          </nav>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 sm:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:py-14">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
              AI exam prep for university students
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:mt-6 sm:text-5xl lg:text-6xl">
              Study smarter,
              <br />
              pass faster.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--color-text-muted)] sm:mt-6 sm:text-lg sm:leading-8 lg:text-xl">
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
                    href="/signup"
                    className="surface-panel rounded-full px-6 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-white/8"
                  >
                    See how it works
                  </Link>
                </>
              )}
            </div>

            <div className="mt-8 grid gap-3 sm:hidden">
              {mobileFeatureCards.map((item) => (
                <div key={item.title} className="soft-card rounded-[1.35rem] p-4">
                  <h2 className="text-sm font-semibold text-white">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-10 hidden gap-4 sm:grid sm:grid-cols-3">
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

          <div className="relative hidden lg:block">
            <div className="absolute left-6 top-8 h-28 w-28 rounded-full bg-[rgba(124,58,237,0.32)] blur-3xl" />
            <div className="absolute right-4 top-24 h-36 w-36 rounded-full bg-[rgba(59,130,246,0.24)] blur-3xl" />

            <div className="surface-panel relative rounded-[1.8rem] p-5 sm:rounded-[2rem] sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-text-soft)]">
                    Live session
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    GST 101: Communication in English
                  </h2>
                </div>
                <span className="w-fit rounded-full border border-[rgba(255,255,255,0.1)] bg-white/6 px-3 py-1 font-mono text-xs text-[var(--color-text-muted)]">
                  Theory + CBT
                </span>
              </div>

              <div className="mt-5 rounded-[1.4rem] bg-[rgba(2,6,23,0.52)] p-4 sm:mt-6 sm:rounded-[1.5rem] sm:p-5">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-text-soft)]">
                  Input
                </p>
                <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">
                  Formal and informal communication, barriers to effective
                  communication, listening skills, academic writing, and public
                  speaking basics.
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2">
                <div className="soft-card rounded-[1.2rem] p-4 sm:rounded-[1.35rem]">
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

                <div className="hidden soft-card rounded-[1.35rem] p-4 sm:block">
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

              <div className="mt-4 soft-card rounded-[1.35rem] p-4 sm:mt-5 sm:rounded-[1.5rem] sm:p-5">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-text-soft)]">
                  Core promise
                </p>
                <p className="mt-3 text-sm font-medium leading-7 text-white sm:text-base">
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
