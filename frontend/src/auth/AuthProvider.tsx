import { useEffect, useState, type PropsWithChildren } from "react";
import * as authApi from "../api/auth";
import { authEvents, refreshAccessToken, setAccessToken } from "../api/client";
import { AuthContext } from "./context";
import type { AuthUser } from "../types/auth";

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const onExpired = () => setUser(null);
    const onToken = (event: Event) => {
      if ((event as CustomEvent<string | null>).detail === null) setUser(null);
    };
    window.addEventListener(authEvents.expired, onExpired);
    window.addEventListener(authEvents.token, onToken);
    void refreshAccessToken()
      .then(() => authApi.getMe())
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {
        if (active) {
          setAccessToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener(authEvents.expired, onExpired);
      window.removeEventListener(authEvents.token, onToken);
    };
  }, []);

  async function startSession(accessToken: string) {
    setAccessToken(accessToken);
    try {
      const current = await authApi.getMe();
      setUser(current);
      return current;
    } catch (error) {
      setAccessToken(null);
      setUser(null);
      throw error;
    }
  }

  async function legacyLogin(email: string, password: string) {
    const tokens = await authApi.legacyLogin(email, password);
    return startSession(tokens.access_token);
  }

  async function signOut() {
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }

  async function signOutAll() {
    try {
      await authApi.logoutAll();
    } finally {
      clearSession();
    }
  }

  function clearSession() {
    setAccessToken(null);
    setUser(null);
    // Loaded on demand so public pages such as /join never download Firebase.
    void import("./firebase")
      .then(({ signOutOfFirebase }) => signOutOfFirebase())
      .catch(() => undefined);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        startSession,
        legacyLogin,
        logout: signOut,
        logoutAll: signOutAll,
        clearSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
