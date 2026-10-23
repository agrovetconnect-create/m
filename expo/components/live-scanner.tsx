import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraOff, RefreshCw, SwitchCamera } from "lucide-react-native";
import { useI18n } from "@/lib/i18n";
import { detectPaper, grayFromRgba, type GrayFrame, type PaperRegion } from "@/src/scanning/paper-detect";

export type CamStatus = "starting" | "live" | "denied" | "unavailable";

export type ScannerSample = {
  regions: PaperRegion[];
  frame: GrayFrame;
};

/**
 * Stage 5 live scanner — the web platform adapter (react-native-web build).
 * A real getUserMedia stream is sampled at ~5 fps: each sample is downscaled,
 * converted to grayscale and pushed through the paper detector. The host
 * screen owns the capture tracker — this component only acquires frames and
 * provides high-resolution grabs when the tracker asks for them.
 *
 * Frames are analyzed in the page's own thread (single-threaded JS) — the
 * analysis frame is 320 px wide (≈3 ms per sample, measured) so the preview
 * stays responsive. Full-resolution frames exist ONLY for the instant a
 * capture is requested and are released right after JPEG encoding.
 *
 * Native builds never mount this component: without a dev build (expo-camera
 * is refused in this environment) there is no frame pipeline to analyze —
 * the honest system-camera path lives in the host screen instead.
 */
export function LiveScanner({
  paused,
  facing,
  onSample,
  onFallback,
  registerCapture,
  onSwitchCamera,
  onStatus,
}: {
  paused: boolean;
  facing: "environment" | "user";
  /** Called per analyzed sample (~5 fps while not paused). */
  onSample: (s: ScannerSample) => void;
  /** Explicit fallback when no live camera exists. */
  onFallback: () => void;
  /** Camera status changes, so the host banner can show every state. */
  onStatus?: (s: CamStatus) => void;
  /** Register the high-res grab used when the tracker requests a capture. */
  registerCapture: (fn: (() => string | null) | null) => void;
  /** Cycle to the other camera when the platform provides one. */
  onSwitchCamera?: () => void;
}) {
  const { t } = useI18n();
  const hostRef = useRef<View>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CamStatus>("starting");
  const [attempt, setAttempt] = useState(0);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const sampleRef = useRef(onSample);
  sampleRef.current = onSample;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  // Start (and always stop) the camera stream with the component's lifecycle.
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host || typeof document === "undefined") return undefined;
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.setAttribute("playsinline", "true");
    video.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#0B231B;";
    host.appendChild(video);
    videoRef.current = video;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) setStatus("unavailable");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        void video.play().catch(() => {});
        setStatus("live");
        statusRef.current?.("live");
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string }).name ?? "";
        const next = name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
        setStatus(next);
        statusRef.current?.(next);
      }
    };
    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      videoRef.current = null;
      video.remove();
    };
  }, [attempt, facing]);

  // Continuous detection loop: sample the stream at ~5 fps, analyze at the
  // reduced resolution, hand candidates to the host tracker. Skips entirely
  // while paused (no analysis, no captures — master §12).
  useEffect(() => {
    if (status !== "live") return undefined;
    const analysis = document.createElement("canvas");
    const ANALYSIS_W = 320;
    const ctx = analysis.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || pausedRef.current || video.readyState < 2 || video.videoWidth === 0) return;
      const scale = ANALYSIS_W / video.videoWidth;
      analysis.width = Math.round(video.videoWidth * scale);
      analysis.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, analysis.width, analysis.height);
      const img = ctx.getImageData(0, 0, analysis.width, analysis.height);
      const frame = grayFromRgba(img.data, analysis.width, analysis.height, 320);
      sampleRef.current({ regions: detectPaper(frame), frame });
    }, 200);
    return () => window.clearInterval(timer);
  }, [status]);

  // High-resolution grab for requested captures (never on a timer).
  useEffect(() => {
    if (status !== "live") {
      registerCapture(null);
      return undefined;
    }
    registerCapture(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", 0.72);
      return url.slice(url.indexOf(",") + 1);
    });
    return () => registerCapture(null);
  }, [status, registerCapture]);

  const canSwitch = status === "live" && onSwitchCamera;

  return (
    <>
      {/* Live stream layer: raw DOM video inside a real RN view (never tappable). */}
      <View
        ref={hostRef}
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0B231B" }}
      />
      {status === "starting" && (
        <View pointerEvents="none" style={styles.center}>
          <ActivityIndicator color="#7EE3C1" />
          <Text style={styles.msg}>{t("scanCamStarting")}</Text>
        </View>
      )}
      {(status === "denied" || status === "unavailable") && (
        <View style={[styles.center, styles.fallback, { gap: 14 }]}>
          <CameraOff size={34} color="rgba(255,255,255,0.85)" />
          <Text style={[styles.msg, styles.msgCenter]}>
            {status === "denied" ? t("scanCamDeniedBody") : t("scanCamUnavailableBody")}
          </Text>
          {status === "denied" && (
            <Pressable
              onPress={() => setAttempt((a) => a + 1)}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("scanCamRetry")}
              style={({ pressed }: { pressed: boolean }) => [
                styles.fallbackBtn,
                { backgroundColor: "#FBFDF6", opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <RefreshCw size={15} color="#047857" />
              <Text style={{ color: "#047857", fontSize: 13.5, fontWeight: "800" }}>{t("scanCamRetry")}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onFallback}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("scanCamPhoto")}
            style={({ pressed }: { pressed: boolean }) => [
              styles.fallbackBtn,
              { backgroundColor: "rgba(255,255,255,0.16)", opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "800" }}>{t("scanCamPhoto")}</Text>
          </Pressable>
        </View>
      )}
      {canSwitch && (
        <Pressable
          onPress={onSwitchCamera}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t("lsCamSwitch")}
          style={({ pressed }: { pressed: boolean }) => ({
            position: "absolute",
            bottom: 130,
            left: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <SwitchCamera size={20} color="#fff" />
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  fallback: {
    backgroundColor: "rgba(11,35,27,0.94)",
    paddingHorizontal: 28,
  },
  msg: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13.5,
    fontWeight: "600",
  },
  msgCenter: {
    textAlign: "center",
    lineHeight: 20,
  },
  fallbackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
});
