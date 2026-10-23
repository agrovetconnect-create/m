import { ArrowLeft, ChevronRight, Pencil } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar, TextInput, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { C, Card, Press, Btn, Avatar, ScreenHeader, initialsOf } from "@/components/ui";
import { useStore } from "@/lib/store";
import { lastDetection } from "@/lib/ai";
import { useI18n } from "@/lib/i18n";

/** Auto-filled from the AI vision read; the teacher verifies every mark before it counts. */
export default function SheetReviewScreen() {
  const { addEntry, classList } = useStore();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ studentName?: string }>();
  const det = lastDetection.current;
  const ctx = lastDetection.context;

  // Confirmed student from the match screen wins over the raw handwriting read.
  const studentName = params.studentName ?? det?.studentName ?? "—";
  const classId = ctx?.classId ?? det?.className ?? "";
  const assessment = ctx?.assessment ?? "Quiz";
  const clsRec = classList.find((c) => c.id === classId);
  const clsName = clsRec ? `${clsRec.subject || clsRec.name} · ${clsRec.grade}` : classId;
  // Only the real AI read is shown — no template fallback questions.
  const rows: { n: number; mark: number; conf: number; label: string }[] = useMemo(
    () =>
      det
        ? det.questions.map((d) => ({ n: d.q, mark: d.mark, conf: d.confidence, label: `${t("question")} ${d.q}` }))
        : [],
    [det, t],
  );
  const detectedTotal = det?.total ?? 0;
  const maxMark = ctx?.maxMark ?? det?.max ?? 50;
  const [total, setTotal] = useState(String(detectedTotal));
  const [editing, setEditing] = useState(false);
  const totalNum = Number(total) || 0;

  const qMax = Math.max(1, Math.round(maxMark / (rows.length || 1)));
  const avgConf = Math.round(rows.reduce((s, r) => s + r.conf, 0) / (rows.length || 1));

  if (!det) {
    // No real AI read in progress — nothing fake to review.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          <Card style={{ padding: 24, alignItems: "center", marginTop: 20 }}>
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22 }}>{t("noData")}</Text>
          </Card>
          <Btn label={t("cancel")} variant="outline" onPress={() => router.back()} style={{ marginTop: 16 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const acceptSheet = () => {
    // Confirm checkpoint: record is created, signed and locked in local storage.
    // The captured photo is kept locally as the audit trail (retention applies).
    addEntry({
      studentName,
      classId,
      assessment,
      mark: totalNum,
      maxMark,
      confidence: avgConf,
      source: "ai",
      image: lastDetection.image ?? undefined,
    });
    lastDetection.current = null;
    lastDetection.image = null;
    lastDetection.context = null;
    router.push("/session-complete");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("sheetReview")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} showsVerticalScrollIndicator={false}>
        {/* The real captured photo, kept locally as the audit trail */}
        {lastDetection.image && (
          <Card style={{ padding: 10 }}>
            <Image
              source={{ uri: `data:image/jpeg;base64,${lastDetection.image}` }}
              style={{ width: "100%", height: 220, borderRadius: 10, backgroundColor: C.rowGrey }}
              resizeMode="cover"
              accessibilityLabel={t("capturedPaper")}
            />
          </Card>
        )}

        {/* Scanned paper */}
        <Card style={{ padding: 16 }}>
          <Text style={{ textAlign: "center", fontSize: 15.5, fontWeight: "700", color: C.ink }}>
            {clsName} — {studentName}
          </Text>
          {rows.map((r) => (
            <View key={r.n} style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
              <Text style={{ width: 22, fontSize: 12.5, color: C.sub }}>{r.n}.</Text>
              <Text style={{ width: 128, fontSize: 12, color: C.sub }} numberOfLines={1}>
                {r.label}
              </Text>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text
                  style={{
                    fontSize: 14.5,
                    fontStyle: "italic",
                    color: C.ink,
                    textDecorationLine: "underline",
                    textDecorationColor: "#C9CFC8",
                  }}
                >
                  {r.mark}/{qMax}
                </Text>
              </View>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  backgroundColor: r.conf < 85 ? C.amberSoft : C.okBg,
                  borderWidth: 1.2,
                  borderColor: r.conf < 85 ? C.amber : C.okBorder,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 6,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "800", color: r.conf < 85 ? C.amberText : C.green }}>
                  {r.mark}
                </Text>
              </View>
              <Text style={{ width: 26, fontSize: 12, color: C.sub }}>/{qMax}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
            <View style={{ flex: 1 }} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: C.ink, marginRight: 10 }}>{t("total")}</Text>
            {editing ? (
              <TextInput
                value={total}
                onChangeText={(v) => setTotal(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                maxLength={4}
                style={{
                  width: 64,
                  height: 34,
                  borderRadius: 6,
                  borderWidth: 1.6,
                  borderColor: C.green,
                  textAlign: "center",
                  fontSize: 15,
                  fontWeight: "800",
                  color: C.ink,
                }}
                accessibilityLabel={t("correctMark")}
              />
            ) : (
              <View
                style={{
                  width: 38,
                  height: 34,
                  borderRadius: 6,
                  borderWidth: 1.6,
                  borderColor: C.ink,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: "800", color: C.ink }}>{totalNum}</Text>
              </View>
            )}
            <Text style={{ fontSize: 13, color: C.sub, marginLeft: 6 }}>/{maxMark}</Text>
          </View>
        </Card>

        {/* Student summary */}
        <Card style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar text={initialsOf(studentName)} size={44} bg={C.green} fg="#fff" />
          <Text style={{ fontSize: 16, fontWeight: "800", color: C.ink, flex: 1 }} numberOfLines={1}>
            {studentName} · {clsName}
          </Text>
          <Text style={{ fontSize: 16, fontWeight: "800", color: C.green }}>
            {totalNum}/{maxMark}
          </Text>
          <View
            style={{
              backgroundColor: avgConf < 85 ? C.amberSoft : C.greenTint,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: avgConf < 85 ? C.amberText : C.green }}>
              {t("confidence")} {avgConf}%
            </Text>
          </View>
        </Card>

        {/* Per-question list with the 85% human-in-the-loop threshold */}
        {rows.slice(0, 6).map((r) => {
          const low = r.conf < 85;
          return (
            <Press key={r.n} accessibilityLabel={`${t("question")} ${r.n}`}>
              <Card style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: low ? C.orange : C.green,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>{r.n}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }} numberOfLines={1}>
                    Q{r.n} — {r.label}
                  </Text>
                  {low && (
                    <Text style={{ fontSize: 12.5, color: C.orange, marginTop: 2 }}>{t("lowConf")}</Text>
                  )}
                </View>
                <Text style={{ fontSize: 15, fontWeight: "800", color: low ? C.orange : C.green }}>
                  {r.mark}/{qMax}
                </Text>
                <Text style={{ fontSize: 13.5, color: C.sub, width: 40, textAlign: "right" }}>{r.conf}%</Text>
                <ChevronRight size={18} color={C.faint} />
              </Card>
            </Press>
          );
        })}

        <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
          <Btn
            label={t("correctMark")}
            variant="outline"
            icon={<Pencil size={18} color={C.green} />}
            style={{ flex: 1 }}
            onPress={() => setEditing(!editing)}
          />
          <Btn label={t("acceptSheet")} style={{ flex: 1 }} onPress={acceptSheet} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
