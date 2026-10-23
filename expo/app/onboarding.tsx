import React from "react";
import { View, Text, Image, ScrollView, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Press } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

// Real illustration cropped from the approved mockup asset.
const heroImg = require("../assets/images/design/onboard-hero-real.png");

/** Mint/teal palette from the approved mockup. */
const MINT = "#DCF4F0";
const TEAL = "#16B8A8";
const TEAL_INK = "#0E3B35";

export default function OnboardingScreen() {
  const { setSettings } = useStore();
  const { t } = useI18n();
  const start = () => {
    setSettings((s) => ({ ...s, onboarded: true }));
    router.push("/login");
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: MINT }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ paddingHorizontal: 18, paddingTop: 20 }}>
          <Image
            source={heroImg}
            style={{ width: "100%", aspectRatio: 500 / 480, borderRadius: 30 }}
            resizeMode="cover"
            accessible
            accessibilityLabel={t("appName")}
          />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 22, paddingBottom: 26 }}>
          <Text style={{ fontSize: 36, fontWeight: "800", color: TEAL, letterSpacing: 1.5 }}>{t("appName")}</Text>
          <Text style={{ fontSize: 19, fontWeight: "800", color: TEAL_INK, textAlign: "center", marginTop: 10, lineHeight: 26 }}>
            {t("appTagline")}
          </Text>
          <Press
            onPress={start}
            accessibilityLabel={t("getStarted")}
            style={{
              alignSelf: "stretch",
              height: 56,
              borderRadius: 18,
              backgroundColor: TEAL,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 26,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16.5, fontWeight: "700" }}>{t("getStarted")}</Text>
          </Press>
          <Press
            onPress={start}
            accessibilityLabel={t("haveAccount")}
            style={{
              alignSelf: "stretch",
              height: 54,
              borderRadius: 18,
              borderWidth: 1.6,
              borderColor: TEAL,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 12,
            }}
          >
            <Text style={{ color: TEAL, fontSize: 15.5, fontWeight: "700" }}>{t("haveAccount")}</Text>
          </Press>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
