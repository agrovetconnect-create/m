import { ArrowLeft, Search, ShieldCheck, ScanLine, Keyboard, AlertTriangle, Lock } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { C, Press, Btn, StatusPill, Chip } from "@/components/ui";
import { useStore, type Entry } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

const reasonKeys = ["reasonSmudge", "reasonLighting", "reasonPartial", "reasonAmbiguous", "reasonOther"] as const;

/**
 * Per-assessment roster. Marks are editable, low-confidence rows get the
 * human-in-the-loop review panel, and "Submit & lock" writes a signed
 * record per student via the store.
 */
export default function MarkSheetScreen() {
  const { addEntry, correctEntry, entries, rosterOf, classList } = useStore();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ assessment?: string; classId?: string; maxMark?: string }>();
  const assessment = params.assessment ?? "Quiz";
  const classId = params.classId ?? classList[0]?.id ?? "";
  const maxMark = Number(params.maxMark ?? 100) || 100;

  // Real roster from the store, pre-filled from this device's signed records.
  const roster = rosterOf(classId);
  const clsRec = classList.find((c) => c.id === classId);
  const clsName = clsRec ? `${clsRec.subject || clsRec.name} · ${clsRec.grade}` : classId;
  type Row = { name: string; saved: Entry | null; source: "scanned" | "manual"; flagged: boolean };
  const students: Row[] = roster.map((s) => {
    const saved = entries.find((e) => e.studentName === s.name && e.assessment === assessment) ?? null;
    return {
      name: s.name,
      saved,
      source: saved?.source === "ai" || saved?.source === "cv" ? "scanned" : "manual",
      // Flagged (low-confidence) records reopen the human-in-the-loop panel.
      flagged: saved ? saved.status !== "confirmed" : false,
    };
  });
  const savedKey = students.map((s) => `${s.name}:${s.saved?.mark ?? ""}:${s.saved?.versions.length ?? 0}`).join("|");

  const [reason, setReason] = useState<string>(reasonKeys[0]);
  const [query, setQuery] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});
  // Re-seed editable marks whenever the underlying signed records change.
  useEffect(() => {
    setMarks(Object.fromEntries(students.map((s) => [s.name, s.saved ? String(s.saved.mark) : ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, assessment]);

  const shown = useMemo(
    () => students.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
    [students, query],
  );

  const filled = students.filter((s) => marks[s.name] !== "" && marks[s.name] !== undefined);

  const submit = () => {
    // New records are signed and locked; existing flagged records are
    // corrected via the append-only version chain (originals preserved).
    let savedCount = 0;
    students.forEach((s) => {
      const raw = marks[s.name];
      if (raw === "" || raw === undefined) return;
      const mark = Number(raw);
      if (Number.isNaN(mark)) return;
      if (s.saved) {
        if (mark !== s.saved.mark) {
          correctEntry(s.saved.id, mark, t(reason as Parameters<typeof t>[0]));
          savedCount += 1;
        }
      } else {
        addEntry({
          studentName: s.name,
          classId,
          assessment,
          mark,
          maxMark,
          confidence: 99,
          source: "manual",
        });
        savedCount += 1;
      }
    });
    Alert.alert(
      t("lockedTitle"),
      t("lockedBody").replace("{n}", String(savedCount)),
      [{ text: t("ok"), onPress: () => router.push("/session-complete") }],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["bottom"]}>
      <StatusBar barStyle="light-content" />
      {/* Dark green header */}
      <View style={{ backgroundColor: C.greenDeep, paddingBottom: 16 }}>
        <SafeAreaView edges={["top"]} style={{ backgroundColor: C.greenDeep }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 8 }}>
            <Press onPress={() => router.back()} accessibilityLabel={t("cancel")}>
              <ArrowLeft size={24} color="#fff" strokeWidth={2.4} />
            </Press>
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff", marginLeft: 16, flex: 1 }} numberOfLines={1}>
              {clsName} · {assessment}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12, gap: 24, paddingLeft: 60 }}>
            <Text style={{ fontSize: 14.5, color: C.headerSub }}>
              {t("enteredLabel")}{" "}
              <Text style={{ color: "#8FD6A8", fontWeight: "800" }}>
                {filled.length}/{students.length}
              </Text>
            </Text>
            <View style={{ width: 1, height: 16, backgroundColor: C.headerLine }} />
            <Text style={{ fontSize: 14.5, color: C.headerSub }}>
              {t("totalMarks")} <Text style={{ color: "#fff", fontWeight: "800" }}>{maxMark}</Text>
            </Text>
          </View>
          <View
            style={{
              marginHorizontal: 20,
              marginTop: 14,
              backgroundColor: C.headerGreen,
              borderRadius: 14,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 14,
              height: 48,
              gap: 10,
            }}
          >
            <Search size={19} color="#A9C7B0" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("searchStudents")}
              placeholderTextColor="#A9C7B0"
              style={{ fontSize: 15.5, color: "#fff", flex: 1 }}
              accessibilityLabel={t("searchStudents")}
            />
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        {students.length === 0 && (
          <Text style={{ padding: 20, fontSize: 14.5, color: C.sub, textAlign: "center", lineHeight: 22 }}>
            {t("noRosterYet")}
          </Text>
        )}
        {shown.map((s, i) => (
          <View key={s.name}>
            {s.flagged ? (
              <ReviewRow
                index={i + 1}
                name={s.name}
                mark={Number(marks[s.name] ?? s.saved?.mark ?? 0)}
                maxMark={maxMark}
                reason={reason}
                setReason={setReason}
                onChange={(v) => setMarks((m) => ({ ...m, [s.name]: v }))}
              />
            ) : (
              <View
                style={{
                  backgroundColor: C.card,
                  borderRadius: 14,
                  padding: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 8,
                  marginTop: 8,
                }}
              >
                <Text style={{ width: 26, fontSize: 14.5, color: C.sub }}>{i + 1}</Text>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: C.ink }}>{s.name}</Text>
                {s.saved?.status === "confirmed" && <ShieldCheck size={20} color={C.green} />}
                <TextInput
                  value={marks[s.name] ?? ""}
                  onChangeText={(v) => setMarks((m) => ({ ...m, [s.name]: v }))}
                  keyboardType="number-pad"
                  maxLength={4}
                  style={{
                    marginLeft: 12,
                    width: 62,
                    height: 44,
                    borderRadius: 10,
                    borderWidth: 1.4,
                    borderColor: C.line,
                    textAlign: "center",
                    fontSize: 17,
                    fontWeight: "800",
                    color: C.ink,
                  }}
                  accessibilityLabel={`${s.name} ${t("correctedMark")}`}
                />
                <View style={{ marginLeft: 12, width: 96, alignItems: "flex-end" }}>
                  {s.source === "scanned" ? (
                    <StatusPill label={t("scanned")} icon={<ScanLine size={13} color={C.green} />} />
                  ) : (
                    <StatusPill label={t("manual")} tint={C.chipGrey} fg={C.sub} icon={<Keyboard size={13} color={C.sub} />} />
                  )}
                </View>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: C.card,
          borderTopWidth: 1,
          borderTopColor: C.line,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        <SafeAreaView edges={["bottom"]} style={{ backgroundColor: "transparent" }}>
          <Btn
            label={t("submitLock")}
            icon={<Lock size={19} color="#fff" />}
            onPress={submit}
            disabled={filled.length === 0}
            style={{ marginHorizontal: 20 }}
          />
          <Text style={{ textAlign: "center", fontSize: 12.5, color: C.sub, marginTop: 8 }}>
            {t("lockedNote")}
          </Text>
        </SafeAreaView>
      </View>
    </SafeAreaView>
  );
}

function ReviewRow({
  index,
  name,
  mark,
  maxMark,
  reason,
  setReason,
  onChange,
}: {
  index: number;
  name: string;
  mark: number;
  maxMark: number;
  reason: string;
  setReason: (r: string) => void;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <View>
      <View
        style={{
          backgroundColor: C.amberCard,
          borderRadius: 14,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 0,
          marginTop: 8,
        }}
      >
        <AlertTriangle size={18} color={C.amber} />
        <Text style={{ width: 14 }} />
        <Text style={{ width: 12, fontSize: 14.5, color: C.sub }}>{index}</Text>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: C.ink }}>{name}</Text>
        <View
          style={{
            width: 54,
            height: 44,
            borderRadius: 10,
            borderWidth: 1.4,
            borderColor: C.amber,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#fff",
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: "800", color: C.amberText }}>{mark}</Text>
        </View>
        <View style={{ marginLeft: 12, width: 108, alignItems: "flex-end" }}>
          <StatusPill label={t("needsReview")} tint={C.amberChip} fg={C.amberText} icon={<AlertTriangle size={11} color={C.amber} />} />
        </View>
      </View>

      <View
        style={{
          backgroundColor: C.card,
          borderRadius: 14,
          marginHorizontal: 10,
          marginBottom: 8,
          padding: 16,
          borderWidth: 1,
          borderColor: C.line,
        }}
      >
        <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>
          {name} — {t("aiRead")} {mark}, {t("yourMark")}:
        </Text>
        <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 12, marginBottom: 6 }}>{t("correctedMark")}</Text>
        <TextInput
          value={String(mark)}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={4}
          style={{
            borderWidth: 1.4,
            borderColor: C.green,
            borderRadius: 12,
            height: 52,
            paddingHorizontal: 14,
            fontSize: 17,
            fontWeight: "700",
            color: C.ink,
          }}
          accessibilityLabel={`${name} ${t("correctedMark")}`}
        />
        <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 14, marginBottom: 8 }}>
          {t("reason")} ({maxMark})
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {reasonKeys.map((r) => (
            <Chip
              key={r}
              label={t(r)}
              active={reason === r}
              tint={reason === r ? C.greenChip : C.rowGrey}
              fg={reason === r ? C.green : C.sub}
              onPress={() => setReason(r)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
