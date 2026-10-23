import { ArrowLeft, FileSpreadsheet, Share } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { C, Card, Press, Btn } from "@/components/ui";
import { shareCsv, saveXlsx, saveCsvFile } from "@/lib/share";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { exportableEntries } from "@/src/domain/export-jobs";

type Row = { name: string; marks: string[]; total: string; pct: number };

/**
 * Class term report built from real signed entries for the class: one column
 * per assessment, one row per student, totals and the class average. Shows an
 * empty state until records exist.
 */
export default function ClassReportScreen() {
  const { t } = useI18n();
  const { entries, classList, rosterOf } = useStore();
  const params = useLocalSearchParams<{ classId?: string }>();

  const storeCls = classList.find((c) => c.id === params.classId);
  const cls = storeCls ? { id: storeCls.id, subject: storeCls.subject || storeCls.name, grade: storeCls.grade } : null;

  const clsEntries = useMemo(() => entries.filter((e) => e.classId === (cls?.id ?? "")), [entries, cls?.id]);

  const { cols, rows, avg } = useMemo(() => {
    const cols: string[] = [];
    const byStudent = new Map<string, { marks: Map<string, string>; sumMark: number; sumMax: number }>();
    for (const e of clsEntries) {
      if (!cols.includes(e.assessment)) cols.push(e.assessment);
      const row = byStudent.get(e.studentName) ?? { marks: new Map<string, string>(), sumMark: 0, sumMax: 0 };
      row.marks.set(e.assessment, `${e.mark}/${e.maxMark}`);
      row.sumMark += e.mark;
      row.sumMax += e.maxMark;
      byStudent.set(e.studentName, row);
    }

    // Roster order first, then any names not on the roster.
    const ordered = [
      ...rosterOf(cls?.id ?? "").map((s) => s.name).filter((n) => byStudent.has(n)),
      ...[...byStudent.keys()].filter((n) => !rosterOf(cls?.id ?? "").some((s) => s.name === n)),
    ];

    const rows: Row[] = ordered.map((name) => {
      const s = byStudent.get(name)!;
      return {
        name,
        marks: cols.map((c) => s.marks.get(c) ?? "—"),
        total: `${s.sumMark}/${s.sumMax}`,
        pct: Math.round((s.sumMark / Math.max(1, s.sumMax)) * 100),
      };
    });
    const avg = rows.length
      ? Math.round(rows.reduce((acc, r) => acc + r.pct, 0) / rows.length)
      : 0;
    return { cols, rows, avg };
  }, [clsEntries, cls?.id, rosterOf]);

  const { markExported } = useStore();
  const [savingXlsx, setSavingXlsx] = useState(false);

  /** CSV: a real .csv file on Android (SAF); the text share is the web fallback. */
  const exportCsv = async () => {
    const header = ["Student", ...cols, "Total"];
    const body = rows.map((r) => [r.name, ...r.marks, r.total]);
    if (Platform.OS === "web") {
      void shareCsv(header.join(","), body);
      return;
    }
    const res = await saveCsvFile(header, body, `${cls?.subject ?? "report"} ${cls?.grade ?? ""}`);
    if (!res.ok && res.reason === "write_failed") Alert.alert(t("excelSaveFailed"));
  };

  /**
   * Real Excel export: a genuine .xlsx written to a folder the teacher picks
   * (Android SAF). Only confirmed entries are included and marked exported —
   * after the file exists, never before. Web has no file framework, so it
   * falls back to the CSV share, labeled as CSV.
   */
  const exportXlsx = async () => {
    if (!cls || rows.length === 0) return;
    const csvFallback = () => {
      void shareCsv(
        `student,${cols.join(",")},total`,
        rows.map((r) => [r.name, ...r.marks, r.total]),
      );
    };
    if (Platform.OS === "web") {
      csvFallback();
      return;
    }
    setSavingXlsx(true);
    try {
      const res = await saveXlsx(
        [
          {
            name: `${cls.subject} ${cls.grade}`.trim().slice(0, 31) || "Report",
            rows: [
              ["Student", ...cols, "Total"],
              ...rows.map((r) => [r.name, ...r.marks, r.total] as (string | number)[]),
              [t("classAvg"), "", ...cols.map(() => ""), `${avg}%`],
            ],
          },
        ],
        `${cls.subject} ${cls.grade} report`,
      );
      if (res.ok) {
        const { included } = exportableEntries(clsEntries);
        markExported(included.map((e) => e.id));
        Alert.alert(
          t("excelSavedTitle"),
          t("excelSavedBody").replace("{name}", res.fileName),
        );
      } else {
        Alert.alert(t("excelSaveFailed"));
      }
    } finally {
      setSavingXlsx(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={{ backgroundColor: C.greenDeep, paddingHorizontal: 20, paddingBottom: 14 }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: C.greenDeep }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 8 }}>
            <Press onPress={() => router.back()} accessibilityLabel={t("cancel")}>
              <ArrowLeft size={24} color="#fff" strokeWidth={2.4} />
            </Press>
            <View style={{ marginLeft: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: "#fff" }}>{t("classReport")}</Text>
              <Text style={{ fontSize: 14, color: C.headerSub, marginTop: 2 }}>
                {cls ? `${cls.subject} · ${cls.grade}` : ""} · {t("termReport")}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {rows.length === 0 || cols.length === 0 || !cls ? (
          <Card style={{ padding: 24, alignItems: "center" }}>
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22 }}>{t("noData")}</Text>
          </Card>
        ) : (
          <Card style={{ padding: 16 }}>
            {/* Table header */}
            <View style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <Text style={{ width: 90, fontSize: 12.5, fontWeight: "700", color: C.sub }}>{t("student")}</Text>
              {cols.map((c) => (
                <Text key={c} style={{ flex: 1, fontSize: 10.5, fontWeight: "600", color: C.sub, textAlign: "center" }} numberOfLines={1}>
                  {c}
                </Text>
              ))}
              <Text style={{ width: 62, fontSize: 10.5, fontWeight: "600", color: C.sub, textAlign: "center" }}>
                {t("totalLabel")}
              </Text>
            </View>

            {rows.map((r) => (
              <View
                key={r.name}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.hairline }}
              >
                <Text style={{ width: 90, fontSize: 12.5, color: C.ink, lineHeight: 17 }} numberOfLines={1}>
                  {r.name}
                </Text>
                {r.marks.map((m, i) => (
                  <Text key={`${r.name}-${i}`} style={{ flex: 1, fontSize: 13, color: C.ink, textAlign: "center" }}>
                    {m}
                  </Text>
                ))}
                <Text style={{ width: 62, fontSize: 14, fontWeight: "800", color: C.green, textAlign: "center" }}>
                  {r.total}
                </Text>
              </View>
            ))}

            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14 }}>
              <Text style={{ width: 90, fontSize: 13, fontWeight: "700", color: C.ink }}>{t("classAvg")}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ fontSize: 15, fontWeight: "800", color: C.green }}>{avg}%</Text>
            </View>
          </Card>
        )}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Btn
            label={t("exportExcel")}
            icon={<FileSpreadsheet size={18} color="#fff" />}
            onPress={() => void exportXlsx()}
            disabled={rows.length === 0 || savingXlsx}
            style={{ flex: 1.4, height: 52 }}
          />
          <Btn
            label="CSV"
            variant="outline"
            icon={<FileSpreadsheet size={18} color={C.green} />}
            onPress={() => void exportCsv()}
            disabled={rows.length === 0}
            style={{ flex: 0.8, height: 52 }}
          />
          <Btn
            label={t("shareReport")}
            variant="outline"
            icon={<Share size={18} color={C.green} />}
            onPress={() =>
              void shareCsv(
                `student,${cols.join(",")},total`,
                rows.map((r) => [r.name, ...r.marks, r.total]),
              )
            }
            disabled={rows.length === 0}
            style={{ flex: 1, height: 52 }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
