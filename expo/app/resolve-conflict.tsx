import { User } from "lucide-react-native";
import React, { useState } from "react";
import { View, Text, ScrollView, StatusBar, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Btn, ScreenHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Real conflict records flagged by the sync engine — keep mine (force-push) or take the server version. */
export default function ResolveConflictScreen() {
  const { conflicts, resolveConflict } = useStore();
  const { t } = useI18n();
  const [sel, setSel] = useState<"mine" | "server">("mine");
  const [busy, setBusy] = useState(false);
  const conflict = conflicts[0];

  const apply = async () => {
    if (!conflict) return;
    setBusy(true);
    const ok = await resolveConflict(conflict.id, sel);
    setBusy(false);
    if (ok) {
      Alert.alert(t("resolvedTitle"), t("resolvedBody"), [{ text: t("ok"), onPress: () => router.back() }]);
    }
  };

  const pct = (mark: number, max: number) => Math.round((mark / Math.max(1, max)) * 100);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("resolveConflict")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
        {!conflict ? (
          <Card style={{ padding: 24, alignItems: "center", marginTop: 20 }}>
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22 }}>
              {t("notifEmpty")}
            </Text>
          </Card>
        ) : (
          <>
            <Text style={{ fontSize: 28, fontWeight: "800", color: C.ink, marginTop: 12 }}>
              {t("resolveConflict")}
            </Text>
            <Text style={{ fontSize: 15, color: C.sub, marginTop: 8 }}>
              {conflict.assessment} · {conflict.studentName} {t("changedOffline")}
            </Text>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 22 }}>
              <Card style={{ flex: 1, padding: 16, backgroundColor: C.greenSoft, borderColor: C.greenBorder }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: C.green }}>{t("yourEdit")}</Text>
                <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>
                  {new Date(conflict.localAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <View style={{ height: 1, backgroundColor: C.greenBorder, marginVertical: 18 }} />
                <Text style={{ fontSize: 52, fontWeight: "800", color: C.greenDeep, lineHeight: 60 }}>
                  {pct(conflict.localMark, conflict.localMax)}
                  <Text style={{ fontSize: 26, fontWeight: "700" }}>%</Text>
                </Text>
              </Card>
              <Card style={{ flex: 1, padding: 16 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }}>{t("onServer")}</Text>
                <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>
                  {conflict.serverAt
                    ? new Date(conflict.serverAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </Text>
                <Text style={{ fontSize: 52, fontWeight: "800", color: C.ink, lineHeight: 60, marginTop: 18 }}>
                  {conflict.serverMark !== null ? pct(conflict.serverMark, conflict.localMax) : "—"}
                  <Text style={{ fontSize: 26, fontWeight: "700" }}>%</Text>
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: C.chipGrey,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <User size={16} color={C.sub} />
                  </View>
                  <Text style={{ fontSize: 14.5, fontWeight: "600", color: C.ink }}>
                    {conflict.serverMark !== null ? `${conflict.serverMark}/${conflict.localMax}` : "—"}
                  </Text>
                </View>
              </Card>
            </View>

            <Card style={{ marginTop: 16, paddingVertical: 4 }}>
              {(["mine", "server"] as const).map((key, i) => (
                <Press
                  key={key}
                  onPress={() => setSel(key)}
                  accessibilityLabel={t(key === "mine" ? "keepMine" : "keepServer")}
                  accessibilityState={sel === key ? { selected: true } : undefined}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 16,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: C.line,
                      gap: 14,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor: sel === key ? C.ink : C.borderOff,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {sel === key && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.ink }} />}
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 15.5,
                        fontWeight: sel === key ? "700" : "500",
                        color: sel === key ? C.ink : C.sub,
                      }}
                    >
                      {t(key === "mine" ? "keepMine" : "keepServer")}
                    </Text>
                  </View>
                </Press>
              ))}
            </Card>

            <Btn label={t("applyChoice")} onPress={() => void apply()} disabled={busy} style={{ marginTop: 24 }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
