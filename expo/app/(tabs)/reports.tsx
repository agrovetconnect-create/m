import { Pencil, Camera, Lock, TrendingUp, TrendingDown, Award } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C, Card, Chip, StatusPill, IconTile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Generated empty-state art: empty report chart (transparent bg). */
const REPORTS_ART = "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/6617413f-dacd-475f-93c0-ee29d504b500.png";

/**
 * Spec trim: the reports tab shows the class average plus the top and
 * lowest scorer — computed from real signed entries in the store.
 */
export default function ReportsScreen() {
  const { entries, classList } = useStore();
  const { t } = useI18n();
  const [cls, setCls] = useState("");
  // Resolve to a real class; the picker state may briefly hold a stale id.
  const activeCls = classList.some((c) => c.id === cls) ? cls : (classList[0]?.id ?? "");

  const clsEntries = useMemo(() => entries.filter((e) => e.classId === activeCls), [entries, activeCls]);

  const pct = (e: { mark: number; maxMark: number }) => Math.round((e.mark / Math.max(1, e.maxMark)) * 100);
  const avg = clsEntries.length
    ? Math.round(clsEntries.reduce((s, e) => s + pct(e), 0) / clsEntries.length)
    : null;
  const top = clsEntries.length ? clsEntries.reduce((a, b) => (pct(b) > pct(a) ? b : a)) : null;
  const lowest = clsEntries.length ? clsEntries.reduce((a, b) => (pct(b) < pct(a) ? b : a)) : null;

  const recent = entries.slice(0, 4);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: 110, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: C.ink, paddingHorizontal: 20, paddingTop: 16 }}>
          {t("termReports")}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 16 }}
        >
          {classList.map((c) => (
            <Chip key={c.id} label={c.grade || c.name} active={activeCls === c.id} onPress={() => setCls(c.id)} />
          ))}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          {clsEntries.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 80 }}>
              <Image source={{ uri: REPORTS_ART }} style={{ width: 220, height: 220 }} resizeMode="contain" />
              <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22, paddingHorizontal: 24 }}>
                {t("noData")}
              </Text>
            </View>
          ) : (
            <>
              <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}>
                <IconTile size={52} radius={16} bg={C.greenTint}>
                  <Award size={24} color={C.green} />
                </IconTile>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, color: C.sub }}>{t("classAvg")}</Text>
                  <Text style={{ fontSize: 34, fontWeight: "800", color: C.greenDeep }}>
                    {avg}%
                  </Text>
                  <Text style={{ fontSize: 13, color: C.faint }}>
                    {clsEntries.length} {clsEntries.length === 1 ? t("student") : t("students")}
                  </Text>
                </View>
              </Card>

              {top && (
                <Card style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <IconTile size={44} radius={22} bg={C.greenTint}>
                    <TrendingUp size={20} color={C.green} />
                  </IconTile>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, color: C.sub }}>{t("topScorer")}</Text>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: C.ink }}>{top.studentName}</Text>
                  </View>
                  <Text style={{ fontSize: 17, fontWeight: "800", color: C.green }}>{pct(top)}%</Text>
                </Card>
              )}

              {lowest && (
                <Card style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <IconTile size={44} radius={22} bg={C.yellowTint}>
                    <TrendingDown size={20} color={C.amber} />
                  </IconTile>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, color: C.sub }}>{t("lowestScore")}</Text>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: C.ink }}>{lowest.studentName}</Text>
                  </View>
                  <Text style={{ fontSize: 17, fontWeight: "800", color: C.amberText }}>{pct(lowest)}%</Text>
                </Card>
              )}
            </>
          )}

          {recent.length > 0 && (
            <Card style={{ overflow: "hidden" }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
                <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>{t("recentActivity")}</Text>
              </View>
              {recent.map((a, i) => (
                <View
                  key={a.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 16,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: C.line,
                  }}
                >
                  <IconTile size={44} radius={22} bg={a.source === "ai" || a.source === "cv" ? C.greenTint : C.rowGrey}>
                    {a.source === "ai" || a.source === "cv" ? (
                      <Camera size={20} color={C.green} />
                    ) : (
                      <Pencil size={20} color={C.green} />
                    )}
                  </IconTile>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: "700", color: C.ink }}>
                      {a.studentName} · {a.assessment}
                    </Text>
                    <Text style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
                      {a.mark}/{a.maxMark} · {a.classId}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 5 }}>
                    <Text style={{ fontSize: 12.5, color: C.sub }}>
                      {new Date(a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </Text>
                    <StatusPill label={t("locked")} icon={<Lock size={11} color={C.green} />} />
                  </View>
                </View>
              ))}
            </Card>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
