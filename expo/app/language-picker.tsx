import { Check, Languages } from "lucide-react-native";
import React, { useState } from "react";
import { View, Text, ScrollView, StatusBar, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, ScreenHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n, applyDirection } from "@/lib/i18n";

const languages = [
  { code: "en", name: "English", native: "English" },
  { code: "fr", name: "French", native: "Français" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "ar", name: "Arabic", native: "العربية" },
];

export default function LanguagePickerScreen() {
  const { settings, setSettings } = useStore();
  const { t } = useI18n();
  const [sel, setSel] = useState<string>(settings.language);

  const choose = (code: string) => {
    setSel(code);
    setSettings((s) => ({ ...s, language: code }));
    const rtl = applyDirection(code);
    if (rtl) {
      Alert.alert("العربية", t("rtlAlert"));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("language")} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Card style={{ overflow: "hidden" }}>
          {languages.map((l, i) => (
            <Pressable
              key={l.code}
              onPress={() => choose(l.code)}
              style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
              accessible
              accessibilityRole="radio"
              accessibilityState={{ selected: sel === l.code }}
              accessibilityLabel={l.native}
            >
              <View style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16.5, fontWeight: "700", color: C.ink }}>{l.native}</Text>
                  <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>{l.name}</Text>
                </View>
                {sel === l.code && (
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.green, alignItems: "center", justifyContent: "center" }}>
                    <Check size={16} color="#fff" strokeWidth={3} />
                  </View>
                )}
              </View>
            </Pressable>
          ))}
        </Card>

        <Card style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Languages size={20} color={C.sub} />
          <Text style={{ flex: 1, fontSize: 13.5, color: C.sub }}>{t("rtlNote")}</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
