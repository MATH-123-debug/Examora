import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export type AuthPersistenceMode = "local" | "session" | "memory";

export async function prepareAuthPersistence(): Promise<AuthPersistenceMode> {
  try {
    await setPersistence(auth, browserLocalPersistence);
    return "local";
  } catch {
    // Fall back when local storage is restricted on a device/browser.
  }

  try {
    await setPersistence(auth, browserSessionPersistence);
    return "session";
  } catch {
    // Final fallback for very restrictive browsers.
  }

  await setPersistence(auth, inMemoryPersistence);
  return "memory";
}
