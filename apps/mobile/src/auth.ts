import "./auth-crypto";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { createClient, processLock } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { chunkedSecretStorage, memorySecretStorage } from "./auth-storage";
import { validateConnection } from "./auth-connection";
import type { MobileConnection } from "./auth-connection";

export type { MobileConnection } from "./auth-connection";

// The browser phone preview deliberately forgets credentials on reload.
const storage =
  Platform.OS === "web"
    ? memorySecretStorage()
    : chunkedSecretStorage({
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) =>
          SecureStore.setItemAsync(key, value, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        removeItem: (key) => SecureStore.deleteItemAsync(key),
      });
const connectionKey = "grove.mobile.connection";
const accountKey = "grove.mobile.account";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const captchaUrl = process.env.EXPO_PUBLIC_CAPTCHA_URL;
export const accounts: SupabaseClient | undefined =
  url && anon
    ? createClient(url, anon, {
        auth: {
          storage,
          storageKey: accountKey,
          flowType: "pkce",
          persistSession: true,
          detectSessionInUrl: false,
          autoRefreshToken: true,
          lock: processLock,
        },
      })
    : undefined;

WebBrowser.maybeCompleteAuthSession();
if (accounts && Platform.OS !== "web") {
  const client = accounts;
  AppState.addEventListener("change", (state) => {
    if (state === "active") void client.auth.startAutoRefresh();
    else void client.auth.stopAutoRefresh();
  });
}

function account(): SupabaseClient {
  if (!accounts)
    throw new Error(
      "Account sign-in is not configured in this app. Use a GitHub repository token.",
    );
  return accounts;
}
function cloud(session: Session): MobileConnection {
  return validateConnection({
    kind: "cloud",
    userId: session.user.id,
    email: session.user.email ?? "",
  });
}
export async function loadConnection(): Promise<MobileConnection | undefined> {
  const raw = await storage.getItem(connectionKey);
  if (raw === null) return;
  const connection = validateConnection(JSON.parse(raw));
  if (connection.kind === "cloud") {
    const { data, error } = await account().auth.getSession();
    if (error) throw error;
    if (!data.session) return;
    if (data.session.user.id !== connection.userId)
      throw new Error("Sign in to the Grove account that owns this vault.");
    return cloud(data.session);
  }
  return connection;
}
export async function saveConnection(connection: MobileConnection): Promise<void> {
  const validated = validateConnection(connection);
  if (validated.kind === "cloud") {
    const { data, error } = await account().auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== validated.userId)
      throw new Error("Sign in to this Grove account before saving its vault connection.");
  }
  await storage.setItem(connectionKey, JSON.stringify(validated));
}
export async function forgetConnection(): Promise<void> {
  // Local sign-out keeps other devices signed in. Secure deletion errors stay visible.
  let providerError: unknown;
  if (accounts) {
    try {
      const { error } = await accounts.auth.signOut({ scope: "local" });
      providerError = error ?? undefined;
    } catch (error) {
      providerError = error;
    }
  }
  // Remove local secrets even when online revocation or one deletion fails.
  const indexKey = `${accountKey}-flows-code-verifier`;
  const keys = [accountKey, `${accountKey}-code-verifier`, connectionKey];
  let deletionError: unknown;
  try {
    const raw = await storage.getItem(indexKey);
    if (raw !== null) {
      const index: unknown = JSON.parse(raw);
      if (!Array.isArray(index)) throw new Error("Saved sign-in state is damaged.");
      for (const flowId of index)
        if (typeof flowId === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(flowId))
          keys.push(`${accountKey}-flow-${flowId}-code-verifier`);
    }
  } catch (error) {
    deletionError = error;
  }
  for (const key of keys) {
    try {
      await storage.removeItem(key);
    } catch (error) {
      deletionError ??= error;
    }
  }
  // Keep the index after a partial deletion so sign-out can retry every flow.
  if (!deletionError) await storage.removeItem(indexKey);
  if (deletionError) throw deletionError;
  if (providerError)
    throw new Error(
      "Device credentials were removed. Account session revocation failed. Reconnect when online.",
    );
}
export async function signInEmail(
  email: string,
  password: string,
  create = false,
  captchaToken?: string,
): Promise<MobileConnection | undefined> {
  const client = account();
  const { data, error } = create
    ? await client.auth.signUp({
        email: email.trim(),
        password,
        options: { captchaToken },
      })
    : await client.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken },
      });
  // CAPTCHA requirements are provider policy. Surface the error; never disable protection.
  if (error) throw error;
  return data.session ? cloud(data.session) : undefined;
}

let signingIn = false;
export async function signInGitHub(): Promise<MobileConnection> {
  if (signingIn) throw new Error("GitHub sign-in is already open. Finish or cancel it first.");
  signingIn = true;
  try {
    const client = account();
    const redirectTo = AuthSession.makeRedirectUri({
      scheme: "grove",
      path: "auth/callback",
    });
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error("GitHub sign-in did not return an authorization URL.");
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success") throw new Error("GitHub sign-in was cancelled.");
    const callback = new URL(result.url),
      expected = new URL(redirectTo);
    if (
      callback.protocol !== expected.protocol ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname
    )
      throw new Error("GitHub sign-in returned an unexpected callback.");
    if (
      callback.searchParams.has("error") ||
      new URLSearchParams(callback.hash.slice(1)).has("error")
    )
      throw new Error("GitHub sign-in failed. Try again.");
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("GitHub sign-in did not return a confirmation code.");
    const exchanged = await client.auth.exchangeCodeForSession(
      code,
      data.flowId ? { flowId: data.flowId } : undefined,
    );
    if (exchanged.error) throw exchanged.error;
    if (!exchanged.data.session)
      throw new Error("GitHub sign-in did not create an account session.");
    // Grove account sign-in grants cloud access. Repository tokens are a separate connection.
    return cloud(exchanged.data.session);
  } finally {
    signingIn = false;
  }
}
/** Recovery stays in one system browser so its PKCE verifier never crosses devices. */
export async function resetPassword(_email: string): Promise<"browser"> {
  const redirectTo = process.env.EXPO_PUBLIC_PASSWORD_RESET_URL;
  if (!redirectTo)
    throw new Error(
      "Password reset is not configured. Set the HTTPS Grove account recovery page URL.",
    );
  const target = new URL(redirectTo);
  if (target.protocol !== "https:" || target.username || target.password)
    throw new Error("Password reset requires a secure account website URL.");
  // Request and complete recovery on this website. Never place email or tokens in its URL.
  await WebBrowser.openBrowserAsync(target.href);
  return "browser";
}
