import { Redirect } from "expo-router";
import React from "react";
import { View } from "react-native";
import { useStore } from "@/lib/store";

/** Routes to onboarding on first launch, then login (unless a session exists), then home. */
export default function Index() {
  const { ready, settings, session } = useStore();
  if (!ready) return <View style={{ flex: 1, backgroundColor: "#F0F3EF" }} />;
  if (!settings.onboarded) return <Redirect href="/onboarding" />;
  if (session || settings.offlineSession) return <Redirect href="/(tabs)/home" />;
  return <Redirect href="/login" />;
}
