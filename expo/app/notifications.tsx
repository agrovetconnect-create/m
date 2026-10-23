import { AlertTriangle, Clock } from "lucide-react-native";
import React, { useMemo } from "react";
import { View, Text, ScrollView, StatusBar, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { C, Card, Press, IconTile, ScreenHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

type Item = {
  icon: React.ReactNode;
  tint: string;
  title: string;
  sub: string;
  route?: Href;
};

/** Generated empty-state art: envelope with a notification bell (transparent bg). */
const NOTIFICATIONS_ART = "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/1570741b-1946-42ff-8d1b-1716b469d437.png";

/**
 * Notifications screen: live status derived from the real store — conflicts,
 * flagged records and unsynced entries. Tapping an item opens the related
 * screen; with nothing pending it shows an illustration + text.
 */
export default function NotificationsScreen() {
  const { entries, conflicts, unsyncedCount } = useStore();
  const { t } = useI18n();

  const flagged = entries.filter((e) => e.status !== "confirmed");

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    if (conflicts.length > 0) {
      list.push({
        icon: <AlertTriangle size={20} color={C.amber} />,
        tint: C.yellowTint,
        title: t("notifConflict"),
        sub: `${conflicts.length} ${t("pending")}`,
        route: "/resolve-conflict",
      });
    }
    if (flagged.length > 0) {
      list.push({
        icon: <AlertTriangle size={20} color={C.amber} />,
        tint: C.yellowTint,
        title: t("notifFlagged"),
        sub: `${flagged.length} ${t("needReview")}`,
      });
    }
    if (unsyncedCount > 0) {
      list.push({
        icon: <Clock size={20} color={C.amber} />,
        tint: C.yellowTint,
        title: t("pendingSync"),
        sub: `${unsyncedCount} ${t("pending")}`,
      });
    }
    return list;
  }, [conflicts.length, flagged.length, unsyncedCount, t]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("notifications")} onBack={() => router.back()} accessibilityLabel={t("cancel")} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 60 }}>
            <Image source={{ uri: NOTIFICATIONS_ART }} style={{ width: 220, height: 220 }} resizeMode="contain" />
            <Text style={{ fontSize: 15, color: C.sub, textAlign: "center", paddingHorizontal: 32 }}>
              {t("notifEmpty")}
            </Text>
          </View>
        )}
        {items.map((n, i) => (
          <Press key={i} onPress={() => n.route && router.push(n.route)} accessibilityLabel={n.title}>
            <Card style={{ padding: 14, marginTop: 10, flexDirection: "row", alignItems: "center", gap: 14 }}>
              <IconTile size={48} radius={24} bg={n.tint}>
                {n.icon}
              </IconTile>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15.5, fontWeight: "700", color: C.ink }}>{n.title}</Text>
                <Text style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>{n.sub}</Text>
              </View>
            </Card>
          </Press>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
