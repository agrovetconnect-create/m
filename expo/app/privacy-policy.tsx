import React from "react";
import { View, Text, ScrollView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { FileText } from "lucide-react-native";
import { C, Card, Btn, ScreenHeader } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/**
 * In-app privacy policy: what data the app handles, how it is stored,
 * who sees it, retention, and the teacher's controls. Links to the
 * data-consent screen for the actual deletion action.
 */
export default function PrivacyPolicyScreen() {
  const { t } = useI18n();

  const sections = [
    { title: t("ppDataTitle"), body: t("ppDataBody") },
    { title: t("ppStorageTitle"), body: t("ppStorageBody") },
    { title: t("ppSharingTitle"), body: t("ppSharingBody") },
    { title: t("ppRetentionTitle"), body: t("ppRetentionBody") },
    { title: t("ppRightsTitle"), body: t("ppRightsBody") },
    { title: t("ppContactTitle"), body: t("ppContactBody") },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("privacyPolicy")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <FileText size={22} color={C.green} />
          <Text style={{ flex: 1, fontSize: 13, color: C.faint }}>
            {t("ppUpdated")}: 2026-09
          </Text>
        </View>

        <Card style={{ padding: 16 }}>
          <Text style={{ fontSize: 15, lineHeight: 22, color: C.ink }}>{t("ppIntro")}</Text>
        </Card>

        {sections.map((s) => (
          <Card key={s.title} style={{ padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: C.ink, marginBottom: 6 }}>{s.title}</Text>
            <Text style={{ fontSize: 14.5, lineHeight: 22, color: C.sub }}>{s.body}</Text>
          </Card>
        ))}

        <Btn label={t("deleteMyData")} onPress={() => router.push("/data-consent")} style={{ height: 50, marginTop: 4 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
