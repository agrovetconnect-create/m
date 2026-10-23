import { View, Text, ScrollView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertTriangle, CloudOff, ChevronRight, Check } from "lucide-react-native";
import { router } from "expo-router";
import React from "react";
import { C, Card, Press, Btn, IconTile, initialsOf } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

export default function SessionCompleteScreen() {
  const { entries } = useStore();
  const { t } = useI18n();
  const confirmed = entries.filter((e) => e.status === "confirmed");
  const flagged = entries.filter((e) => e.status !== "confirmed");
  const avgConf = entries.length
    ? Math.round(entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length)
    : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "center", marginTop: 30 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.green, alignItems: "center", justifyContent: "center" }}>
            <Check size={36} color="#fff" strokeWidth={3} />
          </View>
          <Text style={{ fontSize: 24, fontWeight: "800", color: C.ink, marginTop: 18 }}>
            {t("sessionComplete")}
          </Text>
          <Text style={{ fontSize: 84, fontWeight: "800", color: C.greenDeep, lineHeight: 100, marginTop: 6 }}>
            {confirmed.length}
          </Text>
          <Text style={{ fontSize: 20, fontWeight: "800", color: C.ink }}>{t("sheetsAccepted")}</Text>
          <Text style={{ fontSize: 14, color: C.sub, marginTop: 8, textAlign: "center" }}>
            {t("avgConf")} {avgConf}%
          </Text>
        </View>

        {flagged.length > 0 ? (
          <Card style={{ backgroundColor: C.amberCard, borderColor: C.amberLine, padding: 16, marginTop: 26 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={20} color={C.amber} />
              <Text style={{ fontSize: 16, fontWeight: "800", color: C.amberText }}>
                {flagged.length} {t("needReview")}
              </Text>
            </View>
            {flagged.slice(0, 3).map((f, i) => (
              <React.Fragment key={f.id}>
                {i > 0 && <View style={{ height: 1, backgroundColor: C.amberLine, marginVertical: 10 }} />}
                <Press
                  onPress={() =>
                    router.push({
                      pathname: "/request-correction",
                      params: {
                        entryId: f.id,
                        mark: String(f.mark),
                        maxMark: String(f.maxMark),
                        studentName: f.studentName,
                        assessment: f.assessment,
                      },
                    })
                  }
                  accessibilityLabel={`${f.studentName} ${t("correctMark")}`}
                  style={{ flexDirection: "row", alignItems: "center", marginTop: i === 0 ? 14 : 0, gap: 12 }}
                >
                  <IconTile size={44} radius={22} bg={C.amberChip}>
                    <Text style={{ color: C.amber, fontWeight: "800" }}>{initialsOf(f.studentName)}</Text>
                  </IconTile>
                  <Text style={{ flex: 1, fontSize: 14.5, color: C.ink }}>
                    {f.studentName} — {f.confidence}% {t("confidence")}
                  </Text>
                  <ChevronRight size={18} color={C.amberText} />
                </Press>
              </React.Fragment>
            ))}
          </Card>
        ) : (
          <Card style={{ backgroundColor: C.greenTint, borderColor: C.greenChip, padding: 16, marginTop: 26 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Check size={20} color={C.green} />
              <Text style={{ fontSize: 16, fontWeight: "800", color: C.green }}>{t("allHighConf")}</Text>
            </View>
          </Card>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 22 }}>
          <CloudOff size={18} color={C.sub} />
          <Text style={{ fontSize: 14, color: C.sub }}>{t("savedDevice")}</Text>
        </View>

        {flagged.length > 0 && (
          <Btn
            label={t("reviewFlagged")}
            onPress={() =>
              router.push({
                pathname: "/request-correction",
                params: {
                  entryId: flagged[0].id,
                  mark: String(flagged[0].mark),
                  maxMark: String(flagged[0].maxMark),
                  studentName: flagged[0].studentName,
                  assessment: flagged[0].assessment,
                },
              })
            }
            style={{ marginTop: 22 }}
          />
        )}
        <Btn label={t("goToMarkSheet")} variant="outline" onPress={() => router.push("/marksheet")} style={{ marginTop: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
