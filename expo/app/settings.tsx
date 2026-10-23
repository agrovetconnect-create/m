import { Globe, ShieldCheck, HelpCircle, RotateCcw, Bell, Camera, ScanText, Link2, KeyRound, Sun } from "lucide-react-native";
import React from "react";
import { View, Text, ScrollView, StatusBar, Switch, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, ListRow, ScreenHeader, Btn } from "@/components/ui";
import { useStore } from "@/lib/store";
import { visionHealth, visionLogin } from "@/lib/cv";
import { useI18n, LANGS } from "@/lib/i18n";

const PROMPT_STEPS = [3, 5, 7, 14];
const RETENTION_STEPS = [30, 90, 180, 365];
const nextIn = (steps: number[], current: number): number => steps[(steps.indexOf(current) + 1) % steps.length] ?? steps[0];

/** Host part of a service URL for the compact row value; falls back to the raw input. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const fieldStyle = {
  borderWidth: 1,
  borderColor: C.line,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  color: C.ink,
} as const;

export default function SettingsScreen() {
  const { settings, setSettings } = useStore();
  const { t } = useI18n();
  const [editingUrl, setEditingUrl] = React.useState<boolean>(false);
  const [urlDraft, setUrlDraft] = React.useState<string>(settings.cvServiceUrl);
  // Vision-service account: real sign-in against the self-hosted server.
  const [showAccount, setShowAccount] = React.useState<boolean>(false);
  const [cvEmailDraft, setCvEmailDraft] = React.useState<string>(settings.cvAuthEmail);
  const [cvPasswordDraft, setCvPasswordDraft] = React.useState<string>("");
  const [cvBusy, setCvBusy] = React.useState<boolean>(false);
  const [cvHealth, setCvHealth] = React.useState<"ok" | "noocr" | "fail" | null>(null);

  const saveUrl = () => {
    const trimmed = urlDraft.trim().replace(/\/+$/, "");
    setSettings((s) => ({ ...s, cvServiceUrl: trimmed }));
    setUrlDraft(trimmed);
    setEditingUrl(false);
  };

  /** Real credential sign-in against the vision service — only the refresh token is stored. */
  const signInVision = async () => {
    const url = settings.cvServiceUrl;
    const email = cvEmailDraft.trim();
    if (!url || !email || !cvPasswordDraft || cvBusy) return;
    setCvBusy(true);
    const tokens = await visionLogin(url, email, cvPasswordDraft);
    setCvBusy(false);
    if (tokens) {
      setSettings((s) => ({ ...s, cvAuthEmail: email, cvRefreshToken: tokens.refreshToken }));
      setCvPasswordDraft("");
      setShowAccount(false);
    } else {
      Alert.alert(t("cvAccount"), t("cvSignInFail"));
    }
  };

  const signOutVision = () => {
    setSettings((s) => ({ ...s, cvAuthEmail: "", cvRefreshToken: "" }));
    setCvHealth(null);
  };

  /** Real reachability probe: GET /vision/health on the configured server. */
  const testVision = async () => {
    if (!settings.cvServiceUrl || cvBusy) return;
    setCvBusy(true);
    const h = await visionHealth(settings.cvServiceUrl);
    setCvBusy(false);
    setCvHealth(h === null ? "fail" : h.ocr ? "ok" : "noocr");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("settings")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* One seamless list — every setting in a single card, no section breaks */}
        <Card style={{ overflow: "hidden" }}>
          <ListRow
            icon={<Globe size={20} color={C.green} />}
            label={t("language")}
            value={LANGS.find((l) => l.code === settings.language)?.label ?? "English"}
            onPress={() => router.push("/language-picker")}
          />
          <ListRow
            icon={<Sun size={20} color={C.green} />}
            label={t("appearance")}
            value={settings.theme === "dark" ? t("themeDark") : settings.theme === "light" ? t("themeLight") : t("themeSystem")}
            onPress={() =>
              setSettings((s) => ({
                ...s,
                theme: s.theme === "system" ? "light" : s.theme === "light" ? "dark" : "system",
              }))
            }
          />
          <ListRow
            icon={<ShieldCheck size={20} color={C.green} />}
            label={t("autoSync")}
            right={
              <Switch
                value={settings.autoSync}
                onValueChange={(v: boolean) => setSettings((s) => ({ ...s, autoSync: v }))}
                trackColor={{ true: C.green, false: C.line }}
                accessibilityLabel={t("autoSync")}
              />
            }
          />
          <ListRow
            icon={<Bell size={20} color={C.green} />}
            label={t("promptLabel")}
            value={t("daysValue").replace("{n}", String(settings.syncPromptDays))}
            onPress={() => setSettings((s) => ({ ...s, syncPromptDays: nextIn(PROMPT_STEPS, s.syncPromptDays) }))}
          />
          <ListRow
            icon={<Camera size={20} color={C.green} />}
            label={t("retentionLabel")}
            value={t("daysValue").replace("{n}", String(settings.retentionDays))}
            onPress={() => setSettings((s) => ({ ...s, retentionDays: nextIn(RETENTION_STEPS, s.retentionDays) }))}
          />

          {/* Vision engine — cloud AI reader or the real CV (OCR) service */}
          <ListRow
            icon={<ScanText size={20} color={C.green} />}
            label={t("visionEngine")}
            value={settings.visionEngine === "cv" ? t("engineCV") : t("engineAI")}
            onPress={() => setSettings((s) => ({ ...s, visionEngine: s.visionEngine === "cv" ? "ai" : "cv" }))}
          />
          <ListRow
            icon={<Link2 size={20} color={C.green} />}
            label={t("cvServiceUrl")}
            value={settings.cvServiceUrl ? hostOf(settings.cvServiceUrl) : t("cvServiceUrlHint")}
            onPress={() => {
              setUrlDraft(settings.cvServiceUrl);
              setEditingUrl((v: boolean) => !v);
            }}
          />
          {editingUrl && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
              <TextInput
                value={urlDraft}
                onChangeText={setUrlDraft}
                placeholder="https://vision.school.edu"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onSubmitEditing={saveUrl}
                accessibilityLabel={t("cvServiceUrl")}
                placeholderTextColor={C.faint}
                style={fieldStyle}
              />
              <Btn label={t("cvUrlSave")} onPress={saveUrl} />
            </View>
          )}
          {/* Vision-service account — real sign-in, sign-out and a real health probe */}
          <ListRow
            icon={<KeyRound size={20} color={C.green} />}
            label={t("cvAccount")}
            value={settings.cvAuthEmail || t("cvAccountNotSignedIn")}
            onPress={() => setShowAccount((v: boolean) => !v)}
          />
          {showAccount && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
              <TextInput
                value={cvEmailDraft}
                onChangeText={setCvEmailDraft}
                placeholder={t("email")}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel={t("email")}
                placeholderTextColor={C.faint}
                style={fieldStyle}
              />
              <TextInput
                value={cvPasswordDraft}
                onChangeText={setCvPasswordDraft}
                placeholder={t("password")}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t("password")}
                placeholderTextColor={C.faint}
                style={fieldStyle}
              />
              {settings.cvRefreshToken ? (
                <Press onPress={signOutVision} accessibilityLabel={t("signOut")} hitSlop={6} style={{ alignItems: "center", paddingVertical: 6 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: C.red }}>{t("signOut")}</Text>
                </Press>
              ) : (
                <Btn label={t("cvSignIn")} onPress={() => void signInVision()} />
              )}
              <Btn label={t("cvTest")} onPress={() => void testVision()} />
              {cvHealth && (
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "700",
                    color: cvHealth === "fail" ? C.red : C.green,
                    textAlign: "center",
                  }}
                >
                  {cvHealth === "ok" ? t("cvTestOk") : cvHealth === "noocr" ? t("cvTestNoOcr") : t("cvTestFail")}
                </Text>
              )}
              <Text style={{ fontSize: 12.5, color: C.faint, lineHeight: 18 }}>{t("cvAccountHint")}</Text>
            </View>
          )}
          <Text style={{ fontSize: 12.5, color: C.faint, paddingHorizontal: 16, paddingBottom: 14, lineHeight: 18 }}>
            {t("cvEngineHint")}
          </Text>

          <ListRow
            icon={<HelpCircle size={20} color={C.green} />}
            label={t("helpSupport")}
            onPress={() => router.push("/help-support")}
          />
          <ListRow
            icon={<RotateCcw size={20} color={C.green} />}
            label={t("replayIntro")}
            onPress={() => router.push("/onboarding")}
          />
        </Card>

        <Text style={{ textAlign: "center", fontSize: 13.5, color: C.faint }}>{t("version")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
