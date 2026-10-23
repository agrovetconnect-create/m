import { ArrowLeft, Lock, Pencil, Upload, ChevronRight, ClipboardList } from "lucide-react-native";
import React, { useMemo } from "react";
import { View, Text, ScrollView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { C, Card, Press, StatusPill, IconTile } from "@/components/ui";
import { shareCsv } from "@/lib/share";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Real per-student record: entries, term average, full signed version history, CSV export. */
export default function StudentHistoryScreen() {
  const { entries } = useStore();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ studentName?: string }>();
  const studentName = params.studentName ?? "";

  const studentEntries = useMemo(
    () => entries.filter((e) => e.studentName.toLowerCase() === studentName.toLowerCase()),
    [entries, studentName],
  );

  const pct = (mark: number, maxMark: number) => Math.round((mark / Math.max(1, maxMark)) * 100);
  const avg = studentEntries.length
    ? Math.round(studentEntries.reduce((s, e) => s + pct(e.mark, e.maxMark), 0) / studentEntries.length)
    : null;

  const corrections = studentEntries.flatMap((e) =>
    e.versions.slice(1).map((v, i) => ({ entry: e, v, n: i + 2 })),
  );

  const exportCsv = () => {
    void shareCsv(
      "student,assessment,class,mark,max,source,status,versions,date",
      studentEntries.map((e) => [
        studentName,
        e.assessment,
        e.classId,
        e.mark,
        e.maxMark,
        e.source,
        e.status,
        e.versions.length,
        e.createdAt,
      ]),
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={{ backgroundColor: C.greenDeep, paddingHorizontal: 20, paddingBottom: 22 }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: C.greenDeep }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 8 }}>
            <Press onPress={() => router.back()} accessibilityLabel={t("cancel")}>
              <ArrowLeft size={24} color="#fff" strokeWidth={2.4} />
            </Press>
            <Text style={{ fontSize: 19, fontWeight: "700", color: C.headerText, marginLeft: 16 }}>
              {t("studentHistory")}
            </Text>
          </View>
          <Text style={{ fontSize: 32, fontWeight: "800", color: "#fff", marginTop: 18, marginLeft: 40 }} numberOfLines={1}>
            {studentName}
          </Text>
          <Text style={{ fontSize: 16, color: C.headerSub, marginTop: 6, marginLeft: 40 }}>
            {studentEntries[0]?.classId ?? "—"}
          </Text>
          {avg !== null && (
            <>
              <Text style={{ fontSize: 14.5, color: C.headerFaint, marginTop: 16, marginLeft: 40 }}>
                {t("termAverage")}
              </Text>
              <Text style={{ fontSize: 44, fontWeight: "800", color: "#fff", marginLeft: 40, marginTop: 2 }}>
                {avg}%
              </Text>
            </>
          )}
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {studentEntries.length === 0 ? (
          <Card style={{ padding: 24, alignItems: "center" }}>
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22 }}>
              {t("noRecords")}
            </Text>
          </Card>
        ) : (
          <>
            <Text style={{ fontSize: 17, fontWeight: "700", color: C.ink, marginTop: 6, marginBottom: 10 }}>
              {t("assessments")}
            </Text>
            <Card style={{ overflow: "hidden" }}>
              {studentEntries.map((e, i) => (
                <Press
                  key={e.id}
                  onPress={() =>
                    router.push({
                      pathname: "/request-correction",
                      params: {
                        entryId: e.id,
                        mark: String(e.mark),
                        maxMark: String(e.maxMark),
                        studentName: e.studentName,
                        assessment: e.assessment,
                      },
                    })
                  }
                  accessibilityLabel={`${e.assessment} ${e.mark}/${e.maxMark}`}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 14,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: C.line,
                    }}
                  >
                    <IconTile size={44} radius={12} bg={C.bg}>
                      <ClipboardList size={20} color={C.green} />
                    </IconTile>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>{e.assessment}</Text>
                      <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>
                        {e.mark}/{e.maxMark}
                      </Text>
                    </View>
                    <StatusPill label={e.source === "ai" || e.source === "cv" ? t("scanned") : t("manual")} />
                    <View style={{ marginLeft: 12 }}>
                      <StatusPill label={t("locked")} icon={<Lock size={11} color={C.green} />} />
                    </View>
                  </View>
                </Press>
              ))}
            </Card>

            <Card style={{ padding: 16, marginTop: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: C.ink }}>{t("corrections")}</Text>
              {corrections.length === 0 ? (
                <Text style={{ fontSize: 14, color: C.faint, marginTop: 10 }}>{t("original")}</Text>
              ) : (
                corrections.map(({ entry, v, n }) => (
                  <View key={`${entry.id}-${n}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 }}>
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        backgroundColor: C.yellowTint,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Pencil size={16} color={C.amber} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, color: C.ink, fontWeight: "600" }}>
                        {t("versionN").replace("{n}", String(n))} · {entry.assessment}: {v.mark}/{entry.maxMark}
                      </Text>
                      <Text style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>
                        {v.note} · {v.by} ·{" "}
                        {new Date(v.at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>

            <Press onPress={exportCsv} accessibilityLabel={t("exportReport")}>
              <Card style={{ padding: 16, marginTop: 14, flexDirection: "row", alignItems: "center", borderColor: C.green, borderWidth: 1.4 }}>
                <Upload size={20} color={C.ink} />
                <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "700", color: C.ink, marginLeft: 12 }}>
                  {t("exportReport")}
                </Text>
                <ChevronRight size={20} color={C.sub} />
              </Card>
            </Press>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
