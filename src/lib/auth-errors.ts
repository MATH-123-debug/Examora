type AuthErrorMap = Record<string, string>;

const authErrorMessages: AuthErrorMap = {
  "auth/email-already-in-use": "This email is already in use. Try logging in instead.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/user-not-found": "No account was found with that email.",
  "auth/wrong-password": "The password is incorrect.",
  "auth/invalid-credential": "The email or password is incorrect.",
  "auth/weak-password": "Use a stronger password with at least 6 characters.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled before completion.",
  "auth/popup-blocked": "Your browser blocked the Google popup. Allow popups and try again.",
  "auth/network-request-failed": "Network issue detected. Check your internet connection and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
};

export function getAuthErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return authErrorMessages[error.code] ?? fallback;
  }

  return fallback;
}
