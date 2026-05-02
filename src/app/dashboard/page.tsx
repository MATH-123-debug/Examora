"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { useAuth } from "@/components/auth-provider";
import { auth } from "@/lib/firebase";

const quickActions = [
  "Explain this simpler",
  "Give me likely exam questions",
  "Summarize this topic",
  "Create theory questions",
  "Test me with CBT",
  "Give me revision points",
];

function buildPreviewResponse(prompt: string) {
  const trimmedPrompt = prompt.trim();

  return {
    heading: "Study response preview",
    summary:
      "This is the first working dashboard flow. It is using a local preview response now, and the next step will be replacing this with real OpenAI output.",
    bullets: [
      `Your prompt: ${trimmedPrompt}`,
      "Examora can now accept typed study requests from the dashboard.",
      "Quick actions can help students start faster when they do not know what to type.",
      "Next we will connect this input flow to real AI generation.",
    ],
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<null | ReturnType<typeof buildPreviewResponse>>(null);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, router, user]);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  function handleGenerate() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setFormError("Enter a topic, question, or instruction first.");
      setResult(null);
      return;
    }

    setFormError("");
    setResult(buildPreviewResponse(trimmedPrompt));
  }

  function handleQuickAction(action: string) {
    setPrompt(action);
    setFormError("");
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="surface-panel rounded-[2rem] px-6 py-5 text-sm text-[var(--color-text-muted)]">
          Checking your session...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-8 sm:px-8 lg:px-10">
      <section className="surface-panel rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="brand-button flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-semibold text-white">
            E
          </div>
          <div>
            <p className="text-base font-semibold tracking-[-0.03em] text-white">
              Examora
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
              Dashboard
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
              Workspace
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white">
              Welcome back{user?.displayName ? `, ${user.displayName}` : ""}.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-text-muted)]">
              You are logged in with {user?.email}. This workspace now accepts
              input and shows a generated response preview.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-[var(--color-border)] bg-white/6 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="surface-panel rounded-[2rem] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-text-soft)]">
            Ask Examora
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            What do you want help with?
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-text-muted)]">
            Type a question, paste a topic, or describe exactly how you want the
            material explained.
          </p>

          <div className="mt-5 rounded-[1.5rem] border border-[var(--color-border)] bg-[rgba(2,6,23,0.42)] p-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Example: I don't understand active transport. Explain it in a simpler way with examples."
              className="min-h-36 w-full resize-none bg-transparent text-sm leading-7 text-white outline-none placeholder:text-[var(--color-text-soft)]"
            />

            {formError ? (
              <p className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {formError}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-soft)]">
                <span className="rounded-full border border-[var(--color-border)] px-3 py-1">
                  PDF
                </span>
                <span className="rounded-full border border-[var(--color-border)] px-3 py-1">
                  Topic
                </span>
                <span className="rounded-full border border-[var(--color-border)] px-3 py-1">
                  Outline
                </span>
                <span className="rounded-full border border-[var(--color-border)] px-3 py-1">
                  Text
                </span>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                className="brand-button rounded-full px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.02]"
              >
                Generate response
              </button>
            </div>
          </div>

          <p className="mt-5 font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-text-soft)]">
            Suggested prompts
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {quickActions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => handleQuickAction(action)}
                className="soft-card rounded-2xl px-4 py-4 text-left text-sm font-medium text-white transition hover:-translate-y-1"
              >
                {action}
              </button>
            ))}
          </div>
        </div>

        <div className="surface-panel rounded-[2rem] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-text-soft)]">
            Response
          </p>
          {!result ? (
            <div className="mt-5 rounded-[1.5rem] border border-dashed border-[var(--color-border)] bg-white/4 p-5 text-sm leading-7 text-[var(--color-text-muted)]">
              Submit a topic or question and the response will appear here.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="soft-card rounded-[1.5rem] p-5">
                <h3 className="text-lg font-semibold text-white">{result.heading}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">
                  {result.summary}
                </p>
              </div>

              <div className="soft-card rounded-[1.5rem] p-5">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--color-text-soft)]">
                  Key points
                </p>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--color-text-muted)]">
                  {result.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
