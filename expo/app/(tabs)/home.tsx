import {
  RefreshCw,
  Calculator,
  FlaskConical,
  BookOpen,
  FilePlus2,
  ChevronRight,
  Camera,
  Bell,
  AlertTriangle,
  Plus,
} from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StatusBar, Animated, Image, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { C, Press, IconTile, Progress, StatusPill, Chevron, Logo, Avatar, initialsOf } from "@/components/ui";
import { useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

/** Generated empty-state art: teacher's desk with an open grade book (transparent bg). */
const NO_CLASSES_YET_ART = "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/73f599db-27e0-4b51-a46e-a8007176f5ef.png";

type CardData = {
  id: string;
  subject: string;
  grade: string;
  students: number;
  status: "not_started" | "in_progress" | "submitted";
  progress?: number;
};

export default function HomeScreen() {
  const {
    session,
    entries,
    unsyncedCount,
    unsyncedOldestAt,
    settings,
    classList,
    rosterOf,
    syncNow,
    syncing,
  } = useStore();
  const { t } = useI18n();
  // Speed-dial FAB: one main button expands into the three quick actions.
  const [fabOpen, setFabOpen] = useState(false);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("greetingMorning") : hour < 18 ? t("greetingAfternoon") : t("greetingEvening");
  const name = session?.name ?? t("teacher");
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "long" });
  const hasPending = unsyncedCount > 0;

  // Real classes from the store with live progress from signed entries.
  // No sample data: an empty store shows the create-class prompt.
  const cards: CardData[] = classList.map((c) => {
    const ces = entries.filter((e) => e.classId === c.id);
    const roster = rosterOf(c.id).length;
    const confirmed = ces.filter((e) => e.status === "confirmed").length;
    const status: CardData["status"] =
      ces.length === 0 ? "not_started" : roster > 0 && confirmed >= roster ? "submitted" : "in_progress";
    return {
      id: c.id,
      subject: c.subject || c.name,
      grade: c.grade,
      students: roster || ces.length,
      status,
      progress: roster > 0 ? Math.min(1, ces.length / roster) : 0,
    };
  });

  // Spec: prompt when entries have gone unsynced past the configurable day limit.
  const days = unsyncedOldestAt
    ? Math.floor((Date.now() - new Date(unsyncedOldestAt).getTime()) / 86_400_000)
    : 0;
  const overdue = hasPending && days >= settings.syncPromptDays;

  // Sync card: circle spins while entries are being saved.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!syncing) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [syncing, spin]);
  const spinRot = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const dialAnim = useRef(new Animated.Value(0)).current;
  const toggleDial = () => {
    const next = !fabOpen;
    setFabOpen(next);
    Animated.spring(dialAnim, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      friction: 6,
      tension: 80,
    }).start();
  };

  // Scan sits closest to the main button — the most frequent action.
  const fabActions = [
    { icon: <Camera size={20} color="#fff" strokeWidth={2.2} />, label: t("scanAnswerSheets"), route: "/camera-permission" },
    { icon: <BookOpen size={20} color="#fff" strokeWidth={2.2} />, label: t("uploadClassList"), route: "/class-setup" },
    { icon: <FilePlus2 size={20} color="#fff" strokeWidth={2.2} />, label: t("newMarkSheet"), route: "/new-marksheet" },
  ] as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Brand row: MarkBook logo, notifications, then profile on the right */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          {/* Bare icons, no background */}
          <Logo size={34} wordmark />
          <View style={{ flex: 1 }} />
          <Press
            onPress={() => router.push("/notifications")}
            accessibilityLabel={t("notifications")}
            hitSlop={6}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Bell size={22} color={C.ink} />
          </Press>
          <Press
            onPress={() => router.push("/profile")}
            accessibilityLabel={t("profile")}
            hitSlop={6}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Avatar text={initialsOf(name) || "T"} size={36} bg={C.greenTint} fontSize={14} />
          </Press>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: C.ink }}>
            {greeting}, {name}
          </Text>
          <Text style={{ fontSize: 15, color: C.sub, marginTop: 4 }}>
            {weekday} · {cards.length} {t("classesToday")}
          </Text>
        </View>

        {overdue && (
          <Press
            onPress={() => void syncNow(false)}
            accessibilityLabel={t("syncNow")}
            style={{
              marginHorizontal: 20,
              marginTop: 12,
              backgroundColor: C.amberCard,
              borderWidth: 1,
              borderColor: C.amberLine,
              borderRadius: 14,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <AlertTriangle size={20} color={C.amber} />
            <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "600", color: C.amberText }}>
              {t("syncOverdue").replace("{n}", String(days))}
            </Text>
            <RefreshCw size={18} color={C.amberText} />
          </Press>
        )}

        {/* Sync card: only exists while entries are unsynced — tapping saves them
            all, the circle spins while syncing, and the card disappears when done. */}
        {hasPending && (
          <Press
            onPress={() => {
              if (!syncing) void syncNow(false);
            }}
            accessibilityLabel={`${unsyncedCount} ${t("pendingSync")}`}
            style={{
              marginHorizontal: 20,
              marginTop: 16,
              backgroundColor: C.card,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: syncing ? C.green : C.amberLine,
              flexDirection: "row",
              alignItems: "center",
              padding: 14,
              gap: 12,
            }}
          >
            <Animated.View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: syncing ? C.greenTint : C.yellowTint,
                alignItems: "center",
                justifyContent: "center",
                transform: [{ rotate: spinRot }],
              }}
            >
              <RefreshCw size={20} color={syncing ? C.green : C.amber} />
            </Animated.View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }}>
                {syncing ? t("syncing") : `${unsyncedCount} ${t("pendingSync")}`}
              </Text>
              <Text style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
                {syncing ? t("savingEntries") : t("tapToSync")}
              </Text>
            </View>
            <ChevronRight size={20} color={C.sub} />
          </Press>
        )}

        {cards.length > 0 && (
          <View style={{ paddingHorizontal: 20, marginTop: 16, gap: 14 }}>
            {cards.map((c) => (
              <ClassCard key={c.id} c={c} />
            ))}
          </View>
        )}

        {/* Empty state: illustration + text centered in the remaining space */}
        {cards.length === 0 && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: 40 }}>
            <Image source={{ uri: NO_CLASSES_YET_ART }} style={{ width: 230, height: 230 }} resizeMode="contain" />
            <Text
              style={{ fontSize: 14.5, fontWeight: "600", color: C.sub, textAlign: "center", paddingHorizontal: 24 }}
            >
              {t("noClassesYet")}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Speed-dial FABs: scan answer sheets, upload class list, new marksheet */}
      {fabOpen && (
        <Press
          onPress={toggleDial}
          accessibilityLabel={t("cancel")}
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,25,20,0.25)" }}
        />
      )}
      <View pointerEvents="box-none" style={{ position: "absolute", right: 20, bottom: 24 }}>
        {fabActions.map((a, i) => {
          const opacity = dialAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });
          const translateY = dialAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -(i + 1) * 64] });
          const scale = dialAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
          return (
            <Animated.View
              key={a.route}
              pointerEvents={fabOpen ? "auto" : "none"}
              style={{
                position: "absolute",
                right: 0,
                bottom: 72,
                opacity,
                transform: [{ translateY }, { scale }],
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Press
                onPress={() => {
                  toggleDial();
                  router.push(a.route);
                }}
                accessibilityLabel={a.label}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: C.green,
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: C.green,
                  shadowOpacity: 0.4,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 5 },
                  elevation: 7,
                }}
              >
                {a.icon}
              </Press>
              {/* Label on the right of the icon, fixed width so the icons align */}
              <View
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: C.line,
                  width: 140,
                  paddingVertical: 7,
                  alignItems: "center",
                  shadowColor: "#000",
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 4,
                }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: C.ink, textAlign: "center" }} numberOfLines={2}>
                  {a.label}
                </Text>
              </View>
            </Animated.View>
          );
        })}
        <Press onPress={toggleDial} accessibilityLabel={t("quickActions")} style={{ alignSelf: "flex-end" }}>
          <Animated.View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: C.green,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ rotate: dialAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "135deg"] }) }],
              shadowColor: C.green,
              shadowOpacity: 0.45,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <Plus size={26} color="#fff" strokeWidth={2.4} />
          </Animated.View>
        </Press>
      </View>

    </SafeAreaView>
  );
}

