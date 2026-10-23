import { ChevronLeft, Flag, Play, Pause, Square, X } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { C, Btn, Card, Press, ScreenHeader } from "@/components/ui";
import { LiveScanner, type CamStatus } from "@/components/live-scanner";
import { CaptureTracker, defaultCapturePolicy, type TrackerDecision } from "@/src/scanning/auto-capture";
import { regionFingerprint, type GrayFrame, type PaperRegion } from "@/src/scanning/paper-detect";
import {
  createIndexedDbImageStore,
  MemoryImageStore,
  captureFileName,
  type CaptureRecord,
  type DetectionMeta,
  type ImageStore,
  type SessionRecord,
} from "@/src/scanning/persist";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { uuid4 as makeId } from "@/lib/crypto";

/**
 * Stage 5 Live Scanning screen — continuous paper capture, no recognition.
 *
 * The engine runs the real detection + stability + duplicate-suppression
 * pipeline (src/scanning/*): a capture happens when a candidate paper is
 * geometrically stable per policy — no shutter press per sheet. A capture
 * means ONLY that an image was captured and stored; identity, marks and
 * answers are later stages and are never touched here.
 *
 * Platform honesty: web runs the complete pipeline (real camera frames →
 * detector → auto capture → IndexedDB images). Native builds have no frame
 * pipeline in Expo Go (the camera module is refused) — this screen shows the
 * honest state and offers per-sheet system-camera capture into the same
 * session; on-device image storage is marked failed until a dev build adds
 * the file adapter (documented, never faked).
 */

type Phase = "idle" | "running" | "paused" | "ended";

/** base64 (web) → bytes for the image store. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Number → "12.34%" percentage string for the bounding-box overlay. */
const pc = (v: number): `${number}%` => `${(v * 100).toFixed(2)}%` as `${number}%`;

