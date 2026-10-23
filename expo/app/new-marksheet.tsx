import { View, Text, TextInput, Pressable, StatusBar, Platform, KeyboardAvoidingView, ScrollView } from "react-native";
import { CheckCircle2, ScanText, Pencil, Plus, ChevronRight } from "lucide-react-native";
import React, { useState } from "react";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { C, Card, Press, Btn, ScreenHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

const types = ["Quiz", "Test", "Mid-Term", "Assignment"];

/** Sheet setup: class, editable assessment name and total — passed through to capture/entry. */
export default function NewMarkSheetScreen() {
  const { t } = useI18n();
  const { classList, students } = useStore();
  const options = classList.map((c) => ({
    id: c.id,
    subject: c.subject || c.name,
    grade: c.grade,
    students: students.filter((s) => s.classId === c.id).length,
  }));
  const [cls, setCls] = useState("");
  // Resolve to a real class even before the picker state settles.
  const activeCls = classList.some((c) => c.id === cls) ? cls : (classList[0]?.id ?? "");
  const [type, setType] = useState("Mid-Term");
  const [name, setName] = useState("Mid-Term");
  const [maxMark, setMaxMark] = useState("50");
  const [scanAI, setScanAI] = useState(true);
  const [manual, setManual] = useState(false);

  const max = Number(maxMark) || 50;
  const clsInfo = options.find((c) => c.id === activeCls);

  const start = () => {
    const assessment = name.trim() || type;
    if (manual) {
      router.push({ pathname: "/entry-sheet", params: { assessment, classId: activeCls, maxMark: String(max) } });
    } else {
      // The sheet setup rides along so capture/review use the teacher's real
      // selections (no hardcoded defaults anywhere downstream).
      router.push({ pathname: "/scan", params: { assessment, classId: activeCls, maxMark: String(max) } });
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("newMarkSheet")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}>
          <Text style={{ fontSize: 15, color: C.sub, marginTop: 8 }}>{t("setUpBefore")}</Text>

          {options.length === 0 ? (
            <View style={{ marginTop: 18, alignItems: "center" }}>
              <Text style={{ fontSize: 14.5, color: C.sub, textAlign: "center" }}>{t("noClassesYet")}</Text>
            </View>
          ) : (
            <Card style={{ marginTop: 18, overflow: "hidden" }}>
              {options.map((c, i) => (
                <Press key={c.id} onPress={() => setCls(c.id)} accessibilityLabel={c.subject} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}>
                  <View style={{ flexDirection: "row", alignItems: "center", padding: 15 }}>
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: C.ink }}>
                      {c.subject} · {c.grade} · {c.students} {t("students")}
                    </Text>
                    {activeCls === c.id && <CheckCircle2 size={22} color={C.green} />}
                  </View>
                </Press>
              ))}
            </Card>
          )}

          <Press onPress={() => router.push("/class-setup")} accessibilityLabel={t("createClass")}>
            <Card style={{ marginTop: 10, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Plus size={20} color={C.green} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: C.ink }}>{t("createClass")}</Text>
              <ChevronRight size={18} color={C.faint} />
            </Card>
          </Press>

          <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 16, marginBottom: 8 }}>{t("assessmentName")}</Text>
          <Card style={{ paddingVertical: 6, borderWidth: 1.4, borderColor: C.line }}>
            <TextInput
              value={name}
              onChangeText={setName}
              style={{ fontSize: 16, color: C.ink, paddingHorizontal: 15, paddingVertical: 9, height: 44 }}
              accessibilityLabel={t("assessmentName")}
            />
          </Card>

          <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 16, marginBottom: 8 }}>{t("totalMarks")}</Text>
          <Card style={{ paddingVertical: 6, borderWidth: 1.4, borderColor: C.line }}>
            <TextInput
              value={maxMark}
              onChangeText={(v) => setMaxMark(v.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              maxLength={4}
              style={{ fontSize: 16, color: C.ink, paddingHorizontal: 15, paddingVertical: 9, height: 44 }}
              accessibilityLabel={t("totalMarks")}
            />
          </Card>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            {types.map((tp) => (
              <Press key={tp} onPress={() => { setType(tp); setName(tp); }} accessibilityLabel={tp}>
                <View
                  style={{
                    backgroundColor: type === tp ? C.green : C.card,
                    borderRadius: 22,
                    borderWidth: 1.4,
                    borderColor: type === tp ? C.green : C.line,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "700", color: type === tp ? "#fff" : C.ink }}>{tp}</Text>
                </View>
              </Press>
            ))}
          </View>

          <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 18, marginBottom: 8 }}>{t("captureSource")}</Text>
          <Card style={{ overflow: "hidden" }}>
            <ToggleRow
              icon={<ScanText size={20} color={C.green} />}
              label={t("scanWithAI")}
              on={scanAI}
              toggle={() => {
                setScanAI(!scanAI);
                if (!scanAI) setManual(false);
              }}
            />
            <View style={{ height: 1, backgroundColor: C.line }} />
            <ToggleRow
              icon={<Pencil size={20} color={C.green} />}
              label={t("enterManually")}
              on={manual}
              toggle={() => {
                setManual(!manual);
                if (!manual) setScanAI(false);
              }}
            />
          </Card>

          <Btn
            label={t("startCapturing")}
            onPress={start}
            disabled={(!scanAI && !manual) || !activeCls}
            style={{ marginTop: 20 }}
          />
          <Text style={{ textAlign: "center", fontSize: 12.5, color: C.faint, marginTop: 10 }}>
            {clsInfo?.subject} · {clsInfo?.students ?? 0} {t("students")} · {t("totalMarks")} {max}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ToggleRow({ icon, label, on, toggle }: { icon: React.ReactNode; label: string; on: boolean; toggle: () => void }) {
  return (
    <Press onPress={toggle} accessibilityRole="switch" accessibilityState={{ selected: on }} accessibilityLabel={label}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 12 }}>
        {icon}
        <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "600", color: C.ink }}>{label}</Text>
        <Pressable onPress={toggle} hitSlop={8}>
          <View style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: on ? C.green : C.trackOff, justifyContent: "center", paddingHorizontal: 3 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff", alignSelf: on ? "flex-end" : "flex-start" }} />
          </View>
        </Pressable>
      </View>
    </Press>
  );
}
