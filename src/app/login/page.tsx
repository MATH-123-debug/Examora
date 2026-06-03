"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  getRedirectResult,
  type UserCredential,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { prepareAuthPersistence } from "@/lib/auth-persistence";
import { auth, db } from "@/lib/firebase";

const GOOGLE_REDIRECT_KEY = "examora-google-redirect";

function shouldUseGoogleRedirect() {
  if (typeof window === "undefined") {
    return false;
  }

  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches;
  const mobileUserAgent =
    /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);

  return Boolean(coarsePointer || mobileUserAgent);
}

function isInAppBrowser() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /FBAN|FBAV|Instagram|WhatsApp|Snapchat|TikTok|Twitter|LinkedInApp|MicroMessenger|Line|Viber/i.test(ua) ||
    (ua.includes("Mobile") && ua.includes("wv"))
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
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
          window.sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
          setIsGoogleLoading(false);
          return;
        }

        window.sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
        await ensureGoogleUserProfile(result);
        router.replace("/dashboard");
      } catch (error) {
        window.sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
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

    if (isInAppBrowser()) {
      setErrorMessage("Google sign-in does not work inside WhatsApp, Instagram, or other in-app browsers. Please open this page in Chrome, Safari, or your default browser and try again.");
      return;
    }

    setIsGoogleLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      await prepareAuthPersistence();

      if (shouldUseGoogleRedirect()) {
        window.sessionStorage.setItem(GOOGLE_REDIRECT_KEY, "pending");
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
      window.sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
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

      if (!normalizedEmail || !normalizedPassword) {
        setErrorMessage("Email and password are required.");
        setIsLoading(false);
        return;
      }

      await prepareAuthPersistence();

      await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        normalizedPassword,
      );
      setErrorMessage("");
      setSuccessMessage("Login successful. Redirecting...");
      setEmail("");
      setPassword("");
      router.replace("/dashboard");
    } catch (error) {
      const message = getAuthErrorMessage(error, "Unable to log in.");
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleForgotPassword() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setErrorMessage("Enter your email first so we can send the reset link.");
      setSuccessMessage("");
      return;
    }

    setIsResetLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setSuccessMessage(
        "Password reset email sent. Check your inbox and spam folder.",
      );
    } catch (error) {
      const message = getAuthErrorMessage(
        error,
        "Unable to send password reset email.",
      );
      setErrorMessage(message);
    } finally {
      setIsResetLoading(false);
    }
  }

  return (
    <main className="grid-surface flex min-h-screen items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-8">
        <section className="order-2 px-1 sm:px-4 lg:order-1">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--color-text-soft)]">
            Examora
          </p>
          <h1 className="mt-5 max-w-lg text-4xl font-semibold leading-tight tracking-[-0.04em] text-white sm:text-5xl">
            Come back to your study flow.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-[var(--color-text-muted)]">
            Continue revising your material, practice exam questions, and keep
            everything in one clean workspace.
          </p>

          <div className="mt-6 space-y-3 sm:mt-8">
            {[
              "Understand hard topics faster",
              "Practice with CBT and theory questions",
              "Keep your study sessions in one place",
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

        <section className="surface-panel order-1 rounded-[1.8rem] p-5 sm:rounded-[2rem] sm:p-8 lg:order-2">
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
              Log in
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">
              Welcome back
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
              Sign in with the account you created to choose between study mode
              and exam mode.
            </p>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--color-text-muted)]">
                  Email address
                </span>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onBlur={(event) => setEmail(event.target.value)}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-blue)]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--color-text-muted)]">
                  Password
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={(event) => setPassword(event.target.value)}
                    required
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 pr-14 text-sm text-white outline-none transition placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-blue)]"
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

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isResetLoading || isLoading || isGoogleLoading}
                  className="text-sm font-medium text-[rgba(191,219,254,1)] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResetLoading ? "Sending reset link..." : "Forgot password?"}
                </button>
              </div>

              {errorMessage ? (
                <p className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMessage}
                </p>
              ) : null}

              {successMessage ? (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  <p>{successMessage}</p>
                  {successMessage.includes("Password reset email sent") ? (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={isResetLoading || isLoading || isGoogleLoading}
                      className="mt-2 font-semibold text-emerald-100 underline-offset-4 transition hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResetLoading ? "Sending again..." : "Didn't receive it? Resend"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isLoading}
                className="brand-button w-full rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70 touch-manipulation"
              >
                {isLoading ? "Logging in..." : "Continue to dashboard"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              className="mt-4 w-full rounded-2xl border border-[var(--color-border)] bg-white/6 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10 touch-manipulation active:opacity-70"
            >
              {isGoogleLoading ? "Opening Google..." : "Continue with Google"}
            </button>

            <p className="mt-6 text-sm text-[var(--color-text-muted)]">
              New here?{" "}
              <Link href="/signup" className="font-semibold text-[rgba(191,219,254,1)]">
                Create an account
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
