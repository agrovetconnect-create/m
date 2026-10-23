import { ArrowLeft, HelpCircle, Mail, RotateCcw } from "lucide-react-native";
import React, { useState } from "react";
import { View, Text, ScrollView, StatusBar, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Btn, ScreenHeader, Illu } from "@/components/ui";
import * as api from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";

/**
 * Real password reset: sends the Supabase recovery email for the entered
 * address, then offers resend — no fake pre-filled inbox screen.
 */
export default function ResetPasswordScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      Alert.alert(t("resetTitle"), t("invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ""}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(res.ok);
      if (res.ok) {
        Alert.alert(t("resetSentTitle"), t("resetSentBody").replace("{email}", email.trim()));
      } else {
        Alert.alert(t("resetTitle"), t("emailNotRecognized"));
      }
    } catch {
      Alert.alert(t("resetTitle"), t("emailNotRecognized"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("resetTitle")} onBack={() => router.back()} accessibilityLabel={t("backToSignIn")} />

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} showsVerticalScrollIndicator={false}>
        <Card style={{ padding: 20 }}>
          <Text style={{ fontSize: 16.5, fontWeight: "600", color: C.ink, lineHeight: 23 }}>{t("resetBody")}</Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1.6,
              borderColor: C.green,
              borderRadius: 14,
              paddingHorizontal: 14,
              height: 60,
              marginTop: 18,
              backgroundColor: "#fff",
              gap: 10,
            }}
          >
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@school.edu"
              placeholderTextColor={C.faint}
              style={{ flex: 1, fontSize: 16.5, color: C.ink }}
              accessibilityLabel={t("email")}
            />
            <View style={{ width: 1.5, height: 22, backgroundColor: C.green }} />
          </View>
          <Btn label={busy ? "…" : t("sendResetLink")} onPress={() => void send()} disabled={busy} style={{ marginTop: 20 }} />
        </Card>

        <Card style={{ padding: 18, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <HelpCircle size={22} color={C.sub} />
          <Text style={{ flex: 1, fontSize: 14.5, color: C.sub }}>{t("emailNotRecognized")}</Text>
        </Card>

        {sent && (
          <Card style={{ padding: 20, marginTop: 6 }}>
            <View style={{ alignItems: "center" }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.greenTint, alignItems: "center", justifyContent: "center" }}>
                <Mail size={30} color={C.green} strokeWidth={1.8} />
              </View>
              <Text style={{ fontSize: 20, fontWeight: "800", color: C.ink, marginTop: 14 }}>{t("resetSentTitle")}</Text>
              <Text style={{ fontSize: 14, color: C.sub, marginTop: 6, textAlign: "center" }}>
                {t("resetSentBody").replace("{email}", email.trim())}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: C.line, marginVertical: 16 }} />
            <Press onPress={() => void send()} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <RotateCcw size={20} color={C.ink} />
              <Text style={{ fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("resendLink")}</Text>
            </Press>
            <View style={{ height: 1, backgroundColor: C.line, marginVertical: 8 }} />
            <Press onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <ArrowLeft size={20} color={C.ink} />
              <Text style={{ fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("backToSignIn")}</Text>
            </Press>
          </Card>
        )}

        <Illu name="resetPassword" />
      </ScrollView>
    </SafeAreaView>
  );
}
