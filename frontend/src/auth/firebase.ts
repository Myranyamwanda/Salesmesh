/**
 * Firebase Authentication in the browser: the only module that calls Firebase.
 *
 * Firebase proves who someone is (password or Google, verified email,
 * password resets). The backend then exchanges the Firebase ID token for the
 * usual SalesMesh session, so roles and RBAC stay in SalesMesh. Firebase keeps
 * its sign-in in memory only; the SalesMesh refresh cookie is the one
 * long-lived session. Tests mock this module.
 */
import { initializeApp } from "@firebase/app";
import {
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  type Auth,
  type User,
} from "@firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let auth: Auth | null = null;

function firebaseAuth(): Auth {
  if (!Object.values(config).every(Boolean)) {
    throw Object.assign(new Error("Firebase is not configured"), {
      code: "app/not-configured",
    });
  }
  auth ??= initializeAuth(initializeApp(config), {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return auth;
}

/** Where Firebase's emails send people back to after the action. */
function returnTo(path: string) {
  return { url: `${window.location.origin}${path}` };
}

export type FirebaseUser = User;

export function currentFirebaseUser(): FirebaseUser | null {
  return auth?.currentUser ?? null;
}

export async function signInWithPassword(email: string, password: string) {
  return (await signInWithEmailAndPassword(firebaseAuth(), email, password))
    .user;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return (await signInWithPopup(firebaseAuth(), provider)).user;
}

/** Create a password account and send Firebase's verification email. */
export async function signUpWithPassword(email: string, password: string) {
  const { user } = await createUserWithEmailAndPassword(
    firebaseAuth(),
    email,
    password,
  );
  await sendEmailVerification(user, returnTo("/register"));
  return user;
}

export async function resendVerification(user: FirebaseUser) {
  await sendEmailVerification(user, returnTo("/login"));
}

/** Reload the account (after the person clicked the email link). */
export async function refreshVerification(user: FirebaseUser) {
  await reload(user);
  return user.emailVerified;
}

/** A fresh ID token, so a just-verified email is included in its claims. */
export async function idToken(user: FirebaseUser) {
  return user.getIdToken(true);
}

/** Firebase's "set or reset your password" email. */
export async function sendPasswordReset(email: string) {
  await sendPasswordResetEmail(firebaseAuth(), email, returnTo("/login"));
}

/** Check the current password by signing in again, then set the new one. */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await signInWithPassword(email, currentPassword);
  try {
    await updatePassword(user, newPassword);
  } finally {
    await signOutOfFirebase();
  }
}

export async function signOutOfFirebase() {
  if (auth) await signOut(auth);
}

const messages: Record<string, string> = {
  "auth/invalid-credential": "The email or password is not correct.",
  "auth/wrong-password": "The email or password is not correct.",
  "auth/user-not-found": "The email or password is not correct.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/user-disabled":
    "This account cannot sign in. Contact an administrator.",
  "auth/too-many-requests":
    "Too many attempts. Wait a few minutes, then try again.",
  "auth/email-already-in-use":
    "An account already uses this email. Sign in instead.",
  "auth/weak-password": "Choose a stronger password.",
  "auth/password-does-not-meet-requirements": "Choose a stronger password.",
  "auth/account-exists-with-different-credential":
    "This email already signs in with a password. Use your password instead.",
  "auth/popup-blocked":
    "Your browser blocked the Google window. Allow pop-ups and try again.",
  "auth/unauthorized-domain":
    "Sign-in does not work from this address. Open the app at http://localhost:5173.",
  "auth/network-request-failed":
    "Could not reach the sign-in service. Check your connection.",
  "app/not-configured":
    "Sign-in is not configured. Ask the administrator to set up Firebase.",
};

export function firebaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

/** A plain-English message for a Firebase error, or null for a non-Firebase one. */
export function firebaseErrorMessage(error: unknown) {
  const code = firebaseErrorCode(error);
  if (!code.startsWith("auth/") && !code.startsWith("app/")) return null;
  return messages[code] ?? "Sign-in failed. Try again.";
}

/** The person closed the Google window themselves: not an error to show. */
export function wasCancelled(error: unknown) {
  return ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(
    firebaseErrorCode(error),
  );
}