/** Icon picked from the real subject name the teacher entered. */
function SubjectIcon({ subject }: { subject: string }) {
  const s = subject.toLowerCase();
  if (/math|algebra|geom|calcul|arith/.test(s)) {
    return <Calculator size={26} color={C.green} strokeWidth={2.1} />;
  }
  if (/sci|phys|chem|bio/.test(s)) {
    return <FlaskConical size={26} color={C.green} strokeWidth={2.1} />;
  }
  return <BookOpen size={26} color={C.green} strokeWidth={2.1} />;
}

function ClassCard({ c }: { c: CardData }) {
  const { t } = useI18n();
  const inProgress = c.status === "in_progress";
  const done = Math.round((c.progress ?? 0) * c.students);
  return (
    <Press
      onPress={() => router.push({ pathname: "/class-detail", params: { classId: c.id } })}
      accessibilityLabel={`${c.subject} ${c.grade}`}
      style={{
        backgroundColor: C.card,
        borderRadius: 16,
        borderWidth: inProgress ? 1.5 : 1,
        borderColor: inProgress ? C.green : C.line,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
      }}
    >
      <IconTile size={56} radius={16}>
        <SubjectIcon subject={c.subject} />
      </IconTile>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: C.ink }}>
          {c.subject} · {c.grade}
        </Text>
        <Text style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>
          {c.students} {t("students")}
        </Text>
        {inProgress && (
          <Progress frac={c.progress ?? 0} style={{ marginTop: 10, width: "92%" }} />
        )}
        <View style={{ marginTop: inProgress ? 8 : 10, alignSelf: "flex-start" }}>
          {inProgress ? (
            <StatusPill label={`${t("inProgress")} ${done}/${c.students}`} />
          ) : c.status === "submitted" ? (
            <StatusPill label={t("submitted")} />
          ) : (
            <StatusPill label={t("notStarted")} tint={C.chipGrey} fg={C.sub} />
          )}
        </View>
      </View>
      <Chevron />
    </Press>
  );
}
