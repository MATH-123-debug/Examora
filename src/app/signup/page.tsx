"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { auth, db } from "@/lib/firebase";

export default function SignupPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isAuthLoading && user) {
      router.replace("/dashboard");
    }
  }, [isAuthLoading, router, user]);

  async function handleGoogleSignIn() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsGoogleLoading(true);

    try {
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      const userRef = doc(db, "users", credential.user.uid);
      const existingUser = await getDoc(userRef);

      if (!existingUser.exists()) {
        await setDoc(userRef, {
          uid: credential.user.uid,
          fullName: credential.user.displayName || "",
          email: credential.user.email || "",
          provider: "google",
          createdAt: serverTimestamp(),
        });
      }

      router.push("/dashboard");
    } catch (error) {
      const message = getAuthErrorMessage(
        error,
        "Unable to sign in with Google.",
      );
      setErrorMessage(message);
    } finally {
      setIsGoogleLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );

      if (fullName.trim()) {
        await updateProfile(credential.user, {
          displayName: fullName.trim(),
        });
      }

      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        fullName: fullName.trim() || credential.user.displayName || "",
        email: credential.user.email || email,
        provider: "password",
        createdAt: serverTimestamp(),
      });

      setSuccessMessage("Account created successfully. Redirecting...");
      setFullName("");
      setEmail("");
      setPassword("");
      router.push("/dashboard");
    } catch (error) {
      const message = getAuthErrorMessage(
        error,
        "Unable to create account.",
      );
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="grid-surface flex min-h-screen items-center justify-center px-6 py-10">
      <div className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[1.02fr_0.98fr]">
        <section className="surface-panel order-2 rounded-[2rem] p-6 sm:p-8 lg:order-1">
          <div className="mx-auto max-w-md">
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

            <p className="mt-8 font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
              Start for free
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">
              Create your study account
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
              Start free and turn your study materials into explanations,
              revision notes, and practice questions.
            </p>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--color-text-muted)]">
                  Full name
                </span>
                <input
                  type="text"
                  placeholder="Your full name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-purple)]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--color-text-muted)]">
                  Email
                </span>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-purple)]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--color-text-muted)]">
                  Password
                </span>
                <input
                  type="password"
                  placeholder="Create a password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-purple)]"
                />
              </label>

              {errorMessage ? (
                <p className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMessage}
                </p>
              ) : null}

              {successMessage ? (
                <p className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {successMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isLoading}
                className="brand-button w-full rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading ? "Creating account..." : "Create account"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="mt-4 w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isGoogleLoading ? "Opening Google..." : "Continue with Google"}
            </button>

            <p className="mt-6 text-sm text-[var(--color-text-muted)]">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-[rgba(191,219,254,1)]">
                Log in
              </Link>
            </p>
          </div>
        </section>

        <section className="order-1 px-2 sm:px-4 lg:order-2">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
            Why Examora
          </p>
          <h2 className="mt-5 max-w-lg text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
            One study space for notes, practice, and exam confidence.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-[var(--color-text-muted)]">
            Built for students who want a cleaner and faster way to understand
            what matters before exams.
          </p>

          <div className="mt-8 grid gap-3">
            {[
              "Upload PDF, topic, outline, or plain text",
              "Generate summaries, explanations, and revision notes",
              "Practice with both objective and theory questions",
            ].map((item) => (
              <div
                key={item}
                className="soft-card rounded-[1.25rem] px-4 py-3 text-sm text-[var(--color-text-muted)]"
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
