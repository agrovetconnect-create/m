import { Archive, Clock3, FilePlus2 } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StatusBar, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Btn, Chip, StatusPill, Chevron, SearchField, fmtDateTime } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { deriveSheets, type SheetRow } from "@/lib/sheets";

/** Generated empty-state art: empty clipboard mark sheet (transparent bg). */
const MARKSHEETS_ART = "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/19233899-e21c-403f-95c9-516727695432.png";

/**
 * Mark Sheets tab built from real, signed records: mark sheets are derived by
 * grouping entries per class + assessment. Search → filters → results, one
 * clean hierarchy, no duplicated titles.
 */
export default function MarkSheetsScreen() {
  const { entries, classList, rosterOf, unsyncedCount } = useStore();
  const { t } = useI18n();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  // Derive mark sheets from real records (grouped + sorted newest first).
  const sheets = useMemo<SheetRow[]>(() => deriveSheets(entries, rosterOf), [entries, rosterOf]);

  const filters = useMemo(
    () => [
      { key: "all", label: t("all") },
      { key: "inProgress", label: t("inProgress") },
      { key: "needsReview", label: t("needsReview") },
      { key: "submitted", label: t("submitted") },
    ],
    [t],
  );

  const shown = sheets
    .filter((s) => filter === "all" || s.status === filter)
    .filter((s) => {
      const cls = classList.find((c) => c.id === s.classId);
      const hay = `${s.assessment} ${s.classId} ${cls?.name ?? ""} ${cls?.subject ?? ""} ${cls?.grade ?? ""}`.toLowerCase();
      return hay.includes(query.trim().toLowerCase());
    });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
      <StatusBar barStyle="dark-content" />

      {/* 1. Search — full input box, plus archive access */}
      <View style={{ paddingHorizontal: 20, paddingTop: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <SearchField value={query} onChange={setQuery} label={t("searchSheets")} placeholder={t("searchSheets")} />
        </View>
        <Press
          onPress={() => router.push("/scan-archive")}
          accessibilityLabel={t("scanArchive")}
          hitSlop={6}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Archive size={22} color={C.green} />
        </Press>
      </View>

      {/* 2. Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 14 }}
      >
        {filters.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            active={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </ScrollView>

      {/* 3. Results */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110, gap: 12, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {unsyncedCount > 0 && (
          <View style={{ alignSelf: "flex-start" }}>
            <StatusPill
              label={`${unsyncedCount} ${t("pending")}`}
              tint={C.yellowTint}
              fg={C.amberText}
            />
          </View>
        )}

        {shown.length === 0 ? (
          sheets.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 80 }}>
              <Image source={{ uri: MARKSHEETS_ART }} style={{ width: 220, height: 220 }} resizeMode="contain" />
              <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22, paddingHorizontal: 24 }}>
                {t("noData")}
              </Text>
              <Btn
                label={t("newMarkSheet")}
                icon={<FilePlus2 size={18} color="#fff" />}
                onPress={() => router.push("/new-marksheet")}
                style={{ height: 50, width: 230, marginTop: 12 }}
              />
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", lineHeight: 22, paddingHorizontal: 24 }}>
                {t("noData")}
              </Text>
            </View>
          )
        ) : (
          shown.map((s) => {
            const cls = classList.find((c) => c.id === s.classId);
            const title = cls ? `${cls.subject || cls.name} · ${cls.grade}` : s.classId;
            return (
              <Press
                key={s.key}
                onPress={() => router.push({ pathname: "/class-detail", params: { classId: s.classId } })}
                accessibilityLabel={`${s.assessment} ${title}`}
              >
                <Card style={{ padding: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ flex: 1, fontSize: 16, fontWeight: "700", color: C.ink }} numberOfLines={1}>
                      {s.assessment}
                    </Text>
                    <SheetChip status={s.status} />
                  </View>
                  <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 6 }}>
                    {title} · {t("enteredOf").replace("{n}", String(s.entered)).replace("{m}", String(s.total))}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 6 }}>
                    <Clock3 size={13} color={C.faint} />
                    <Text style={{ fontSize: 12.5, color: C.faint }}>
                      {t("updated")} {fmtDateTime(s.updatedAt)}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Chevron />
                  </View>
                </Card>
              </Press>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SheetChip({ status }: { status: SheetRow["status"] }) {
  const { t } = useI18n();
  const map: Record<SheetRow["status"], { tint: string; fg: string; label: string }> = {
    submitted: { tint: C.greenChip, fg: C.green, label: t("submitted") },
    needsReview: { tint: C.yellowTint, fg: C.amberText, label: t("needsReview") },
    inProgress: { tint: C.greenChip, fg: C.green, label: t("inProgress") },
  };
  const m = map[status];
  return <StatusPill label={m.label} tint={m.tint} fg={m.fg} />;
}
