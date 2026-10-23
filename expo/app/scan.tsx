import { LinearGradient } from "expo-linear-gradient";
import {
  User,
  AlertTriangle,
  CheckCircle2,
  ScanText,
  ScanLine,
  X,
  Lightbulb,
  LightbulbOff,
  Link2,
  Unlink2,
} from "lucide-react-native";
import React from "react";
import {
  View,
  Text,
  Pressable,
  StatusBar,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  LayoutAnimation,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, Press, StatusPill, Btn, ScreenHeader, Card } from "@/components/ui";
import { LiveCamera } from "@/components/live-camera";
import * as ImagePicker from "expo-image-picker";
import { detectMarks, lastFrame, type DetectionResult } from "@/lib/ai";
import { visionAnalyze } from "@/lib/cv";
import type { FrameHud } from "@/lib/vision-schema";
import { useI18n } from "@/lib/i18n";
import { trackEvent } from "@/lib/observability";
import { useStore, type StudentRecord } from "@/lib/store";

/**
 * Capture screen (spec screen 6): the teacher scans student papers one after
 * another without stopping. Every read is matched against the uploaded class
 * list (name / ID / registration number) and its marks land in the batch list.
 * When the teacher taps Done, problems (students without marks, papers that
 * could not be matched, low-confidence reads) are surfaced BEFORE anything is
 * saved. Nothing is ever guessed.
 *
 * Live aids on the capture stage, all fed by the engine's real frame response:
 *  - HUD overlay: read quality (clear / blurry / too dark), the engine's
 *    confidence score and measured latency — updated on every analyzed frame.
 *  - Dynamic bounding box aligned to the paper region the engine detected
 *    (metadata.paper_bounds); falls back to the static guide when absent.
 *  - Light toggle: hardware torch when the platform allows it (web browsers
 *    that expose one), otherwise a bright screen-light panel to mitigate
 *    underexposed reads — the lit screen itself is the light source.
 *  - Chain mode: after each confirmed read the capture relaunches so papers
 *    chain back-to-back, with a running "Papers: N" counter until submission.
 */

type ScanRow = {
  id: string;
  rawName: string;
  rawId?: string;
  matchedId: string | null;
  name: string;
  ref?: string;
  mark: number;
  maxMark: number;
  avgConf: number;
  matched: boolean;
  photo: string | null;
  /** Which engine read this paper: cloud AI or the real CV (OCR) service. */
  engine: "ai" | "cv";
};

/** Number → "12.34%" percentage string for the bounding-box overlay. */
const pc = (v: number): `${number}%` => `${(v * 100).toFixed(2)}%` as `${number}%`;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\u4e00-\u9fff]+/g, " ")
    .trim();
}

