import { Calendar, Smartphone, RefreshCw, ShieldCheck, Settings as SettingsIcon, LogOut, CreditCard, KeyRound, FileText, Trash2 } from "lucide-react-native";
import React from "react";
import { View, Text, ScrollView, StatusBar, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Avatar, StatusPill, ListRow, InfoRow, ScreenHeader, initialsOf, fmtDateTime } from "@/components/ui";
import { useStore } from "@/lib/store";
import * as api from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";

function fmt(iso: string | null, never: string): string {
  return iso ? fmtDateTime(iso) : never;
}

/**
 * Profile screen: the teacher's identity plus account services (plan, password,
 * privacy, data deletion). Preferences and app services (language, sync, vision,
 * help) live in Settings so nothing is duplicated across the two screens.
 */
export default function ProfileScreen() {
  const { session, setSession, settings, setSettings, deviceId, deleteCloudData } = useStore();
  const { t } = useI18n();
  const name = session?.name ?? t("teacher");

  const signOut = async () => {
    if (session) await api.signOut(session.token);
    setSession(null);
    setSettings((s) => ({ ...s, offlineSession: false }));
    router.replace("/login");
  };

  const confirmDelete = () => {
    Alert.alert(t("privacyPolicy"), t("deleteConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteMyData"),
        style: "destructive",
        onPress: () => {
          void deleteCloudData().then((ok) =>
            Alert.alert(
              ok ? t("deleted") : t("deleteError"),
              ok ? t("deletedBody") : t("deleteErrorBody"),
            ),
          );
        },
      },
    ]);
  };

  // Real term info derived from today's date: Sep–Dec → term 1, Jan–Apr → 2,
  // May–Aug → 3, of the academic year (e.g. Oct 2026 → Term 1 · 2026/27).
  const month = new Date().getMonth();
  const termN = month >= 8 ? 1 : month <= 3 ? 2 : 3;
  const startYear = month >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const yearLabel = `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
  const termText = t("termLabel").replace("{n}", String(termN)).replace("{year}", yearLabel);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("profile")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 10, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Avatar text={initialsOf(name) || "T"} size={64} bg={C.greenTint} fontSize={24} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: C.ink }} numberOfLines={1}>
              {name}
            </Text>
            {session?.email ? (
              <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 2 }} numberOfLines={1}>
                {session.email}
              </Text>
            ) : null}
          </View>
          <StatusPill label={session ? t("online") : t("offline")} />
        </View>

        <Card style={{ marginTop: 18, overflow: "hidden" }}>
          <InfoRow icon={<Calendar size={20} color={C.green} />} label={t("currentTerm")} value={termText} />
          <InfoRow icon={<Smartphone size={20} color={C.green} />} label={t("thisDevice")} value={deviceId.slice(0, 14)} />
          <InfoRow icon={<RefreshCw size={20} color={C.green} />} label={t("lastSync")} value={fmt(settings.lastSyncAt, t("never"))} />
          <InfoRow icon={<ShieldCheck size={20} color={C.green} />} label={t("encryption")} value={t("encryptionOn")} last />
        </Card>

        {/* Account services — moved from Settings so account actions live with the account */}
        <Card style={{ marginTop: 12, overflow: "hidden" }}>
          <ListRow icon={<CreditCard size={20} color={C.green} />} label={t("subscription")} value={t("planTrial")} />
          <ListRow icon={<KeyRound size={20} color={C.green} />} label={t("changePassword")} onPress={() => router.push("/reset-password")} />
          <ListRow icon={<FileText size={20} color={C.green} />} label={t("privacyPolicy")} onPress={() => router.push("/privacy-policy")} />
          <ListRow icon={<Trash2 size={20} color={C.red} />} label={t("deleteMyData")} onPress={confirmDelete} danger />
        </Card>

        <Card style={{ marginTop: 12, overflow: "hidden" }}>
          <ListRow icon={<SettingsIcon size={20} color={C.green} />} label={t("settings")} onPress={() => router.push("/settings")} last />
        </Card>

        <Card style={{ marginTop: 12, overflow: "hidden" }}>
          <Press onPress={() => void signOut()} accessibilityLabel={t("signOut")} style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 14 }}>
            <LogOut size={20} color={C.red} />
            <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: C.red }}>{t("signOut")}</Text>
          </Press>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
