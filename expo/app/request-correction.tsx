import { ShieldCheck, Info, CheckCircle2 } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, StatusBar, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { C, Card, Press, Btn, Chip, Grabber, Illu } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

const reasonKeys = ["reasonMarking", "reasonMisread", "reasonRemark", "reasonOther"] as const;

/**
 * Correction sheet for an existing signed record: creates a new signed
 * version via the store — the original is preserved in version history.
 */
export default function RequestCorrectionSheet() {
  const { correctEntry, entries } = useStore();
  const { t } = useI18n();
  const params = useLocalSearchParams<{
    entryId?: string;
    mark?: string;
    maxMark?: string;
    studentName?: string;
    assessment?: string;
  }>();

  const entry = params.entryId ? entries.find((e) => e.id === params.entryId) : undefined;
  const studentName = entry?.studentName ?? params.studentName ?? "";
  const assessment = entry?.assessment ?? params.assessment ?? "";
  const originalMark = entry?.mark ?? Number(params.mark ?? 0);
  const maxMark = entry?.maxMark ?? (Number(params.maxMark ?? 100) || 100);

  const [reason, setReason] = useState<string>(reasonKeys[0]);
  const [newMark, setNewMark] = useState(String(originalMark));
  const [note, setNote] = useState("");

  // The screen only makes sense for an existing record.
  useEffect(() => {
    if (!params.entryId) router.back();
  }, [params.entryId]);

  const submit = () => {
    const mark = Number(newMark);
    if (Number.isNaN(mark) || mark === originalMark) {
      Alert.alert(t("requestCorrection"), t("correctedMark"));
      return;
    }
    correctEntry(params.entryId!, mark, `${t(reason)}: ${note.trim() || "—"}`);
    Alert.alert(t("correctionSaved"), t("correctionSavedBody"), [
      { text: t("ok"), onPress: () => router.back() },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: "rgba(20,25,20,0.55)" }}>
      <StatusBar barStyle="light-content" />
      <Press style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel={t("cancel")} />
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 24 }}>
        <Grabber />
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: C.greenDeep }}>{t("requestCorrection")}</Text>
          <Text style={{ fontSize: 15, color: C.sub, marginTop: 4 }}>
            {studentName} · {assessment} · {originalMark}/{maxMark}
          </Text>

          <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
            <Card style={{ flex: 1, padding: 14, backgroundColor: C.greenSoft, borderColor: C.greenBorder }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: C.ink }}>{t("originalLocked")}</Text>
                <ShieldCheck size={15} color={C.green} />
              </View>
              <Text style={{ fontSize: 40, fontWeight: "800", color: C.greenDeep, marginTop: 10 }}>
                {originalMark}
              </Text>
            </Card>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13.5, fontWeight: "600", color: C.ink, marginBottom: 8 }}>
                {t("correctedMark")}
              </Text>
              <TextInput
                value={newMark}
                onChangeText={(v) => setNewMark(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                maxLength={4}
                style={{
                  borderWidth: 1.4,
                  borderColor: C.green,
                  borderRadius: 16,
                  flex: 1,
                  paddingHorizontal: 14,
                  fontSize: 26,
                  fontWeight: "700",
                  color: C.ink,
                }}
                accessibilityLabel={t("correctedMark")}
              />
            </View>
          </View>

          <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 18, marginBottom: 8 }}>
            {t("reasonForCorrection")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {reasonKeys.map((r) => (
              <Chip
                key={r}
                label={t(r)}
                active={reason === r}
                tint={reason === r ? C.green : C.card}
                fg={reason === r ? "#fff" : C.ink}
                onPress={() => setReason(r)}
                icon={reason === r ? <CheckCircle2 size={15} color="#fff" /> : undefined}
              />
            ))}
          </View>

          <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 18, marginBottom: 8 }}>{t("note")}</Text>
          <Card style={{ padding: 14, borderWidth: 1.4, borderColor: C.line }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              style={{ fontSize: 15, color: C.ink, minHeight: 60, textAlignVertical: "top" }}
              accessibilityLabel={t("note")}
            />
          </Card>

          <Card
            style={{ backgroundColor: C.amberCard, borderColor: C.amberLine, padding: 14, marginTop: 14, flexDirection: "row", gap: 10 }}
          >
            <Info size={20} color={C.amberText} />
            <Text style={{ flex: 1, fontSize: 13.5, color: C.amberText, lineHeight: 20 }}>
              {t("approvalNote")}
            </Text>
          </Card>

          <Btn label={t("submitForApproval")} onPress={submit} style={{ marginTop: 18 }} />

          <Illu name="requestCorrection" />
        </View>
      </View>
    </View>
  );
}
