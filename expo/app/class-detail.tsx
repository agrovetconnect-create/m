import { ArrowLeft, ClipboardList, Pencil, Lock, Clock, Plus } from "lucide-react-native";
import React from "react";
import { View, Text, ScrollView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { C, Card, Press, Btn, StatusPill, Progress, Avatar, IconTile, initialsOf } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

export default function ClassDetailScreen() {
  const { session, classList, rosterOf, entries } = useStore();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ classId?: string }>();

  const storeCls = classList.find((c) => c.id === params.classId);
  if (!storeCls) {
    // No such class in the real store — nothing fake to show.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
        <StatusBar barStyle="light-content" />
        <Card style={{ margin: 20, padding: 24, alignItems: "center" }}>
          <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22 }}>{t("noData")}</Text>
        </Card>
      </SafeAreaView>
    );
  }
  const rosterStudents = rosterOf(storeCls.id).map((s) => ({ initials: initialsOf(s.name), name: s.name }));
  const cls = {
    id: storeCls.id,
    subject: storeCls.subject || storeCls.name,
    grade: storeCls.grade,
    students: Math.max(1, rosterStudents.length),
  };

  // Real assessments for this class, derived from signed entries.
  const assessRows = (() => {
    const byAssessment = new Map<string, { total: number; confirmed: number; latest: string }>();
    for (const e of entries.filter((e) => e.classId === cls.id)) {
      const cur = byAssessment.get(e.assessment) ?? { total: 0, confirmed: 0, latest: e.createdAt };
      cur.total += 1;
      if (e.status === "confirmed") cur.confirmed += 1;
      if (e.createdAt > cur.latest) cur.latest = e.createdAt;
      byAssessment.set(e.assessment, cur);
    }
    return [...byAssessment.entries()].map(([name, v]) => ({
      name,
      date: new Date(v.latest).toLocaleDateString(),
      frac: Math.min(1, v.total / cls.students),
      label: `${v.total}/${Math.max(v.total, cls.students)}`,
      locked: v.confirmed === v.total,
    }));
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={{ backgroundColor: C.greenDeep, paddingHorizontal: 20, paddingBottom: 18 }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: C.greenDeep }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 8 }}>
            <Press onPress={() => router.back()} accessibilityLabel={t("cancel")}>
              <ArrowLeft size={24} color="#fff" strokeWidth={2.4} />
            </Press>
            <Text style={{ fontSize: 22, fontWeight: "800", color: "#fff", marginLeft: 16 }}>
              {cls.subject} · {cls.grade}
            </Text>
          </View>
          <Text style={{ fontSize: 15, color: C.headerSub, marginTop: 8, marginLeft: 40 }}>
            {session?.name ?? t("teacher")} · {t("room")}
          </Text>
          <Press
            onPress={() => router.push({ pathname: "/class-report", params: { classId: cls.id } })}
            accessibilityLabel={t("classReport")}
          >
            <Text style={{ fontSize: 14.5, color: C.headerFaint, marginTop: 4, marginLeft: 40 }}>
              {cls.students} {t("students")} · {assessRows.length} {t("assessmentsTerm")} →
            </Text>
          </Press>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {assessRows.length === 0 ? (
          <Card style={{ padding: 24, alignItems: "center" }}>
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22 }}>{t("noData")}</Text>
          </Card>
        ) : (
          <Card style={{ overflow: "hidden" }}>
          {assessRows.map((a, i) => (
            <Press
              key={a.name}
              onPress={() =>
                router.push({
                  pathname: "/marksheet",
                  params: { assessment: a.name, classId: cls.id },
                })
              }
              accessibilityLabel={`${a.name} ${a.label}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}>
                <IconTile size={48} radius={14} bg={a.locked ? C.greenTint : C.amberChip}>
                  {a.locked ? (
                    <ClipboardList size={22} color={C.green} />
                  ) : (
                    <Pencil size={22} color={C.amber} />
                  )}
                </IconTile>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: C.ink }}>{a.name}</Text>
                  <Text style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{a.date}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 }}>
                    <Progress frac={a.frac} style={{ width: 130 }} track={a.locked ? "#DCEBDD" : C.chipGrey} />
                    <Text style={{ fontSize: 12.5, color: C.sub }}>{a.label}</Text>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {a.locked ? (
                    <StatusPill label={t("submittedLocked")} icon={<Lock size={11} color={C.green} />} />
                  ) : (
                    <StatusPill label={t("inProgress")} tint={C.yellowTint} fg={C.amberText} icon={<Clock size={11} color={C.amber} />} />
                  )}
                </View>
              </View>
            </Press>
          ))}
          </Card>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
          {rosterStudents.map((s) => (
            <Press
              key={s.initials}
              onPress={() =>
                router.push({ pathname: "/student-history", params: { studentName: s.name.replace("\n", " ") } })
              }
              accessibilityLabel={s.name.replace("\n", " ")}
              style={{ width: "31%", flexGrow: 1 }}
            >
              <Card style={{ padding: 14, alignItems: "center" }}>
                <Avatar text={s.initials} size={44} />
                <Text style={{ fontSize: 12.5, color: C.ink, textAlign: "center", marginTop: 8, lineHeight: 17 }}>
                  {s.name.replace("\n", " ")}
                </Text>
              </Card>
            </Press>
          ))}
        </View>

        <Btn
          label={t("newMarkSheet")}
          icon={<Plus size={20} color="#fff" />}
          onPress={() => router.push("/new-marksheet")}
          style={{ marginTop: 20, alignSelf: "center", paddingHorizontal: 30 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
