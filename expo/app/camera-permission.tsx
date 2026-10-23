import { X, Camera } from "lucide-react-native";
import React from "react";
import { View, Text, StatusBar, Image, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { C, Press, Btn } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/** Generated ready-to-scan art: phone with viewfinder over an answer sheet (transparent bg). */
const READY_ART = "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/a73a58e9-4f6e-41d8-9ad6-bb391cc94806.png";

export default function CameraPermissionScreen() {
  const { t } = useI18n();

  /** Asks for the OS camera permission only when it isn't decided yet — never re-prompts. */
  const allow = async () => {
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await ImagePicker.requestCameraPermissionsAsync();
      }
      if (perm.granted) {
        router.push("/scan");
      } else {
        Alert.alert(t("allowCamera"), t("blockedSettings"), [
          { text: t("cancel"), style: "cancel" },
          { text: t("blockedSettings"), onPress: () => void Linking.openSettings() },
        ]);
      }
    } catch {
      router.push("/scan");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <View style={{ alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 8 }}>
        <Press onPress={() => router.back()} accessibilityLabel={t("cancel")}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.greenTint, alignItems: "center", justifyContent: "center" }}>
            <X size={22} color={C.green} strokeWidth={2.4} />
          </View>
        </Press>
      </View>

      {/* Ready to scan: one illustration, two decisions */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, paddingBottom: 40 }}>
        <Image source={{ uri: READY_ART }} style={{ width: 240, height: 240 }} resizeMode="contain" />
        <Text style={{ fontSize: 28, fontWeight: "800", color: C.ink, marginTop: 10 }}>
          {t("readyToScan")}
        </Text>

        <Btn
          label={t("allowCamera")}
          icon={<Camera size={20} color="#fff" />}
          onPress={() => void allow()}
          style={{ marginTop: 28, alignSelf: "stretch" }}
        />
        <Btn
          label={t("enterManually")}
          onPress={() => router.push("/entry-sheet")}
          style={{ marginTop: 12, alignSelf: "stretch" }}
        />
      </View>
    </SafeAreaView>
  );
}
