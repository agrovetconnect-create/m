import { Calendar, Upload, Check, Clock, ChevronRight } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Btn, Chip, StatusPill, IconTile, ScreenHeader, SearchField } from "@/components/ui";
import { shareCsv } from "@/lib/share";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Generated empty-state art: archive folder with scanned papers (transparent bg). */
const SCAN_ARCHIVE_ART = "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/aa2ad6c6-efa0-4bb8-ad27-b3ff1e8916ae.png";

type Session = {
  key: string;
  date: Date;
  assessment: string;
  classId: string;
  total: number;
  syncedCount: number;
  flagged: number;
  allSynced: boolean;
};

/** Archive of capture sessions, grouped from real signed entries. */
export default function ScanArchiveScreen() {
  const { entries } = useStore();
  const { t } = useI18n();
  const [term, setTerm] = useState("thisTerm");
  const [query, setQuery] = useState("");

  const sessions = useMemo<Session[]>(() => {
    const map = new Map<string, Session>();
    for (const e of entries) {
      const key = `${e.assessment}|${e.classId}`;
      const s =
        map.get(key) ??
        ({
          key,
          date: new Date(e.createdAt),
          assessment: e.assessment,
          classId: e.classId,
          total: 0,
          syncedCount: 0,
          flagged: 0,
          allSynced: true,
        } as Session);
      s.total += 1;
      if (e.synced) s.syncedCount += 1;
      if (e.status !== "confirmed") s.flagged += 1;
      if (!e.synced) s.allSynced = false;
      if (new Date(e.createdAt) < s.date) s.date = new Date(e.createdAt);
      map.set(key, s);
    }
    return [...map.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [entries]);

  const shown = useMemo(
    () =>
      sessions
        .filter((s) => {
          if (term === "thisTerm") return Date.now() - s.date.getTime() <= 30 * 24 * 60 * 60 * 1000;
          if (term === "lastTerm") return Date.now() - s.date.getTime() > 30 * 24 * 60 * 60 * 1000;
          return true;
        })
        .filter((s) =>
          `${s.assessment} ${s.classId}`.toLowerCase().includes(query.trim().toLowerCase()),
        ),
    [sessions, term, query],
  );

  const exportCsv = () => {
    void shareCsv(
      "assessment,class,records,synced,flagged,date",
      sessions.map((s) => [s.assessment, s.classId, s.total, s.syncedCount, s.flagged, s.date.toISOString()]),
    );
  };

  const terms = [
    { key: "thisTerm", label: t("thisTerm") },
    { key: "lastTerm", label: t("lastTerm") },
    { key: "all", label: t("all") },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("scanArchive")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
        <SearchField value={query} onChange={setQuery} label={t("searchSessions")} placeholder={t("searchSessions")} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 14 }}>
        {terms.map((tr) => (
          <Chip key={tr.key} label={tr.label} active={term === tr.key} onPress={() => setTerm(tr.key)} />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {shown.length === 0 && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 80 }}>
            <Image source={{ uri: SCAN_ARCHIVE_ART }} style={{ width: 220, height: 220 }} resizeMode="contain" />
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22, paddingHorizontal: 24 }}>
              {t("noScansYet")}
            </Text>
          </View>
        )}
        {shown.map((s) => (
          <Press key={s.key} accessibilityLabel={`${s.assessment} ${s.classId}`}>
            <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}>
              <IconTile size={48} radius={14} bg={C.greenTint}>
                <Calendar size={22} color={C.ink} />
              </IconTile>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }} numberOfLines={1}>
                  {s.classId} · {s.assessment}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <Text style={{ fontSize: 13, color: C.sub }}>
                    {s.total} {t("sheets")} · {s.syncedCount}{" "}
                    <Text style={{ color: C.green, fontWeight: "700" }}>✓</Text>
                    {s.flagged > 0 ? `  ${s.flagged} ${t("flaggedCount")}` : ""}
                  </Text>
                </View>
              </View>
              {s.allSynced ? (
                <StatusPill label={t("synced")} icon={<Check size={12} color={C.green} />} />
              ) : (
                <StatusPill label={t("pending")} tint={C.yellowTint} fg={C.amberText} icon={<Clock size={12} color={C.amber} />} />
              )}
              <ChevronRight size={18} color={C.faint} />
            </Card>
          </Press>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Btn
          label={t("exportCsv")}
          variant="outline"
          icon={<Upload size={20} color={C.ink} />}
          onPress={exportCsv}
          disabled={sessions.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}
