import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StoreProvider, useStore } from "@/lib/store";
import { applyDirection } from "@/lib/i18n";
import { installErrorHandlers, trackEvent } from "@/lib/observability";
import { ThemeProvider, useTheme } from "@/src/design-system/theme";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync();

/** Keeps the OS layout direction in sync with the chosen language (Arabic → RTL). */
function DirectionSync() {
  const { settings } = useStore();
  useEffect(() => {
    applyDirection(settings.language);
  }, [settings.language]);
  return null;
}

/** Keeps the OS status bar legible against the active theme's background. */
function ThemedChrome() {
  const { palette, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="login" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="data-consent" />
          <Stack.Screen name="privacy-policy" />
          <Stack.Screen name="scan" />
          <Stack.Screen name="live-scan" />
          <Stack.Screen name="camera-permission" />
          <Stack.Screen name="sheet-review" />
          <Stack.Screen name="session-complete" />
          <Stack.Screen name="student-match" />
          <Stack.Screen name="marksheet" />
          <Stack.Screen name="class-detail" />
          <Stack.Screen name="class-report" />
          <Stack.Screen name="student-history" />
          <Stack.Screen name="scan-archive" />
          <Stack.Screen name="resolve-conflict" />
          <Stack.Screen name="help-support" />
          <Stack.Screen name="language-picker" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="class-setup" />
          <Stack.Screen name="new-marksheet" />
          <Stack.Screen
            name="request-correction"
            options={{ presentation: "transparentModal" }}
          />
          <Stack.Screen
            name="entry-sheet"
            options={{ presentation: "transparentModal" }}
          />
        </Stack>
      </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Crash capture first, then a session heartbeat — together these give
    // Day 1/7/30 retention and real error rates (nothing third-party; the
    // journal lives on the teacher's own encrypted store + Supabase rows).
    installErrorHandlers();
    trackEvent("session_start");
    SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StoreProvider>
        <DirectionSync />
        <ThemeProvider>
          <ThemedChrome />
        </ThemeProvider>
      </StoreProvider>
    </GestureHandlerRootView>
  );
}
