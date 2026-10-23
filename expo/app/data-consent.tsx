import { FileText, ChevronRight, X, ShieldCheck } from "lucide-react-native";
import { Image } from "react-native";
import React, { useState } from "react";
import { View, Text, ScrollView, StatusBar, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Card, Press, Btn, IconTile, Chevron } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

export default function DataConsentScreen() {
  const { settings, setSettings } = useStore();
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(settings.consentAccepted);
  const [openSection, setOpenSection] = useState<"policy" | "retention" | null>(null);

  const accept = () => {
    setSettings((s) => ({ ...s, consentAccepted: true }));
    router.replace("/(tabs)/home");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "flex-end" }}>
          <Press onPress={() => router.replace("/login")} accessibilityLabel={t("cancel")}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.greenTint, alignItems: "center", justifyContent: "center" }}>
              <X size={22} color={C.green} strokeWidth={2.4} />
            </View>
          </Press>
        </View>

        <View style={{ alignItems: "center", marginTop: 8 }}>
          <Image
            source={require("../assets/images/design/dc-shield.png")}
            style={{ width: 104, height: 118 }}
            resizeMode="contain"
          />
          <Text style={{ fontSize: 26, fontWeight: "800", color: C.ink, marginTop: 20 }}>
            {t("beforeWeBegin")}
          </Text>
          <Text style={{ fontSize: 15.5, color: C.sub, marginTop: 6 }}>{t("dataHandled")}</Text>
        </View>

        <Card style={{ padding: 8, marginTop: 26 }}>
          <ConsentRow
            icon={<Image source={require("../assets/images/design/dc-stored.png")} style={{ width: 52, height: 52 }} resizeMode="contain" />}
            title={t("storedTitle")}
            desc={t("storedDesc")}
          />
          <View style={{ height: 1, backgroundColor: C.line, marginHorizontal: 12 }} />
          <ConsentRow
            icon={<Image source={require("../assets/images/design/dc-visible.png")} style={{ width: 52, height: 52 }} resizeMode="contain" />}
            title={t("visibleTitle")}
            desc={t("visibleDesc")}
          />
          <View style={{ height: 1, backgroundColor: C.line, marginHorizontal: 12 }} />
          <ConsentRow
            icon={<Image source={require("../assets/images/design/dc-never.png")} style={{ width: 52, height: 52 }} resizeMode="contain" />}
            title={t("neverTitle")}
            desc={t("neverDesc")}
          />
        </Card>

        <Press
          onPress={() => setOpenSection(openSection === "policy" ? null : "policy")}
          accessibilityLabel={t("readPolicy")}
          style={{ flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 12 }}
        >
          <FileText size={21} color={C.ink} />
          <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("readPolicy")}</Text>
          <Chevron color={C.sub} />
        </Press>
        {openSection === "policy" && (
          <Text style={{ fontSize: 14, color: C.sub, lineHeight: 21, paddingBottom: 12 }}>{t("policyBody")}</Text>
        )}
        <View style={{ height: 1, backgroundColor: C.line }} />
        <Press
          onPress={() => setOpenSection(openSection === "retention" ? null : "retention")}
          accessibilityLabel={t("retentionTerms")}
          style={{ flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 12 }}
        >
          <ShieldCheck size={21} color={C.ink} />
          <Text style={{ flex: 1, fontSize: 15.5, fontWeight: "600", color: C.ink }}>{t("retentionTerms")}</Text>
          <Chevron color={C.sub} />
        </Press>
        {openSection === "retention" && (
          <Text style={{ fontSize: 14, color: C.sub, lineHeight: 21, paddingBottom: 12 }}>{t("retentionBody")}</Text>
        )}

        <Pressable
          onPress={() => setAgreed(!agreed)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel={t("iAgree")}
          style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: agreed ? C.green : C.borderOff,
              backgroundColor: agreed ? C.green : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {agreed && <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>✓</Text>}
          </View>
          <Text style={{ flex: 1, fontSize: 15, color: C.ink }}>{t("iAgree")}</Text>
        </Pressable>

        <Btn label={t("continueLabel")} disabled={!agreed} onPress={accept} />
        <Press onPress={() => router.replace("/login")} style={{ alignItems: "center", paddingVertical: 18 }} accessibilityLabel={t("decline")}>
          <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.red }}>{t("decline")}</Text>
        </Press>
      </ScrollView>
    </SafeAreaView>
  );
}

function ConsentRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, padding: 14, alignItems: "center" }}>
      <IconTile size={52} radius={26} bg={C.bg}>
        {icon}
      </IconTile>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15.5, fontWeight: "800", color: C.ink }}>{title}</Text>
        <Text style={{ fontSize: 14, color: C.sub, marginTop: 3, lineHeight: 20 }}>{desc}</Text>
      </View>
    </View>
  );
}
