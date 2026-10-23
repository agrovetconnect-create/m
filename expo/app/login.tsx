import { Mail, Lock, WifiOff, ShieldCheck, User } from "lucide-react-native";
import React, { useState } from "react";
import { View, Text, ScrollView, StatusBar, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { C, Press } from "@/components/ui";
import { useStore } from "@/lib/store";
import * as api from "@/lib/supabase";
import { trackEvent, trackError } from "@/lib/observability";
import { useI18n } from "@/lib/i18n";

/**
 * Login / sign-up (mockup pass): mint stage, teal accent headline, one white
 * card with segmented Login | Sign up tabs, and real Apple / Google OAuth —
 * both through Supabase providers, with the official brand icons.
 */
const MINT = "#DCF4F0";
const TEAL = "#16B8A8";
const TEAL_INK = "#0E3B35";
const FIELD_LINE = "#DCEFEA";
const FIELD_BG = "#FBFEFD";
const MUTED = "#6E8B85";

/** Official multicolor Google "G". */
function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  );
}

/** Apple logo (white, for the dark OAuth button). */
function AppleIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 384 512">
      <Path
        fill="#FFFFFF"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.7-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </Svg>
  );
}

export default function LoginScreen() {
  const { settings, setSettings, setSession } = useStore();
  const { t } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [rememberMe, setRememberMe] = useState<boolean>(settings.rememberMe);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /** Client-side credential checks before anything hits the network. */
  const validate = (): string | null => {
    if (!EMAIL_RE.test(email.trim())) return t("invalidEmail");
    if (password.length < 8) return t("weakPassword");
    return null;
  };

  const doSignIn = async () => {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    const res = await api.signIn(email.trim(), password);
    setBusy(false);
    if (res.error || !res.session) {
      setError(res.error ?? "Sign in failed");
      return;
    }
    setSettings((s) => ({ ...s, rememberMe, offlineSession: false }));
    setSession(res.session);
    trackEvent("signin", { method: "password" });
    router.push("/data-consent");
  };

  const doSignUp = async () => {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    const res = await api.signUp(email.trim(), password, name.trim() || undefined);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    trackEvent("signup", { method: "password" });
    Alert.alert(t("signupOk"), t("signupOkBody"), [{ text: t("ok"), onPress: () => setMode("signin") }]);
  };

  /** Real OAuth: Apple and Google both go through Supabase providers. */
  const doOAuth = async (provider: "google" | "apple") => {
    const label = provider === "google" ? "Google sign-in" : "Apple sign-in";
    try {
      const res = await WebBrowser.openAuthSessionAsync(api.oauthUrl(provider), "northgate://");
      if (res.type !== "success") return;
      // Deep-link sessions carry tokens in the URL fragment.
      const url = res.url;
      const token = url.match(/access_token=([^&]+)/)?.[1];
      const refreshToken = url.match(/refresh_token=([^&]+)/)?.[1];
      if (token) {
        // Never trust tokens straight from a URL: verify them and pull the
        // real account before a session is created.
        const user = await api.getUser(token);
        if (!user) {
          Alert.alert(label, "Could not verify the session — try again.");
          return;
        }
        setSettings((s) => ({ ...s, offlineSession: false }));
        setSession({ token, refreshToken, email: user.email, name: user.name });
        trackEvent("signin", { method: provider });
        router.push("/data-consent");
      } else {
        Alert.alert(
          label,
          `Enable the ${provider === "google" ? "Google" : "Apple"} provider on the Supabase project (Authentication → Providers).`,
        );
      }
    } catch {
      Alert.alert(label, "Could not open the sign-in window.");
    }
  };

  const workOffline = () => {
    setSettings((s) => ({ ...s, rememberMe, offlineSession: true }));
    router.push("/data-consent");
  };

  const submit = mode === "signin" ? doSignIn : doSignUp;

  const field = (icon: React.ReactNode, input: React.ReactNode) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1.2,
        borderColor: FIELD_LINE,
        borderRadius: 14,
        paddingHorizontal: 14,
        height: 54,
        backgroundColor: FIELD_BG,
      }}
    >
      {icon}
      {input}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: MINT }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ marginTop: 38 }}>
          <Text style={{ fontSize: 27, fontWeight: "800", color: TEAL, lineHeight: 35 }}>
            {mode === "signin" ? t("signIn") : t("createAccount")}
          </Text>
          <Text style={{ fontSize: 27, fontWeight: "800", color: TEAL_INK, lineHeight: 35 }}>
            {mode === "signin" ? t("loginHeadlineRest") : t("signupHeadlineRest")}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 26,
            padding: 18,
            marginTop: 22,
            shadowColor: TEAL_INK,
            shadowOpacity: 0.08,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 4,
          }}
        >
          {/* Segmented Login | Sign up switcher */}
          <View style={{ flexDirection: "row", backgroundColor: "#EFF8F6", borderRadius: 14, padding: 4 }}>
            {(["signin", "signup"] as const).map((m) => (
              <Press
                key={m}
                onPress={() => {
                  setMode(m);
                  setError("");
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: mode === m ? TEAL : "transparent",
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: mode === m ? "#fff" : MUTED }}>
                  {m === "signin" ? t("signIn") : t("createAccount")}
                </Text>
              </Press>
            ))}
          </View>

          {mode === "signup" && (
            <View style={{ marginTop: 16 }}>
              {field(
                <User size={20} color={MUTED} />,
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={t("fullName")}
                  placeholderTextColor={C.faint}
                  style={{ flex: 1, marginLeft: 12, fontSize: 16, color: C.ink }}
                  accessible
                  accessibilityLabel={t("fullName")}
                />,
              )}
            </View>
          )}

          <View style={{ marginTop: mode === "signup" ? 12 : 16 }}>
            {field(
              <Mail size={20} color={MUTED} />,
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder={t("email")}
                placeholderTextColor={C.faint}
                style={{ flex: 1, marginLeft: 12, fontSize: 16, color: C.ink }}
                accessible
                accessibilityLabel={t("email")}
              />,
            )}
          </View>

          <View style={{ marginTop: 12 }}>
            {field(
              <Lock size={20} color={MUTED} />,
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={t("password")}
                placeholderTextColor={C.faint}
                style={{ flex: 1, marginLeft: 12, fontSize: 16, color: C.ink, letterSpacing: 1 }}
                accessible
                accessibilityLabel={t("password")}
              />,
            )}
          </View>

          {mode === "signin" && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
              <Press
                onPress={() => setRememberMe(!rememberMe)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberMe }}
                accessibilityLabel={t("rememberMe")}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: rememberMe ? TEAL : C.borderOff,
                    backgroundColor: rememberMe ? TEAL : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {rememberMe && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>✓</Text>}
                </View>
                <Text style={{ fontSize: 14.5, color: C.ink }}>{t("rememberMe")}</Text>
              </Press>
              <Press onPress={() => router.push("/reset-password")} accessibilityLabel={t("forgotPassword")}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: TEAL }}>{t("forgotPassword")}</Text>
              </Press>
            </View>
          )}

          {error !== "" && (
            <Text style={{ fontSize: 14, color: C.red, marginTop: 12, fontWeight: "600" }} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          <Press
            onPress={() => void submit()}
            disabled={busy}
            accessibilityLabel={mode === "signin" ? t("signIn") : t("createAccount")}
            style={{
              marginTop: 20,
              height: 56,
              borderRadius: 16,
              backgroundColor: TEAL,
              alignItems: "center",
              justifyContent: "center",
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16.5, fontWeight: "700" }}>
              {busy ? "…" : mode === "signin" ? t("signIn") : t("createAccount")}
            </Text>
          </Press>
        </View>

        {/* Real OAuth buttons: Apple + Google through Supabase providers */}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
          <Press
            onPress={() => void doOAuth("apple")}
            accessibilityLabel="Apple sign-in"
            style={{
              flex: 1,
              height: 56,
              borderRadius: 16,
              backgroundColor: "#102A25",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <AppleIcon />
            <Text style={{ color: "#fff", fontSize: 14.5, fontWeight: "700" }}>Apple</Text>
          </Press>
          <Press
            onPress={() => void doOAuth("google")}
            accessibilityLabel={t("continueGoogle")}
            style={{
              flex: 1,
              height: 56,
              borderRadius: 16,
              backgroundColor: "#fff",
              borderWidth: 1.4,
              borderColor: FIELD_LINE,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <GoogleIcon />
            <Text style={{ color: TEAL_INK, fontSize: 14.5, fontWeight: "700" }}>Google</Text>
          </Press>
        </View>

        <Press
          onPress={workOffline}
          accessibilityLabel={t("workOffline")}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 }}
        >
          <WifiOff size={17} color={MUTED} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: MUTED }}>{t("workOffline")}</Text>
        </Press>

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 22 }}>
          <ShieldCheck size={17} color={MUTED} />
          <Text style={{ fontSize: 13, color: MUTED }}>{t("footerLogin")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
