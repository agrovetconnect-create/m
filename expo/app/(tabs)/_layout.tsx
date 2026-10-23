import { Tabs } from "expo-router";
import { Home, ClipboardList, BarChart3 } from "lucide-react-native";
import React from "react";
import { C } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/src/design-system/theme";

/**
 * Main navigation: three tabs with a consistent icon + label style.
 * Profile lives on its own screen, reached from the home header icon.
 * Active tint is the brand green; no pill backgrounds or duplicated titles.
 */
export default function TabsLayout() {
  const { t } = useI18n();
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.sub,
        tabBarStyle: {
          backgroundColor: palette.bg,
          borderTopWidth: 1,
          borderTopColor: palette.line,
          height: 84,
          paddingBottom: 22,
          paddingTop: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: "600" },
        tabBarIconStyle: { marginBottom: 2 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("home"),
          tabBarAccessibilityLabel: t("home"),
          tabBarIcon: ({ focused }: { focused: boolean; color: string }) => (
            <Home size={23} color={focused ? C.green : C.sub} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="marksheets"
        options={{
          title: t("markSheets"),
          tabBarAccessibilityLabel: t("markSheets"),
          tabBarIcon: ({ focused }: { focused: boolean; color: string }) => (
            <ClipboardList size={23} color={focused ? C.green : C.sub} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t("reports"),
          tabBarAccessibilityLabel: t("reports"),
          tabBarIcon: ({ focused }: { focused: boolean; color: string }) => (
            <BarChart3 size={23} color={focused ? C.green : C.sub} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
    </Tabs>
  );
}