export default function LiveScanScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ assessment?: string; classId?: string }>();
  const assessment = params.assessment ?? "Quiz";
  const classId = params.classId ?? "";
  const {
    ready,
    scanSessions,
    scanCaptures,
    startScanSession,
    setScanSessionStatus,
    addScanCapture,
    reconcileScans,
    removeScanCapture,
  } = useStore();

  const isWeb = Platform.OS === "web";
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [camStatus, setCamStatus] = useState<CamStatus>("starting");
  const [decision, setDecision] = useState<TrackerDecision>({ phase: "searching", capture: false });
  const [bounds, setBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [lastSaveFailed, setLastSaveFailed] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<CaptureRecord | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  // Platform image store: real IndexedDB on web; null where the platform has
  // no file adapter (native Expo Go — captures report honest save failures).
  const imageStoreRef = useRef<ImageStore | null>(null);
  useEffect(() => {
    if (isWeb) imageStoreRef.current = createIndexedDbImageStore();
  }, [isWeb]);

  const trackerRef = useRef<CaptureTracker | null>(null);
  /** Latest sample artifacts for the capture path. */
  const sampleRef = useRef<{ frame: GrayFrame; region: PaperRegion } | null>(null);
  const grabRef = useRef<(() => string | null) | null>(null);
  const registerGrab = useCallback((fn: (() => string | null) | null) => {
    grabRef.current = fn;
  }, []);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const sessionRef = useRef<SessionRecord | null>(null);
  sessionRef.current = session;

  const captures = useMemo(
    () => scanCaptures.filter((c) => session && c.sessionId === session.id),
    [scanCaptures, session],
  );
  const flaggedCount = captures.filter((c) => c.possibleDuplicate).length;

  /* Startup reconciliation: missing files, orphan debris, interrupted
   * sessions. Runs once per mount when the store is ready. */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const report = await reconcileScans(imageStoreRef.current ?? new MemoryImageStore());
      if (cancelled) return;
      const interrupted = scanSessions.filter((s) => report.interrupted.includes(s.id));
      if (interrupted.length > 0) {
        const s = interrupted[0];
        Alert.alert(t("lsInterruptedTitle"), t("lsInterruptedBody"), [
          {
            text: t("lsResume"),
            onPress: () => {
              setScanSessionStatus(s.id, "active");
              setSession({ ...s, status: "active" });
              trackerRef.current = new CaptureTracker();
              setPhase("running");
            },
          },
          {
            text: t("lsClose"),
            style: "cancel",
            onPress: () => setScanSessionStatus(s.id, "completed"),
          },
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const startSession = () => {
    const s = startScanSession(classId, assessment, "ordinary");
    setSession(s);
    trackerRef.current = new CaptureTracker();
    setDecision({ phase: "searching", capture: false });
    setLastSaveFailed(null);
    setPhase("running");
  };

  const pause = () => {
    trackerRef.current?.pause();
    if (session) setScanSessionStatus(session.id, "paused");
    setPhase("paused");
    setDecision({ phase: "paused", capture: false });
  };

  const resume = () => {
    trackerRef.current?.resume();
    if (session) setScanSessionStatus(session.id, "active");
    setPhase("running");
    setDecision({ phase: "searching", capture: false });
  };

  /** End the session — captured images are NEVER deleted by this. */
  const endSession = () => {
    trackerRef.current?.pause();
    if (session) setScanSessionStatus(session.id, "completed");
    setPhase("ended");
  };

  /** Persist one frame: image first, metadata second, honest failure paths. */
  const persistCapture = useCallback(
    async (base64: string, region: PaperRegion | null, possibleDuplicate: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      const tracker = trackerRef.current;
      const seq = captures.length + 1;
      const captureId = makeId();
      const capturedAt = new Date().toISOString();
      const detection: DetectionMeta | undefined = region
        ? {
            areaFraction: region.areaFraction,
            aspect: region.w / region.h,
            sharpness: Math.round(region.sharpness),
            luminance: Math.round(region.luminance),
            bounds: {
              x: region.x / (sampleRef.current?.frame.w ?? 1),
              y: region.y / (sampleRef.current?.frame.h ?? 1),
              w: region.w / (sampleRef.current?.frame.w ?? 1),
              h: region.h / (sampleRef.current?.frame.h ?? 1),
            },
          }
        : undefined;

      const images = imageStoreRef.current;
      if (!images) {
        // Platform has no image adapter (native Expo Go): record an honest
        // failure — never claim the image was saved.
        tracker?.finishCapture(performance.now(), false);
        addScanCapture({
          id: captureId,
          sessionId: s.id,
          seq,
          imageRef: "",
          fileName: captureFileName(s.id, seq, captureId),
          capturedAt,
          status: "saveFailed",
          failureReason: "image-storage-unavailable",
        });
        setLastSaveFailed("lsSaveFailedStorage");
        setDecision({ phase: "failed", capture: false });
        return;
      }
      setDecision((d) => ({ ...d, phase: "saving" }));
      try {
        const bytes = base64ToBytes(base64);
        const ref = await images.put(captureFileName(s.id, seq, captureId), bytes, "image/jpeg");
        const record: CaptureRecord = {
          id: captureId,
          sessionId: s.id,
          seq,
          imageRef: ref,
          fileName: captureFileName(s.id, seq, captureId),
          capturedAt,
          status: "saved",
          possibleDuplicate: possibleDuplicate || undefined,
          detection,
        };
        addScanCapture(record);
        setThumbs((prev) => ({ ...prev, [captureId]: `data:image/jpeg;base64,${base64}` }));
        tracker?.finishCapture(performance.now(), true);
        setLastSaveFailed(null);
        setDecision({ phase: "captured", capture: false });
      } catch {
        // Nothing saved — say so, keep the engine recoverable.
        tracker?.finishCapture(performance.now(), false);
        setLastSaveFailed("lsSaveFailed");
        setDecision({ phase: "failed", capture: false });
      }
    },
    [addScanCapture, captures.length],
  );

  /** Engine callback per analyzed sample (~5 fps while running). */
  const onSample = useCallback(
    (s: { regions: PaperRegion[]; frame: GrayFrame }) => {
      if (phaseRef.current !== "running") return;
      const tracker = trackerRef.current;
      if (!tracker) return;
      const page = s.regions[0] ?? null;
      sampleRef.current = page ? { frame: s.frame, region: page } : null;
      if (page) {
        setBounds({
          x: page.x / s.frame.w,
          y: page.y / s.frame.h,
          w: page.w / s.frame.w,
          h: page.h / s.frame.h,
        });
      } else {
        setBounds(null);
      }
      const d = tracker.observe({
        regions: s.regions,
        tMs: performance.now(),
        fingerprintOf: (r) => regionFingerprint(s.frame, r),
      });
      setDecision(d);
      if (d.capture && tracker.beginCapture()) {
        const grab = grabRef.current;
        const base64 = grab?.() ?? null;
        if (!base64) {
          tracker.finishCapture(performance.now(), false);
          setDecision({ phase: "failed", capture: false, reason: "frame-grab-failed" });
          return;
        }
        tracker.rememberCaptured({ x: page.x, y: page.y, w: page.w, h: page.h }, regionFingerprint(s.frame, page));
        setDecision({ phase: "capturing", capture: false });
        void persistCapture(base64, page, d.possibleDuplicate === true);
      }
    },
    [persistCapture],
  );

  /** Manual fallback: capture NOW (no stability wait), same save path. */
  const manualCapture = async () => {
    if (phaseRef.current !== "running") return;
    const tracker = trackerRef.current;
    if (!tracker || tracker.isCapturing()) return;
    if (!tracker.beginCapture()) return;
    if (isWeb) {
      const base64 = grabRef.current?.() ?? null;
      const region = sampleRef.current?.region ?? null;
      if (!base64) {
        tracker.finishCapture(performance.now(), false);
        setLastSaveFailed("lsSaveFailed");
        return;
      }
      if (region) tracker.rememberCaptured({ x: region.x, y: region.y, w: region.w, h: region.h }, null);
      void persistCapture(base64, region, false);
      return;
    }
    // Native: the real system camera, per sheet.
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        tracker.finishCapture(performance.now(), false);
        router.push("/camera-permission");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true, exif: false });
      const asset = res.assets?.[0];
      if (res.canceled || !asset?.base64) {
        tracker.finishCapture(performance.now(), false);
        return;
      }
      void persistCapture(asset.base64, null, false);
    } catch {
      tracker?.finishCapture(performance.now(), false);
      setLastSaveFailed("lsSaveFailed");
    }
  };

  /* Native path never mounts the live scanner — record the honest state. */
  useEffect(() => {
    if (!isWeb && phase === "running" && camStatus === "starting") setCamStatus("unavailable");
  }, [isWeb, phase, camStatus]);

  /* Restarted-session thumbs: hydrate from the image store. */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      for (const c of captures) {
        if (thumbs[c.id] || c.status !== "saved") continue;
        const data = await imageStoreRef.current?.getData(c.imageRef);
        if (cancelled) return;
        if (data) {
          let bin = "";
          for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
          setThumbs((prev) => ({ ...prev, [c.id]: `data:image/jpeg;base64,${btoa(bin)}` }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, captures, thumbs]);

  const removeCapture = (c: CaptureRecord) => {
    setInspecting(null);
    void removeScanCapture(c.id);
    void imageStoreRef.current?.remove(c.imageRef).catch(() => {});
    setThumbs((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
  };

  const leave = () => {
    // Graceful exit: an open session pauses (recoverable), never deletes.
    if (session && (phase === "running" || phase === "paused")) setScanSessionStatus(session.id, "paused");
    router.back();
  };

  /* ---------------- session summary ---------------- */
  if (phase === "ended" && session) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }} testID="live-scan-summary">
        <StatusBar barStyle="dark-content" />
        <ScreenHeader title={t("lsSessionEnded")} onBack={leave} accessibilityLabel={t("cancel")} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <Card style={{ gap: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: C.ink }}>{assessment}</Text>
            <Text style={{ fontSize: 14, color: C.sub }}>
              {t("lsCapturesCount").replace("{n}", String(captures.length))}
              {flaggedCount > 0 ? ` · ${t("lsFlaggedCount").replace("{n}", String(flaggedCount))}` : ""}
            </Text>
            <Text style={{ fontSize: 12.5, color: C.faint, marginTop: 4 }}>{t("lsNoRecognitionNote")}</Text>
          </Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {captures.map((c) =>
              thumbs[c.id] ? (
                <Image key={c.id} source={{ uri: thumbs[c.id] }} style={{ width: 84, height: 108, borderRadius: 8, backgroundColor: C.bg }} />
              ) : (
                <View key={c.id} style={{ width: 84, height: 108, borderRadius: 8, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 11, color: C.faint }}>{c.status === "saveFailed" ? t("lsSaveFailed") : c.status}</Text>
                </View>
              ),
            )}
          </View>
          <Btn label={t("lsNewSession")} onPress={() => setPhase("idle")} />
          <Btn label={t("done")} variant="outline" onPress={leave} />
        </ScrollView>
      </View>
    );
  }

  /* ---------------- inspector ---------------- */
  if (inspecting) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0B231B" }}>
        <StatusBar barStyle="light-content" />
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={() => setInspecting(null)}
            accessibilityRole="button"
            accessibilityLabel={t("cancel")}
            hitSlop={8}
            style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={24} color="#fff" />
          </Pressable>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15, flex: 1 }}>
            {t("lsCaptureN").replace("{n}", String(inspecting.seq))}
          </Text>
        </View>
        <View style={{ flex: 1, padding: 16, alignItems: "center", justifyContent: "center" }}>
          {thumbs[inspecting.id] ? (
            <Image source={{ uri: thumbs[inspecting.id] }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          ) : (
            <Text style={{ color: "rgba(255,255,255,0.8)" }}>{t("lsSaveFailed")}</Text>
          )}
          {inspecting.possibleDuplicate && (
            <View style={{ position: "absolute", top: insets.top + 60, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(251,191,36,0.9)", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Flag size={14} color="#7C2D12" />
              <Text style={{ color: "#7C2D12", fontWeight: "800", fontSize: 12.5 }}>{t("lsPossibleDuplicate")}</Text>
            </View>
          )}
        </View>
        <View style={{ padding: 20, flexDirection: "row", gap: 12, paddingBottom: insets.bottom + 20 }}>
          <View style={{ flex: 1 }}>
            <Btn label={t("scanRemove")} variant="outline" onPress={() => removeCapture(inspecting)} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn label={t("ok")} onPress={() => setInspecting(null)} />
          </View>
        </View>
      </View>
    );
  }

  /* ---------------- pre-start / running ---------------- */
  const live = isWeb && camStatus === "live" && phase === "running";
  const bannerKey = !isWeb
    ? camStatus === "starting"
      ? "lsStateInit"
      : "lsNativeLive"
    : camStatus === "starting"
      ? "lsStateInit"
      : camStatus === "denied"
        ? "scanCamDeniedBody"
        : camStatus === "unavailable"
          ? "scanCamUnavailableBody"
          : decision.phase === "paused"
            ? "lsStatePaused"
            : decision.phase === "searching"
              ? "lsStateNoPaper"
              : decision.phase === "candidateDetected"
                ? "lsStatePaper"
                : decision.phase === "waitingStability"
                  ? "lsStateStability"
                  : decision.phase === "captureReady"
                    ? "lsStateReadyCapture"
                    : decision.phase === "capturing"
                      ? "lsStateCapturing"
                      : decision.phase === "saving"
                        ? "lsStateSaving"
                        : decision.phase === "captured"
                          ? "lsStateCaptured"
                          : decision.phase === "failed"
                            ? "lsStateFailed"
                            : decision.phase === "qualityInsufficient"
                              ? decision.reason === "partialPage"
                                ? "lsMovePaper"
                                : decision.reason === "tooDark"
                                  ? "lsImproveLight"
                                  : "lsHoldStill"
                              : decision.phase === "multiplePapers"
                                ? "lsOneSheet"
                                : decision.phase === "cameraLost"
                                  ? "lsStateCamLost"
                                  : "lsStateNoPaper";
  const bannerTone =
    decision.phase === "captured"
      ? "#34D399"
      : decision.phase === "captureReady" || decision.phase === "capturing" || decision.phase === "saving"
        ? "#7EE3C1"
        : decision.phase === "failed" || decision.phase === "qualityInsufficient" || decision.phase === "multiplePapers"
          ? "#FBBF24"
          : "rgba(255,255,255,0.92)";
  const guidanceKey =
    decision.phase === "waitingStability"
      ? "lsHoldStill"
      : decision.phase === "captured"
        ? "lsImageSaved"
        : null;

  return (
    <View style={{ flex: 1, backgroundColor: "#0B231B" }} testID="live-scan">
      <StatusBar barStyle="light-content" />
      {/* Live preview (web) or honest native stage */}
      {isWeb && (
        <LiveScanner
          paused={phase !== "running"}
          facing={facing}
          onSample={onSample}
          onStatus={setCamStatus}
          onFallback={() => void manualCapture()}
          registerCapture={registerGrab}
          onSwitchCamera={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
        />
      )}

      {/* Top bar */}
      <View style={{ position: "absolute", top: insets.top + 10, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable
          onPress={leave}
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
        <View style={{ backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "800" }}>
            {t("lsCapturesCount").replace("{n}", String(captures.length))}
          </Text>
        </View>
        {flaggedCount > 0 && (
          <View style={{ backgroundColor: "rgba(251,191,36,0.85)", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Flag size={13} color="#7C2D12" />
            <Text style={{ color: "#7C2D12", fontSize: 12.5, fontWeight: "800" }}>{flaggedCount}</Text>
          </View>
        )}
      </View>

      {/* Detection outline (real engine bounds) or the resting paper guide */}
      {(live || camStatus === "starting") &&
        (bounds ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 190 }}>
            <View
              style={{
                position: "absolute",
                left: pc(bounds.x),
                top: pc(bounds.y),
                width: pc(bounds.w),
                height: pc(bounds.h),
                borderWidth: 3,
                borderRadius: 14,
                borderColor: bannerTone,
                backgroundColor: decision.phase === "captureReady" ? "rgba(126,227,193,0.10)" : "rgba(126,227,193,0.04)",
              }}
            />
          </View>
        ) : (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 190, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 228, height: 290 }}>
              <View style={{ position: "absolute", top: 0, left: 0, width: 30, height: 30, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12, borderColor: "rgba(126,227,193,0.6)" }} />
              <View style={{ position: "absolute", top: 0, right: 0, width: 30, height: 30, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12, borderColor: "rgba(126,227,193,0.6)" }} />
              <View style={{ position: "absolute", bottom: 0, left: 0, width: 30, height: 30, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12, borderColor: "rgba(126,227,193,0.6)" }} />
              <View style={{ position: "absolute", bottom: 0, right: 0, width: 30, height: 30, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12, borderColor: "rgba(126,227,193,0.6)" }} />
            </View>
          </View>
        ))}

      {/* State banner + guidance */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 190, alignItems: "center", gap: 6 }}>
        <View style={{ backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8, maxWidth: "85%" }}>
          <Text style={{ color: bannerTone, fontSize: 13.5, fontWeight: "800", textAlign: "center" }}>{t(bannerKey)}</Text>
        </View>
        {guidanceKey && <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12.5, fontWeight: "600" }}>{t(guidanceKey)}</Text>}
        {lastSaveFailed && (
          <View style={{ backgroundColor: "rgba(248,113,113,0.92)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "700" }}>{t(lastSaveFailed)}</Text>
          </View>
        )}
      </View>

      {/* Controls: start / pause+resume / end / manual capture */}
      <View style={{ position: "absolute", bottom: insets.bottom + 84, left: 0, right: 0, alignItems: "center", gap: 12 }}>
        {phase === "idle" ? (
          <Btn label={t("lsStart")} onPress={startSession} />
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 22 }}>
              <RoundToggle
                onPress={phase === "running" ? pause : resume}
                label={phase === "running" ? t("lsPause") : t("lsResume")}
              >
                {phase === "running" ? <Pause size={20} color="#fff" /> : <Play size={20} color="#fff" />}
              </RoundToggle>
              <Pressable
                onPress={() => void manualCapture()}
                accessible
                accessibilityRole="button"
                accessibilityLabel={t("capture")}
                style={({ pressed }: { pressed: boolean }) => ({
                  width: 74,
                  height: 74,
                  borderRadius: 37,
                  backgroundColor: "rgba(255,255,255,0.22)",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#fff" }} />
              </Pressable>
              <RoundToggle onPress={endSession} label={t("lsEnd")}>
                <Square size={18} color="#F87171" />
              </RoundToggle>
            </View>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600" }}>{t("lsManualHint")}</Text>
          </>
        )}
        {decision.phase === "capturing" || decision.phase === "saving" ? (
          <ActivityIndicator color="#7EE3C1" />
        ) : null}
      </View>

      {/* Captured-paper queue: real saved captures, tap to inspect */}
      {captures.length > 0 && (
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(11,36,28,0.96)", paddingTop: 8, paddingBottom: insets.bottom + 6 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {captures.map((c) => (
              <Press key={c.id} onPress={() => setInspecting(c)} accessibilityLabel={t("lsCaptureN").replace("{n}", String(c.seq))}>
                <View style={{ width: 56, height: 72, borderRadius: 8, backgroundColor: C.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                  {thumbs[c.id] ? (
                    <Image source={{ uri: thumbs[c.id] }} style={{ width: 56, height: 72 }} resizeMode="cover" />
                  ) : (
                    <Text style={{ fontSize: 10, color: C.faint, paddingHorizontal: 2, textAlign: "center" }}>
                      {c.status === "saveFailed" ? t("lsSaveFailed") : c.status}
                    </Text>
                  )}
                  {c.possibleDuplicate && (
                    <View style={{ position: "absolute", top: 2, right: 2 }}>
                      <Flag size={12} color="#FBBF24" />
                    </View>
                  )}
                </View>
              </Press>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/** 44pt round control (pause / end). */
function RoundToggle({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }: { pressed: boolean }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: "rgba(0,0,0,0.45)",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}
