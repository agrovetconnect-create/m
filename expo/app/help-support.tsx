import { ChevronDown, ChevronRight, Mail, MessageCircle, BookOpen } from "lucide-react-native";
import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, IconTile, ScreenHeader, SearchField } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function HelpSupportScreen() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(0);
  const [query, setQuery] = useState("");

  const faqs = [
    { q: t("faq1q"), a: t("faq1a") },
    { q: t("faq2q"), a: t("faq2a") },
    { q: t("faq3q"), a: t("faq3a") },
    { q: t("faq4q"), a: t("faq4a") },
  ].filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <ScreenHeader title={t("helpTitle")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <SearchField value={query} onChange={setQuery} label={t("searchHelp")} placeholder={t("searchHelp")} />

        <Card style={{ overflow: "hidden" }}>
          {faqs.map((f, i) => (
            <View key={i} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}>
              <Press onPress={() => setOpen(open === i ? null : i)} accessibilityLabel={f.q}>
                <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 10 }}>
                  <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "700", color: C.ink }}>{f.q}</Text>
                  <ChevronDown
                    size={18}
                    color={C.sub}
                    style={{ transform: [{ rotate: open === i ? "180deg" : "0deg" }] }}
                  />
                </View>
              </Press>
              {open === i && (
                <Text style={{ paddingHorizontal: 16, paddingBottom: 16, fontSize: 14.5, color: C.sub, lineHeight: 21 }}>
                  {f.a}
                </Text>
              )}
            </View>
          ))}
        </Card>

        <Card style={{ overflow: "hidden" }}>
          <Press accessibilityLabel={t("chatSupport")}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 14 }}>
              <IconTile size={44} radius={22} bg={C.greenTint}>
                <MessageCircle size={20} color={C.green} />
              </IconTile>
              <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("chatSupport")}</Text>
              <ChevronRight size={20} color={C.faint} />
            </View>
          </Press>
          <View style={{ height: 1, backgroundColor: C.line }} />
          <Press accessibilityLabel={t("emailAdmin")}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 14 }}>
              <IconTile size={44} radius={22} bg={C.greenTint}>
                <Mail size={20} color={C.green} />
              </IconTile>
              <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("emailAdmin")}</Text>
              <ChevronRight size={20} color={C.faint} />
            </View>
          </Press>
          <View style={{ height: 1, backgroundColor: C.line }} />
          <Press accessibilityLabel={t("teacherGuide")}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 14 }}>
              <IconTile size={44} radius={22} bg={C.greenTint}>
                <BookOpen size={20} color={C.green} />
              </IconTile>
              <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("teacherGuide")}</Text>
              <ChevronRight size={20} color={C.faint} />
            </View>
          </Press>
        </Card>

        <Text style={{ textAlign: "center", fontSize: 13.5, color: C.faint, marginTop: 6 }}>
          {t("version")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
