"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  type UserCredential,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { prepareAuthPersistence } from "@/lib/auth-persistence";
import { auth, db } from "@/lib/firebase";

function shouldUseGoogleRedirect() {
  if (typeof window === "undefined") {
    return false;
  }

  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
  const mobileUserAgent =
    /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);

  return Boolean(coarsePointer || mobileUserAgent);
}

export default function SignupPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isAuthLoading && user) {
      router.replace("/dashboard");
    }
  }, [isAuthLoading, router, user]);

  useEffect(() => {
    async function handleRedirectResult() {
      try {
        const result = await getRedirectResult(auth);

        if (!result?.user) {
          setIsGoogleLoading(false);
          return;
        }

        await ensureGoogleUserProfile(result);
        router.push("/dashboard");
      } catch (error) {
        const message = getAuthErrorMessage(
          error,
          "Unable to sign in with Google.",
        );
        setErrorMessage(message);
        setIsGoogleLoading(false);
      }
    }

    void handleRedirectResult();
  }, [router]);

  async function ensureGoogleUserProfile(credential: UserCredential) {
    const userRef = doc(db, "users", credential.user.uid);
    const existing = await getDoc(userRef);

    if (!existing.exists()) {
      await setDoc(userRef, {
        uid: credential.user.uid,
        fullName: credential.user.displayName || "",
        email: credential.user.email || "",
        provider: "google",
        createdAt: serverTimestamp(),
      });
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage("");
    setSuccessMessage("");
    setIsGoogleLoading(true);
    const provider = new GoogleAuthProvider();

    try {
      await prepareAuthPersistence();

      if (shouldUseGoogleRedirect()) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const credential = await signInWithPopup(auth, provider);
      await ensureGoogleUserProfile(credential);
      router.push("/dashboard");
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "";

      if (
        code === "auth/popup-blocked" ||
        code === "auth/cancelled-popup-request"
      ) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const message = getAuthErrorMessage(
        error,
        "Unable to sign in with Google.",
      );
      setErrorMessage(message);
      setIsGoogleLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = password.trim();
      const normalizedFullName = fullName.trim();

      await prepareAuthPersistence();

      const credential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        normalizedPassword,
      );

      if (normalizedFullName) {
        await updateProfile(credential.user, {
          displayName: normalizedFullName,
        });
      }

      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        fullName: normalizedFullName || credential.user.displayName || "",
        email: credential.user.email || normalizedEmail,
        provider: "password",
        createdAt: serverTimestamp(),
      });

      setSuccessMessage("Account created successfully. Redirecting...");
      setFullName("");
      setEmail("");
      setPassword("");
      // redirect is handled by the useEffect watching user state
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
    <main className="grid-surface flex min-h-screen items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-8">
        <section className="surface-panel order-1 rounded-[1.8rem] p-5 sm:rounded-[2rem] sm:p-8 lg:order-1">
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
              Start free, then choose whether you want to study in chat mode or
              move straight into exam practice.
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
                  autoCorrect="off"
                  spellCheck={false}
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
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-purple)]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--color-text-muted)]">
                  Password
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 pr-14 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-purple)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-3 my-auto h-9 rounded-full px-3 text-xs font-semibold text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-white"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
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
                className="brand-button w-full rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70 touch-manipulation"
              >
                {isLoading ? "Creating account..." : "Create account"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="mt-4 w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70 touch-manipulation active:opacity-70"
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

        <section className="order-2 px-1 sm:px-4 lg:order-2">
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

          <div className="mt-6 grid gap-3 sm:mt-8">
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