/** Match a detected paper to the uploaded class list by ID first, then name. */
function matchStudent(det: DetectionResult, roster: StudentRecord[]): StudentRecord | null {
  if (det.studentId) {
    const key = normalize(det.studentId);
    const byRef = roster.find((s) => s.ref && normalize(s.ref) === key);
    if (byRef) return byRef;
  }
  const tokens = normalize(det.studentName ?? "").split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  let best: StudentRecord | null = null;
  let bestScore = 0;
  for (const s of roster) {
    const cand = normalize(s.name).split(" ").filter(Boolean);
    if (cand.length === 0) continue;
    const overlap = tokens.filter((tk) => cand.some((c) => c === tk || (tk.length > 3 && c.startsWith(tk)))).length;
    const score = overlap / Math.max(tokens.length, cand.length);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

export default function ScanScreen() {
  const { t } = useI18n();
  const { rosterOf, addEntry, settings, setSettings } = useStore();
  // Full-bleed camera: keep overlays clear of the notch/status bar and home indicator.
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ assessment?: string; classId?: string; maxMark?: string }>();
  const assessment = params.assessment ?? "Quiz";
  const classId = params.classId ?? "";
  const maxMark = Number(params.maxMark ?? 50) || 50;
  const roster = rosterOf(classId);

  const [phase, setPhase] = React.useState<"capture" | "review">("capture");
  const [rows, setRows] = React.useState<ScanRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  /** Real engine response for the last analyzed frame — HUD + bounding box. */
  const [hud, setHud] = React.useState<FrameHud | null>(null);
  const [lightOn, setLightOn] = React.useState(false);
  const [chain, setChain] = React.useState(false);
  const chainRef = React.useRef(false);
  React.useEffect(() => {
    chainRef.current = chain;
  }, [chain]);
  const captureRef = React.useRef<() => Promise<void>>(async () => {});
  /** Web live viewfinder: registered by <LiveCamera> once the stream is up. */
  const liveCaptureRef = React.useRef<(() => void) | null>(null);
  const registerLiveCapture = React.useCallback((fn: (() => void) | null) => {
    liveCaptureRef.current = fn;
  }, []);

  const applyHud = (next: FrameHud | null) => {
    if (Platform.OS !== "web") LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHud(next);
  };

  const QUALITY_STYLE = {
    clear: { label: t("scanQClear"), color: "#34D399" },
    blurry: { label: t("scanQBlurry"), color: "#FBBF24" },
    underexposed: { label: t("scanQDark"), color: "#F87171" },
  } as const;
  const qStyle = hud ? QUALITY_STYLE[hud.readQuality] : null;
  const bounds = hud?.paperBounds ?? null;

  /** Shared row-building for both engines; then the camera keeps rolling. */
  const addRow = (result: DetectionResult, base64: string) => {
    const matched = matchStudent(result, roster);
    // AI reports a confidence per question; the CV engine one value per page.
    const avgConf = result.questions.length
      ? Math.round(result.questions.reduce((s, q) => s + q.confidence, 0) / result.questions.length)
      : Math.round((result.confidence ?? 0) * 100);
    const row: ScanRow = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      rawName: result.studentName ?? "",
      rawId: result.studentId,
      matchedId: matched?.id ?? null,
      name: matched ? matched.name : result.studentName || "—",
      ref: matched?.ref ?? result.studentId,
      mark: result.total ?? 0,
      maxMark: result.max ?? maxMark,
      avgConf,
      matched: matched !== null,
      photo: `data:image/jpeg;base64,${base64}`,
      engine: result.engine ?? "ai",
    };
    setRows((prev) => [row, ...prev]);
    // Chain mode: keep the papers coming — relaunch capture for the next sheet.
    if (chainRef.current) setTimeout(() => void captureRef.current(), 650);
  };

  const manualFallback = () =>
    // Never guess: an unreadable (or confidence-gated) read offers a retry or
    // real manual entry — the batch keeps running either way.
    Alert.alert(t("readFailTitle"), t("readFailBody"), [
      { text: t("ok") },
      {
        text: t("enterManually"),
        onPress: () =>
          router.push({
            pathname: "/entry-sheet",
            params: { assessment, classId, maxMark: String(maxMark) },
          }),
      },
    ]);

  const analyze = async (base64: string) => {
    setBusy(true);
    if (settings.visionEngine === "cv") {
      if (!settings.cvServiceUrl || !settings.cvAuthEmail || !settings.cvRefreshToken) {
        setBusy(false);
        Alert.alert(t("cvNotConfiguredTitle"), t("cvNotConfiguredBody"), [
          { text: t("cancel"), style: "cancel" },
          { text: t("openSettings"), onPress: () => router.push("/settings") },
        ]);
        return;
      }
      const cv = await visionAnalyze(base64, {
        url: settings.cvServiceUrl,
        email: settings.cvAuthEmail,
        refreshToken: settings.cvRefreshToken,
        // Persist the rotated refresh token so the 30-day session keeps rolling.
        onTokens: (tk) => setSettings((s) => ({ ...s, cvRefreshToken: tk.refreshToken })),
      });
      // HUD first: the frame contract's real quality / confidence / latency /
      // paper bounds — shown even when the read ends up gated.
      if (cv.hud) applyHud(cv.hud);
      setBusy(false);
      if (cv.error === "auth") {
        Alert.alert(t("cvAuthTitle"), t("cvAuthBody"), [
          { text: t("cancel"), style: "cancel" },
          { text: t("openSettings"), onPress: () => router.push("/settings") },
        ]);
        return;
      }
      if (cv.error === "unreachable") {
        Alert.alert(t("cvUnreachableTitle"), t("cvUnreachableBody"), [{ text: t("ok") }]);
        return;
      }
      // Quality gate (spec stage 1): no paper in frame, or a blurry/underexposed
      // capture — flag it immediately and ask for a steady, well-lit retake.
      if (cv.error === "quality") {
        Alert.alert(t("cvQualityTitle"), t("cvQualityBody"), [{ text: t("ok") }]);
        return;
      }
      // error === null with a null result means the engine gated the read
      // (unreadable / low confidence) — it must never become a saved guess.
      if (!cv.result) {
        trackEvent("read_gated", { engine: "cv" });
        manualFallback();
        return;
      }
      addRow(cv.result, base64);
      return;
    }
    const result = await detectMarks(base64);
    // HUD from the real frame response (null when nothing parsed).
    applyHud(lastFrame.current);
    setBusy(false);
    if (!result) {
      trackEvent("read_gated", { engine: "ai" });
      manualFallback();
      return;
    }
    addRow(result, base64);
  };

  /** Engine picker shown right on the capture screen. */
  const pickEngine = () => {
    Alert.alert(t("visionEngine"), t("cvEngineHint"), [
      { text: t("engineAI"), onPress: () => setSettings((s) => ({ ...s, visionEngine: "ai" })) },
      { text: t("engineCV"), onPress: () => setSettings((s) => ({ ...s, visionEngine: "cv" })) },
      { text: t("cancel"), style: "cancel" },
    ]);
  };

  const capture = async () => {
    try {
      // Ask at most once: check the stored decision first, prompt only when undecided.
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await ImagePicker.requestCameraPermissionsAsync();
      }
      if (!perm.granted) {
        router.push("/camera-permission");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.4, base64: true, exif: false });
      const asset = res.assets?.[0];
      const base64 = asset?.base64;
      if (res.canceled || !asset || !base64) return;
      await processCapture(base64, asset.width, asset.height);
    } catch {
      setBusy(false);
    }
  };

  /** Shared post-capture path for both the live viewfinder and device camera. */
  const processCapture = async (base64: string, width: number, height: number) => {
    try {
      // Spec: warn (not block) when the capture is below the recommended 8MP.
      // The web viewfinder streams at browser size, so this warning is for
      // device camera photos only — the engine's quality gates judge every frame.
      // Never nag: once dismissed with "Don't ask again" it stays dismissed.
      if (Platform.OS !== "web" && width * height < 8_000_000) {
        if (!settings.warnLowMp) {
          await analyze(base64);
          return;
        }
        Alert.alert(t("lowMpTitle"), t("lowMpBody"), [
          {
            text: t("dontAskAgain"),
            onPress: () => {
              setSettings((s) => ({ ...s, warnLowMp: false }));
              void analyze(base64);
            },
          },
          { text: t("ok"), onPress: () => void analyze(base64) },
        ]);
        return;
      }
      await analyze(base64);
    } catch {
      setBusy(false);
    }
  };

  /** Explicit fallback when no live camera exists (blocked browser / no device). */
  const pickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true, exif: false });
      const asset = res.assets?.[0];
      if (res.canceled || !asset?.base64) return;
      await processCapture(asset.base64, asset.width, asset.height);
    } catch {
      setBusy(false);
    }
  };

  const shoot = async () => {
    // Web: the live viewfinder captures straight from its video stream — no
    // upload dialog, ever. Native: the real system camera app.
    if (Platform.OS === "web") {
      liveCaptureRef.current?.();
      return;
    }
    await capture();
  };
  captureRef.current = shoot;

  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  // --- Pre-save issue review (spec: surface problems BEFORE saving) ---------
  const markedIds = new Set(rows.filter((r) => r.matchedId).map((r) => r.matchedId));
  const noMarks = roster.filter((s) => !markedIds.has(s.id));
  const unmatched = rows.filter((r) => !r.matched);
  const lowConf = rows.filter((r) => r.avgConf < 85);
  const issues = noMarks.length + unmatched.length + lowConf.length;

  const saveAll = () => {
    for (const r of rows) {
      addEntry({
        studentName: r.name,
        classId,
        assessment,
        mark: r.mark,
        maxMark: r.maxMark,
        confidence: r.avgConf,
        source: r.engine === "cv" ? "cv" : "ai",
      });
    }
    router.replace("/session-complete");
  };

  if (phase === "review") {
    return (
      <SafeAreaReview
        rows={rows}
        noMarks={noMarks}
        unmatched={unmatched}
        lowConf={lowConf}
        issues={issues}
        assessment={assessment}
        onRemove={removeRow}
        onSave={saveAll}
        onBack={() => setPhase("capture")}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0B231B" }}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={["#12382B", "#0B241C"]} style={{ flex: 1 }}>
        {/* Capture stage: a designed scan surface — paper guide + shutter button.
            Shutter and Done are SIBLINGS (never nested) so buttons don't render
            inside each other on web. */}
        <View style={{ flex: 1 }}>
          {/* Real live viewfinder on web: browser camera stream, canvas capture
              and a hardware torch when available — no upload dialog. Native
              builds keep the system camera. */}
          {Platform.OS === "web" && (
            <LiveCamera
              torchOn={lightOn}
              onFrame={(base64) => void processCapture(base64, 0, 0)}
              onPhotoFallback={() => void pickPhoto()}
              registerCapture={registerLiveCapture}
            />
          )}
          {/* Screen light: a genuinely bright surface to mitigate underexposed
              captures — the lit screen itself is the light source. */}
          {lightOn && (
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 130, backgroundColor: "#FBFDF6", opacity: 0.97 }}
            />
          )}
          {bounds ? (
            /* Dynamic bounding box aligned to the paper region the engine detected. */
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 130 }}>
              <View
                style={{
                  position: "absolute",
                  left: pc(bounds.x),
                  top: pc(bounds.y),
                  width: pc(bounds.w),
                  height: pc(bounds.h),
                  borderWidth: 3,
                  borderRadius: 14,
                  borderColor: qStyle?.color ?? "#7EE3C1",
                  backgroundColor: "rgba(126,227,193,0.05)",
                }}
              />
            </View>
          ) : (
            /* Paper guide — where the sheet should sit (not tappable) */
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 130, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 228, height: 290 }}>
                <View style={{ position: "absolute", top: 0, left: 0, width: 30, height: 30, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12, borderColor: "rgba(126,227,193,0.9)" }} />
                <View style={{ position: "absolute", top: 0, right: 0, width: 30, height: 30, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12, borderColor: "rgba(126,227,193,0.9)" }} />
                <View style={{ position: "absolute", bottom: 0, left: 0, width: 30, height: 30, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12, borderColor: "rgba(126,227,193,0.9)" }} />
                <View style={{ position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12, borderColor: "rgba(126,227,193,0.9)" }} />
              </View>
            </View>
          )}
          {/* Live HUD: real values straight from the engine's frame response */}
          {hud && qStyle && (
            <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 62, left: 16, right: 124, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <HudPill label={qStyle.label} dot={qStyle.color} />
                <HudPill label={`${t("confidence")} ${Math.round(hud.confidence * 100)}%`} />
                <HudPill label={`${hud.latencyMs} ms`} />
              </View>
              {(lightOn || hud.readQuality === "underexposed") && (
                <Text style={{ color: lightOn ? "rgba(11,36,28,0.85)" : "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: "600" }}>
                  {t("scanLightHint")}
                </Text>
              )}
            </View>
          )}
          {/* Light + chain toggles */}
          <View style={{ position: "absolute", top: insets.top + 62, right: 16, flexDirection: "row", gap: 10 }}>
            {/* Stage 5: live auto-capture workspace (continuous paper detection). */}
            <RoundToggle on={false} onPress={() => router.push({ pathname: "/live-scan", params: { assessment, classId } })} label={t("liveScan")}>
              <ScanLine size={18} color="#fff" />
            </RoundToggle>
            <RoundToggle on={lightOn} onPress={() => setLightOn((v) => !v)} label={lightOn ? t("scanLightOn") : t("scanLightOff")}>
              {lightOn ? <Lightbulb size={18} color="#B45309" /> : <LightbulbOff size={18} color="#fff" />}
            </RoundToggle>
            <RoundToggle on={chain} onPress={() => setChain((v) => !v)} label={chain ? t("scanChainOn") : t("scanChainOff")}>
              {chain ? <Link2 size={18} color="#047857" /> : <Unlink2 size={18} color="#fff" />}
            </RoundToggle>
          </View>
          {/* Shutter + hint */}
          <View style={{ position: "absolute", bottom: 22, alignSelf: "center", alignItems: "center" }}>
            {rows.length > 0 && (
              <View style={{ backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 10 }}>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>
                  {t("scanPapersCount").replace("{n}", String(rows.length))}
                </Text>
              </View>
            )}
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "600", marginBottom: 12, textAlign: "center" }}>
              {t("scanStageHint")}
            </Text>
            <Pressable
              onPress={() => void shoot()}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("capture")}
              style={({ pressed }: { pressed: boolean }) => ({
                width: 78,
                height: 78,
                borderRadius: 39,
                backgroundColor: "rgba(255,255,255,0.22)",
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#fff" }} />
            </Pressable>
          </View>
          {/* Done floats beside the shutter */}
          <Press
            onPress={() => setPhase("review")}
            accessibilityLabel={t("done")}
            style={{ position: "absolute", bottom: 30, right: 16, opacity: rows.length === 0 ? 0.4 : 1 }}
            disabled={rows.length === 0}
          >
            <View style={{ backgroundColor: C.green, borderRadius: 26, paddingHorizontal: 30, paddingVertical: 14 }}>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{t("done")}</Text>
            </View>
          </Press>
        </View>
        {/* Close, batch progress, engine picker — kept clear of the notch */}
        <View
          style={{
            position: "absolute",
            top: insets.top + 10,
            left: 16,
            right: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
            <Pressable
              onPress={() => router.back()}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("cancel")}
              hitSlop={8}
              style={({ pressed }: { pressed: boolean }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "rgba(0,0,0,0.45)",
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <X size={20} color="#fff" />
            </Pressable>
            <View
              style={{
                backgroundColor: "rgba(0,0,0,0.45)",
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "800" }}>
                {t("scanProgress")
                  .replace("{done}", String(rows.length))
                  .replace("{total}", String(roster.length))}
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={pickEngine}
              style={({ pressed }: { pressed: boolean }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: "rgba(0,0,0,0.45)",
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 9,
                opacity: pressed ? 0.7 : 1,
                marginRight: 8,
              })}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("visionEngine")}
            >
              <ScanText size={15} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "700" }}>
                {settings.visionEngine === "cv" ? t("engineCV") : t("engineAI")}
              </Text>
            </Pressable>
          </View>

        {/* Batch list — every scanned paper lands here in real time. Hidden
            until the first read so the stage stays clean. */}
        {rows.length > 0 && (
        <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: 320 }}>
          <ScrollView style={{ maxHeight: 250 }} contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8 }} showsVerticalScrollIndicator={false}>
            {rows.map((r) => (
              <View
                key={r.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  backgroundColor: C.bg,
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.greenTint, alignItems: "center", justifyContent: "center" }}>
                  <User size={18} color={C.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: "700", color: C.ink }} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>
                    {r.matched ? t("scanOnList") : t("scanNotOnList")}
                    {r.ref ? ` · ${r.ref}` : ""}
                  </Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: "800", color: C.green }}>
                  {r.mark}/{r.maxMark}
                </Text>
                <Press onPress={() => removeRow(r.id)} accessibilityLabel={t("scanRemove")} hitSlop={8}>
                  <X size={18} color={C.faint} />
                </Press>
              </View>
            ))}
          </ScrollView>
        </View>
        )}

        {busy && (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.55)",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <ActivityIndicator size="large" color="#fff" />
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{t("analyzing")}</Text>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

function SafeAreaReview({
  rows,
  noMarks,
  unmatched,
  lowConf,
  issues,
  assessment,
  onRemove,
  onSave,
  onBack,
}: {
  rows: ScanRow[];
  noMarks: StudentRecord[];
  unmatched: ScanRow[];
  lowConf: ScanRow[];
  issues: number;
  assessment: string;
  onRemove: (id: string) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" />
      <ScreenHeader title={t("scanBeforeSave")} onBack={onBack} close accessibilityLabel={t("cancel")} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={{ fontSize: 15, fontWeight: "800", color: C.ink }}>
            {t("scanProgress").replace("{done}", String(rows.length))} · {assessment}
          </Text>
          <Text style={{ fontSize: 13, color: issues > 0 ? C.amberText : C.green, fontWeight: "700", marginTop: 4 }}>
            {issues > 0 ? t("scanIssueCount").replace("{n}", String(issues)) : t("scanAllGood")}
          </Text>
        </Card>

        {unmatched.length > 0 && (
          <IssueBlock
            icon={<AlertTriangle size={18} color={C.amber} />}
            text={t("scanUnmatched").replace("{n}", String(unmatched.length))}
          >
            {unmatched.map((r) => (
              <RowLine key={r.id} name={r.rawName || "—"} meta={r.rawId ?? ""} mark={`${r.mark}/${r.maxMark}`} onRemove={() => onRemove(r.id)} />
            ))}
          </IssueBlock>
        )}
        {lowConf.length > 0 && (
          <IssueBlock
            icon={<AlertTriangle size={18} color={C.amber} />}
            text={t("scanLowConf").replace("{n}", String(lowConf.length))}
          >
            {lowConf.map((r) => (
              <RowLine key={r.id} name={r.name} meta={`${t("confidence")} ${r.avgConf}%`} mark={`${r.mark}/${r.maxMark}`} onRemove={() => onRemove(r.id)} />
            ))}
          </IssueBlock>
        )}
        {noMarks.length > 0 && (
          <IssueBlock
            icon={<AlertTriangle size={18} color={C.amber} />}
            text={t("scanNoMarks").replace("{n}", String(noMarks.length))}
          >
            {noMarks.slice(0, 12).map((s) => (
              <RowLine key={s.id} name={s.name} meta={s.ref ?? ""} mark="—" />
            ))}
            {noMarks.length > 12 && <Text style={{ fontSize: 12, color: C.faint, paddingVertical: 4 }}>+{noMarks.length - 12}</Text>}
          </IssueBlock>
        )}

        {issues === 0 && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
            <CheckCircle2 size={22} color={C.green} />
            <Text style={{ flex: 1, fontSize: 13.5, color: C.ink, fontWeight: "600" }}>{t("scanAllGood")}</Text>
          </Card>
        )}

        <Btn label={t("scanSaveAll").replace("{n}", String(rows.length))} onPress={onSave} disabled={rows.length === 0} style={{ marginTop: 6 }} />
        <Btn label={t("scanKeepScanning")} variant="outline" onPress={onBack} />
      </ScrollView>
    </View>
  );
}

