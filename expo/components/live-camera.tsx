import { CameraOff, ImagePlus, RefreshCw } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/lib/i18n";

type CamStatus = "starting" | "live" | "denied" | "unavailable";

/**
 * Real live viewfinder for the scan stage on the web (react-native-web) build.
 * Native camera modules (expo-camera) cannot run in this environment, so on
 * web the viewfinder is the browser's own camera: a getUserMedia video stream
 * rendered as a true <video> element, frames captured through a canvas, and a
 * hardware torch applied via track constraints when the browser exposes one.
 * Photo upload is demoted to an explicit fallback shown only when no live
 * camera exists. Native (device) builds never mount this component — they
 * keep the system-camera capture path.
 */
export function LiveCamera({
  torchOn,
  onFrame,
  onPhotoFallback,
  registerCapture,
}: {
  torchOn: boolean;
  onFrame: (base64: string) => void;
  onPhotoFallback: () => void;
  registerCapture: (fn: (() => void) | null) => void;
}) {
  const { t } = useI18n();
  const hostRef = useRef<View>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CamStatus>("starting");
  const [attempt, setAttempt] = useState(0);

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
          // Rear camera on phones, webcam on desktop — whatever the device has.
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
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
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string }).name ?? "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
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
  }, [attempt]);

  // Hardware torch when the browser supports it (e.g. Android Chrome). The
  // screen-light panel remains the honest fallback everywhere else.
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    if (!caps?.torch) return;
    // `torch` is a Chromium extension to the constraint set — cast past the
    // standard DOM type, guarded by the getCapabilities check above.
    void track
      .applyConstraints({ advanced: [{ torch: torchOn }] } as unknown as MediaTrackConstraints)
      .catch(() => {});
  }, [torchOn, status]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    // Keep the payload reasonable; the engine's own quality gates judge the frame.
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    onFrame(dataUrl.slice(dataUrl.indexOf(",") + 1));
  };
  // Keep the shutter / chain-mode trigger pointed at the latest capture.
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    if (status !== "live") return undefined;
    registerCapture(() => captureRef.current());
    return () => registerCapture(null);
  }, [status, registerCapture]);

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
            onPress={onPhotoFallback}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("scanCamPhoto")}
            style={({ pressed }: { pressed: boolean }) => [
              styles.fallbackBtn,
              { backgroundColor: "rgba(255,255,255,0.16)", opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <ImagePlus size={15} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "800" }}>{t("scanCamPhoto")}</Text>
          </Pressable>
        </View>
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
