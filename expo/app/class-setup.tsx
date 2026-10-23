import { FolderOpen } from "lucide-react-native";
import React, { useState } from "react";
import { ScrollView, StatusBar, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Btn, Card, ScreenHeader, Illu } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/**
 * Class/file setup (spec screen 4), simplified: class details on top, then a
 * single button that routes to the full Import Wizard (.xlsx/.csv with sheet
 * choice, column mapping, preview, duplicate resolution and a truthful
 * summary). One import path — never two competing ones. The class itself is
 * created by the wizard at confirm time, so canceling an import never leaves
 * an empty orphan class behind.
 */
export default function ClassSetupScreen() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("classSetup")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Field label={t("classListName")} value={name} onChange={setName} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label={t("subjectLabel")} value={subject} onChange={setSubject} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t("gradeLabel")} value={grade} onChange={setGrade} />
          </View>
        </View>

        <Text style={{ fontSize: 14.5, color: C.sub, marginTop: 8 }}>{t("uploadExcel")}</Text>
        <Illu name="classSetup" label={t("excelHint")} />
        <Btn
          label={t("uploadFile")}
          icon={<FolderOpen size={20} color="#fff" />}
          onPress={() =>
            router.push({
              pathname: "/import-wizard",
              params: { name: name.trim(), subject: subject.trim(), grade: grade.trim() },
            })
          }
          style={{ marginTop: 10 }}
        />
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
