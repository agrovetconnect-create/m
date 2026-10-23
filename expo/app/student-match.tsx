import { CheckCircle2, XCircle, FileText, ChevronRight } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Btn, Avatar, StatusPill, IconTile, initialsOf } from "@/components/ui";
import { lastDetection } from "@/lib/ai";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Confirm the scanned sheet matches the detected student; the confirmed name flows into the record. */
export default function StudentMatchScreen() {
  const { t } = useI18n();
  const { rosterOf } = useStore();
  const det = lastDetection.current;
  const ctx = lastDetection.context;
  const detectedName = det?.studentName ?? "";
  const cls = ctx?.classId ?? det?.className ?? "";
  const assessment = ctx?.assessment ?? "—";

  // Real roster from the store — no sample fallback.
  const roster = rosterOf(cls).map((s) => s.name);

  // Fuzzy-match the handwriting read to the class roster (first-name + surname containment).
  const matched = useMemo(() => {
    const q = detectedName.trim().toLowerCase();
    return (
      roster.find((n) => n.toLowerCase() === q) ??
      roster.find((n) => n.toLowerCase().includes(q.split(/\s+/)[0] ?? "~~~")) ??
      detectedName
    );
  }, [detectedName, roster]);

  const [selected, setSelected] = useState(matched);
  const [picking, setPicking] = useState(false);

  const avgConf = det
    ? Math.round(det.questions.reduce((s, q) => s + q.confidence, 0) / Math.max(1, det.questions.length))
    : 0;

  const confirm = () => {
    router.push({ pathname: "/sheet-review", params: { studentName: selected } });
  };

  if (!det) {
    // No real AI read in progress — nothing to match against, nothing fake to show.
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 24, fontWeight: "800", color: C.ink, marginTop: 12 }}>
          {t("matchFound")}
        </Text>
        <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 6 }}>
          {t("matchedIn")} {cls}
        </Text>

        <Card style={{ padding: 16, marginTop: 20, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <IconTile size={56} radius={14} bg={C.fieldBg}>
            <FileText size={26} color={C.green} />
          </IconTile>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14.5, fontWeight: "700", color: C.ink }}>
              {cls ? `${cls} · ` : ""}
              {assessment}
            </Text>
            <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 3 }}>
              {t("handwriting")} "{detectedName}"
            </Text>
            <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
              <StatusPill label={`${t("confidence")} ${avgConf}%`} />
            </View>
          </View>
        </Card>

        <Card
          style={{
            padding: 16,
            marginTop: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            borderWidth: 1.5,
            borderColor: C.green,
          }}
        >
          <Avatar text={initialsOf(selected)} size={48} bg={C.greenTint} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16.5, fontWeight: "800", color: C.ink }}>{selected}</Text>
            <Text style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>
              {cls} · {roster.length} {t("students")}
            </Text>
          </View>
          <CheckCircle2 size={24} color={C.green} />
        </Card>

        <Press
          onPress={() => setPicking(!picking)}
          accessibilityLabel={t("notRightStudent")}
          style={{ marginTop: 12 }}
        >
          <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar text="?" size={40} bg={C.chipGrey} fg={C.sub} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }}>{t("notRightStudent")}</Text>
              <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>{t("pickManually")}</Text>
            </View>
            <ChevronRight
              size={18}
              color={C.faint}
              style={{ transform: [{ rotate: picking ? "90deg" : "0deg" }] }}
            />
          </Card>
        </Press>

        {picking && (
          <Card style={{ marginTop: 8, overflow: "hidden" }}>
            {roster.map((n, i) => (
              <Press
                key={n}
                onPress={() => {
                  setSelected(n);
                  setPicking(false);
                }}
                accessibilityLabel={n}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 14,
                    gap: 12,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: C.line,
                    backgroundColor: selected === n ? C.greenTint : "transparent",
                  }}
                >
                  <Avatar text={initialsOf(n)} size={36} />
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: C.ink }}>{n}</Text>
                  {selected === n && <CheckCircle2 size={20} color={C.green} />}
                </View>
              </Press>
            ))}
          </Card>
        )}

        {roster.length === 0 && (
          <Text style={{ fontSize: 13.5, color: C.amberText, marginTop: 12, textAlign: "center" }}>
            {t("noRosterYet")}
          </Text>
        )}

        <View style={{ marginTop: 28 }}>
          <Btn label={t("confirmMatch")} icon={<CheckCircle2 size={20} color="#fff" />} onPress={confirm} />
          <Btn
            label={t("rescanSheet")}
            variant="outline"
            icon={<XCircle size={20} color={C.green} />}
            onPress={() => router.replace("/scan")}
            style={{ marginTop: 12 }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
