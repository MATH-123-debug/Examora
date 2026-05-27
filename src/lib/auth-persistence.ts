import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export async function prepareAuthPersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    return;
  } catch {
    // Fall back when local storage is restricted on a device/browser.
  }

  try {
    await setPersistence(auth, browserSessionPersistence);
    return;
  } catch {
    // Final fallback for very restrictive browsers.
  }

  await setPersistence(auth, inMemoryPersistence);
}
