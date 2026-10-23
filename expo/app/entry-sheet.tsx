import { View, Text, TextInput, StatusBar, Alert } from "react-native";
import { CheckCircle2, AlertTriangle, CircleMinus } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { C, Btn, Avatar, Grabber, Press, initialsOf, Illu } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Manual-entry sheet: editable marks per student, drafts stay pending until locked. */
export default function EntrySheetScreen() {
  const { addEntry, entries, rosterOf, classList } = useStore();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ assessment?: string; classId?: string; maxMark?: string }>();
  const assessment = params.assessment ?? "Quiz";
  const classId = params.classId ?? classList[0]?.id ?? "";
  const maxMark = Number(params.maxMark ?? 30) || 30;

  // Real roster from the store only — an empty roster shows the setup hint.
  const roster = rosterOf(classId);
  const clsRec = classList.find((c) => c.id === classId);
  const clsName = clsRec ? `${clsRec.subject || clsRec.name} · ${clsRec.grade}` : classId;
  const rosterKey = roster.map((s) => s.name).join("|");
  const students = roster.map((s) => ({ name: s.name, mark: null as number | null }));

  const [marks, setMarks] = useState<Record<string, string>>({});
  // Re-seed editable marks from signed records when the roster or assessment changes.
  useEffect(() => {
    setMarks(
      Object.fromEntries(
        roster.map((s) => {
          const saved = entries.find((e) => e.studentName === s.name && e.assessment === assessment);
          return [s.name, saved ? String(saved.mark) : ""];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey, assessment]);

  const filled = useMemo(
    () =>
      students.filter((s) => {
        const v = Number(marks[s.name]);
        return marks[s.name] !== "" && !Number.isNaN(v);
      }),
    [marks],
  );

  const saveAll = (pending: boolean) => {
    filled.forEach((s) => {
      const mark = Number(marks[s.name]);
      if (entries.some((e) => e.studentName === s.name && e.assessment === assessment)) return;
      addEntry({
        studentName: s.name,
        classId,
        assessment,
        mark,
        maxMark,
        confidence: 99,
        source: "manual",
        status: pending ? "pending" : undefined,
      });
    });
  };

  const saveDraft = () => {
    saveAll(true);
    Alert.alert(t("draftSaved"), t("draftSavedBody"), [{ text: t("ok"), onPress: () => router.back() }]);
  };

  const submit = () => {
    saveAll(false);
    router.push("/session-complete");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "rgba(20,25,20,0.55)" }}>
      <StatusBar barStyle="light-content" />
      <Press style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel={t("cancel")} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 20, maxHeight: "92%" }}>
        <Grabber />
        {/* Dark header */}
        <View style={{ backgroundColor: C.greenDeep, padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff" }}>
            {assessment} · {clsName}
          </Text>
          <Text style={{ fontSize: 15, color: C.headerSub, marginTop: 6 }}>
            {t("enteredOf").replace("{n}", String(filled.length)).replace("{m}", String(students.length))}
          </Text>
          <Text style={{ fontSize: 15, color: C.headerSub, marginTop: 2 }}>
            {t("totalMarks")}: {maxMark}
          </Text>
          {students.length === 0 && (
            <Text style={{ fontSize: 14, color: "#FFD9A8", marginTop: 8 }}>{t("noRosterYet")}</Text>
          )}
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {students.map((s, i) => {
            const v = Number(marks[s.name]);
            const over = marks[s.name] !== "" && !Number.isNaN(v) && v > maxMark;
            const empty = marks[s.name] === "";
            return (
              <View
                key={s.name}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 9,
                  gap: 12,
                  borderBottomWidth: i < students.length - 1 ? 1 : 0,
                  borderBottomColor: C.line,
                }}
              >
                <Avatar text={initialsOf(s.name)} size={40} bg={over ? C.amberChip : C.greenTint} fg={over ? C.amberText : C.green} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>{s.name}</Text>
                  {over && (
                    <Text style={{ fontSize: 13, color: C.amberText, marginTop: 1 }}>
                      {t("overMax")} {maxMark}
                    </Text>
                  )}
                </View>
                <TextInput
                  value={marks[s.name] ?? ""}
                  onChangeText={(text) => setMarks((m) => ({ ...m, [s.name]: text.replace(/[^0-9]/g, "") }))}
                  keyboardType="number-pad"
                  maxLength={4}
                  placeholder={t("notEntered")}
                  placeholderTextColor={C.faint}
                  style={{
                    width: 86,
                    height: 48,
                    borderRadius: 14,
                    borderWidth: 1.4,
                    borderColor: over ? C.amber : C.line,
                    backgroundColor: C.card,
                    textAlign: "center",
                    fontSize: 17,
                    fontWeight: "700",
                    color: C.ink,
                  }}
                  accessibilityLabel={`${s.name} ${t("correctedMark")}`}
                />
                {over ? (
                  <AlertTriangle size={22} color={C.amber} />
                ) : empty ? (
                  <CircleMinus size={22} color={C.faint} />
                ) : (
                  <CheckCircle2 size={22} color={C.green} />
                )}
              </View>
            );
          })}

          <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
            <Btn
              label={t("saveDraft")}
              variant="outline"
              style={{ flex: 1, height: 54 }}
              onPress={saveDraft}
              disabled={students.length === 0}
            />
            <Btn
              label={t("submitLock")}
              style={{ flex: 1.6, height: 54 }}
              onPress={submit}
              disabled={students.length === 0 || filled.length === 0 || filled.some((s) => Number(marks[s.name]) > maxMark)}
            />
          </View>

          <Illu name="entrySheet" />
        </View>
      </View>
    </View>
  );
}
