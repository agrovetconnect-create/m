import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Platform, ScrollView, StatusBar, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { C, Btn, Card, Press, ScreenHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import {
  autoMap,
  buildImportPreview,
  canConfirm,
  detectHeaderRow,
  parseImportFile,
  planImport,
  type ImportPreview,
  type ParsedFile,
  type RowChoice,
} from "@/src/domain/import";
import { findDuplicateClass } from "@/src/domain/register-management";

/**
 * Import Wizard (Stage 4): pick a .xlsx/.csv file → pick worksheet → check the
 * column mapping → review every row with real issues → resolve duplicates
 * explicitly → confirm → truthful summary. Nothing is written to the store
 * until the teacher confirms, and then in ONE atomic students write.
 */

type Step = "class" | "file" | "map" | "review" | "done";

const ISSUE_KEY: Record<string, string> = {
  missing_name: "issueMissingName",
  duplicate_ref_in_file: "issueDupRef",
  duplicate_name_in_file: "issueDupName",
  oversized: "issueOversized",
  possible_existing_student: "issuePossibleExisting",
};

export default function ImportWizardScreen() {
  const { t } = useI18n();
  const { classList, addClass, importStudents, students } = useStore();
  const params = useLocalSearchParams<{ classId?: string; name?: string; subject?: string; grade?: string }>();

  const presetClassId = params.classId ?? "";
  const [newName, setNewName] = useState(params.name ?? "");
  const [newSubject, setNewSubject] = useState(params.subject ?? "");
  const [newGrade, setNewGrade] = useState(params.grade ?? "");
  const [classId, setClassId] = useState(presetClassId);

  const [step, setStep] = useState<Step>(presetClassId ? "file" : "class");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [tableIdx, setTableIdx] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<{ name: number; ref: number | null } | null>(null);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [summary, setSummary] = useState<ReturnType<typeof planImport>["summary"] | null>(null);

  const rows = parsed?.ok ? parsed.tables[tableIdx].rows : [];
  const headerRow = hasHeader ? Math.max(0, detectHeaderRow(rows)) : -1;
  const headers = headerRow >= 0 ? rows[headerRow].map((c) => c.trim()) : [];
  const effectiveMapping = mapping ?? (headers.length > 0 ? autoMap(headers) : { name: 0, ref: null });

  const preview: ImportPreview = useMemo(
    () => buildImportPreview({ rows, headerRow, mapping: effectiveMapping, existing: students }),
    // rows identity changes with parse/table/step; safe to recompute on render path
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, headerRow, effectiveMapping.name, effectiveMapping.ref, students],
  );

  const choiceMap = useMemo(() => new Map(Object.entries(choices).map(([k, v]) => [Number(k), v])), [choices]);
  const plan = useMemo(() => planImport(preview, choiceMap), [preview, choiceMap]);
  const confirmable = canConfirm(preview, choiceMap);

  // --- File picking (platform-appropriate) -----------------------------------

  const readFile = useCallback(
    async (name: string, bytes: Uint8Array) => {
      const p = parseImportFile(name, bytes);
      if (!p.ok) {
        const msg = p.reason === "unsupported_format" ? t("importErrUnsupported") : p.reason === "too_large" ? t("importErrTooLarge") : t("importErrMalformed");
        Alert.alert(t("excelBadTitle"), msg);
        return;
      }
      setParsed(p);
      setTableIdx(0);
      setHasHeader(true);
      setMapping(null);
      setChoices({});
      setStep("map");
    },
    [t],
  );

  const pickWeb = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.csv,.txt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.arrayBuffer().then((buf) => void readFile(file.name, new Uint8Array(buf)));
    };
    input.click();
  }, [readFile]);

  const pickNative = useCallback(async () => {
    try {
      const { StorageAccessFramework } = await import("expo-file-system/legacy");
      const perms = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perms.granted) return;
      const files = await StorageAccessFramework.readDirectoryAsync(perms.directoryUri);
      const usable = files.filter((u) => /\.(xlsx|csv|txt)$/i.test(u));
      if (usable.length === 0) {
        Alert.alert(t("excelBadTitle"), t("excelNoFiles"));
        return;
      }
      const pick = (uri: string) => {
        void StorageAccessFramework.readAsStringAsync(uri, { encoding: "base64" }).then((b64) => {
          const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
          void readFile(uri.split("/").pop() ?? "register.xlsx", bin);
        });
      };
      if (usable.length === 1) {
        pick(usable[0]);
        return;
      }
      // Several usable files — the teacher chooses; nothing is auto-selected.
      Alert.alert(t("excelPickFile"), "", [
        ...usable.slice(0, 4).map((uri) => ({
          text: (uri.split("/").pop() ?? uri).slice(0, 60),
          onPress: () => pick(uri),
        })),
        { text: t("cancel"), style: "cancel" as const },
      ]);
    } catch {
      Alert.alert(t("excelBadTitle"), t("excelUnavailable"));
    }
  }, [readFile, t]);

  const pickFile = () => void (Platform.OS === "web" ? pickWeb() : pickNative());

  // --- Confirm (the only write path) ------------------------------------------

  const confirm = () => {
    let target = classId;
    if (!target) {
      const dup = findDuplicateClass({ name: newName.trim(), grade: newGrade.trim() }, classList);
      if (dup) {
        Alert.alert(t("importChooseClass"), `${dup.name} · ${dup.grade}`);
        setClassId(dup.id);
        target = dup.id;
      } else {
        target = addClass(newName.trim(), newSubject.trim() || newName.trim(), newGrade.trim() || newName.trim()).id;
        setClassId(target);
      }
    }
    const committed = importStudents(target, plan.creates, plan.updates);
    setSummary({ ...plan.summary, committed });
    setStep("done");
  };

  // --- Render -----------------------------------------------------------------

  if (step === "done" && summary) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
        <StatusBar barStyle="dark-content" />
        <ScreenHeader title={t("importDoneTitle")} onBack={() => router.replace("/(tabs)/home")} accessibilityLabel={t("done")} />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          <Card style={{ padding: 24, alignItems: "center", marginTop: 10 }}>
            <CheckCircle2 size={44} color={C.green} />
            <Text style={{ fontSize: 19, fontWeight: "800", color: C.ink, marginTop: 12 }}>{t("importDoneTitle")}</Text>
            <Text style={{ fontSize: 14.5, color: C.sub, textAlign: "center", marginTop: 6, lineHeight: 21 }}>
              {t("importSummary")
                .replace("{created}", String(summary.newStudents))
                .replace("{updated}", String(summary.updated))
                .replace("{skipped}", String(summary.skippedRows))
                .replace("{invalid}", String(summary.invalidRows))}
            </Text>
          </Card>
          <Btn label={t("done")} onPress={() => router.replace("/(tabs)/home")} style={{ marginTop: 18 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("importWizardTitle")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {step === "class" && (
          <>
            <Text style={{ fontSize: 14.5, color: C.sub }}>{t("importChooseClass")}</Text>
            <Card style={{ overflow: "hidden" }}>
              {classList.map((c, i) => (
                <Press
                  key={c.id}
                  onPress={() => {
                    setClassId(c.id);
                    setStep("file");
                  }}
                  style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", padding: 15 }}>
                    {classId === c.id && <CheckCircle2 size={22} color={C.green} />}
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: C.ink }}>
                      {c.subject || c.name} · {c.grade}
                    </Text>
                  </View>
                </Press>
              ))}
            </Card>
            <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 6 }}>{t("importNewClass")}</Text>
            <Field label={t("classListName")} value={newName} onChange={setNewName} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field label={t("subjectLabel")} value={newSubject} onChange={setNewSubject} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t("gradeLabel")} value={newGrade} onChange={setNewGrade} />
              </View>
            </View>
            <Btn
              label={t("importNewClass")}
              disabled={!newName.trim()}
              onPress={() => setStep("file")}
              style={{ marginTop: 6 }}
            />
          </>
        )}

        {step === "file" && (
          <>
            <Text style={{ fontSize: 14.5, color: C.sub, lineHeight: 21 }}>{t("importPickHint")}</Text>
            <Btn label={t("uploadFile")} icon={<FileSpreadsheet size={20} color="#fff" />} onPress={pickFile} />
            {parsed?.ok && parsed.tables.length > 1 && (
              <>
                <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 6 }}>{t("importSheetPick")}</Text>
                <Card style={{ overflow: "hidden" }}>
                  {parsed.tables.map((tab, i) => (
                    <Press
                      key={`${tab.name}-${i}`}
                      onPress={() => {
                        setTableIdx(i);
                        setMapping(null);
                        setChoices({});
                      }}
                      style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", padding: 15, gap: 10 }}>
                        <FileText size={18} color={C.green} />
                        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: C.ink }}>{tab.name}</Text>
                        <Text style={{ fontSize: 13, color: C.sub }}>{t("excelRows").replace("{n}", String(tab.rows.length))}</Text>
                      </View>
                    </Press>
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        {step === "map" && (
          <>
            <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: C.ink }}>{t("importHeaderIsFirst")}</Text>
              </View>
              <Switch
                value={hasHeader}
                onValueChange={(v) => {
                  setHasHeader(v);
                  setMapping(null);
                  setChoices({});
                }}
                trackColor={{ true: C.green, false: C.chipGrey }}
              />
            </Card>
            {hasHeader && (
              <>
                <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>{t("importMappingTitle")}</Text>
                <Text style={{ fontSize: 13.5, color: C.sub, marginTop: -6, lineHeight: 19 }}>{t("importMappingNote")}</Text>
                <ColumnPicker
                  label={t("excelNameCol")}
                  headers={headers}
                  selected={effectiveMapping.name}
                  onSelect={(i) => setMapping({ ...effectiveMapping, name: i ?? effectiveMapping.name })}
                />
                <ColumnPicker
                  label={t("excelIdCol")}
                  headers={headers}
                  selected={effectiveMapping.ref}
                  allowNone
                  onSelect={(i) => setMapping({ ...effectiveMapping, ref: i })}
                />
                <Btn label={t("importPreviewTitle")} onPress={() => setStep("review")} style={{ marginTop: 6 }} />
              </>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>{t("importPreviewTitle")}</Text>
            {preview.records.length === 0 && (
              <Card style={{ padding: 20, alignItems: "center" }}>
                <Text style={{ fontSize: 14.5, color: C.sub, textAlign: "center" }}>{t("importNoRecords")}</Text>
              </Card>
            )}
            {(preview.errorCount > 0 || preview.warningCount > 0) && (
              <Card style={{ padding: 14, backgroundColor: C.amberChip, flexDirection: "row", gap: 10, alignItems: "center" }}>
                <AlertTriangle size={18} color={C.amber} />
                <Text style={{ flex: 1, fontSize: 13.5, color: C.amberText, lineHeight: 19 }}>
                  {t("importDuplicatesNeedChoice")}
                </Text>
              </Card>
            )}
            {preview.records.map((rec) => {
              const err = rec.issues.find((i) => i.severity === "error");
              const warn = rec.issues.find((i) => i.severity === "warning");
              const refMatch = rec.matches.find((m) => m.reason === "same_ref");
              const chosen = choices[String(rec.row)];
              return (
                <Card key={rec.row} style={{ padding: 14, borderColor: err ? C.amber : C.line, borderWidth: err ? 1.4 : 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink, flex: 1 }} numberOfLines={1}>
                      {rec.name || "—"}
                    </Text>
                    <Text style={{ fontSize: 12.5, color: C.faint }}>{t("importRowLabel").replace("{n}", String(rec.row))}</Text>
                  </View>
                  {rec.ref ? <Text style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{rec.ref}</Text> : null}
                  {(err ?? warn) && (
                    <Text style={{ fontSize: 13, color: err ? C.amberText : C.sub, marginTop: 6 }}>
                      {t(ISSUE_KEY[(err ?? warn)!.reason] ?? "")} — {(err ?? warn)!.detail}
                    </Text>
                  )}
                  {refMatch && (
                    <Text style={{ fontSize: 13, color: C.sub, marginTop: 6 }}>
                      {refMatch.existingName} · {refMatch.existingRef}
                    </Text>
                  )}
                  {(err || refMatch) && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      <Chip label={t("importChoiceSkip")} active={chosen === "skip"} onPress={() => setChoices((c) => ({ ...c, [String(rec.row)]: "skip" }))} />
                      {refMatch && (
                        <Chip label={t("importChoiceUpdate")} active={chosen === "update"} onPress={() => setChoices((c) => ({ ...c, [String(rec.row)]: "update" }))} />
                      )}
                      <Chip label={t("importChoiceKeepBoth")} active={chosen === "keep_both"} onPress={() => setChoices((c) => ({ ...c, [String(rec.row)]: "keep_both" }))} />
                    </View>
                  )}
                </Card>
              );
            })}
            <Btn
              label={t("importConfirm").replace("{n}", String(plan.summary.committed))}
              onPress={confirm}
              disabled={!confirmable || plan.summary.committed === 0}
              style={{ marginTop: 8 }}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <View>
      <Text style={{ fontSize: 14.5, color: C.sub, marginBottom: 8 }}>{label}</Text>
      <Card style={{ paddingVertical: 6, borderWidth: 1.4, borderColor: C.line }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          style={{ fontSize: 16, color: C.ink, paddingHorizontal: 15, paddingVertical: 9, height: 44 }}
          accessibilityLabel={label}
        />
      </Card>
    </View>
  );
}

function ColumnPicker({
  label,
  headers,
  selected,
  allowNone,
  onSelect,
}: {
  label: string;
  headers: string[];
  selected: number | null;
  allowNone?: boolean;
  onSelect: (i: number | null) => void;
}) {  const { t } = useI18n();
  return (
    <View>
      <Text style={{ fontSize: 14.5, color: C.sub, marginBottom: 8 }}>{label}</Text>
      <Card style={{ overflow: "hidden" }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row" }}>
          {allowNone && (
            <Press onPress={() => onSelect(null)} accessibilityLabel={t("importNone")}>
              <View style={{ padding: 14, borderBottomWidth: 0, borderRightWidth: 1, borderRightColor: C.line }}>
                <Text style={{ fontSize: 14.5, fontWeight: selected === null ? "800" : "500", color: selected === null ? C.green : C.sub }}>
                  {t("importNone")}
                </Text>
              </View>
            </Press>
          )}
          {headers.map((h, i) => (
            <Press key={`${h}-${i}`} onPress={() => onSelect(i)} accessibilityLabel={`${label}: ${h}`}>
              <View style={{ padding: 14, borderRightWidth: 1, borderRightColor: C.line }}>
                <Text style={{ fontSize: 14.5, fontWeight: selected === i ? "800" : "500", color: selected === i ? C.green : C.ink }} numberOfLines={1}>
                  {h || `#${i + 1}`}
                </Text>
              </View>
            </Press>
          ))}
        </ScrollView>
      </Card>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label}>
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: active ? C.green : C.chipGrey,
          borderWidth: 1,
          borderColor: active ? C.green : C.line,
        }}
      >
        <Text style={{ fontSize: 13.5, fontWeight: "600", color: active ? "#fff" : C.ink }}>{label}</Text>
      </View>
    </Press>
  );
}