/** Small translucent HUD pill (quality / confidence / latency). */
function HudPill({ label, dot }: { label: string; dot?: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "rgba(0,0,0,0.5)",
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 6,
      }}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

/** Round 40pt stage toggle (screen light / chain mode). */
function RoundToggle({
  on,
  onPress,
  label,
  children,
}: {
  on: boolean;
  onPress: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      style={({ pressed }: { pressed: boolean }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: on ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.45)",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

function IssueBlock({ icon, text, children }: { icon: React.ReactNode; text: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: C.yellowTint, borderRadius: 14, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon}
        <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "700", color: C.amberText }}>{text}</Text>
      </View>
      {children}
    </View>
  );
}

function RowLine({ name, meta, mark, onRemove }: { name: string; meta: string; mark: string; onRemove?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 10, padding: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: C.ink }} numberOfLines={1}>
          {name}
        </Text>
        {meta ? <Text style={{ fontSize: 11.5, color: C.sub }}>{meta}</Text> : null}
      </View>
      <Text style={{ fontSize: 13.5, fontWeight: "800", color: C.green }}>{mark}</Text>
      {onRemove && (
        <Press onPress={onRemove} accessibilityLabel={t("scanRemove")} hitSlop={8}>
          <X size={16} color={C.faint} />
        </Press>
      )}
    </View>
  );
}
