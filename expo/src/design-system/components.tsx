import React from "react";
import { View, Text, ActivityIndicator, Modal, StyleSheet } from "react-native";
import {
  Sparkles,
  AlertTriangle,
  Pencil,
  CheckCircle2,
  XCircle,
  Check,
  Copy,
  WifiOff,
  AlertCircle,
  type LucideIcon,
} from "lucide-react-native";
import { Press, Card } from "@/components/ui";
import { useTheme, type Theme } from "./theme";
import { statusSemantics, type StatusKey, TOUCH_TARGET } from "./tokens";

/**
 * Stage 2 design-system components — the pieces the Stage 2 spec requires
 * that the legacy kit (`components/ui.tsx`) doesn't already cover. Everything
 * here reads colors through `useTheme()` and takes its strings as props, so
 * components stay i18n-agnostic.
 */

const STATUS_ICONS: Record<StatusKey, LucideIcon> = {
  extracted: Sparkles,
  needsReview: AlertTriangle,
  corrected: Pencil,
  approved: CheckCircle2,
  rejected: XCircle,
  exported: Check,
  duplicate: Copy,
  offline: WifiOff,
  error: AlertCircle,
};

function toneColors(tone: string, theme: Theme): { fg: string; bg: string } {
  const p = theme.palette;
  switch (tone) {
    case "success":
      return { fg: p.success, bg: p.successBg };
    case "warning":
      return { fg: p.warning, bg: p.warningBg };
    case "danger":
      return { fg: p.danger, bg: p.dangerBg };
    case "info":
      return { fg: p.info, bg: p.infoBg };
    default:
      return { fg: p.neutral, bg: p.neutralBg };
  }
}

/**
 * Semantic status badge for the review lifecycle (AI-extracted, needs review,
 * teacher-corrected, approved, rejected, exported) and scanning exceptions.
 * Always pairs the label with an icon so status is never color-only.
 */
export function StatusBadge({
  status,
  label,
  style,
}: {
  status: StatusKey;
  /** Pre-translated label, e.g. `t("needsReview")`. */
  label: string;
  style?: object;
}) {
  const theme = useTheme();
  const { tone, icon } = statusSemantics[status];
  const { fg, bg } = toneColors(tone, theme);
  const Icon = STATUS_ICONS[status];
  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          backgroundColor: bg,
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 4,
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      <Icon size={13} color={fg} strokeWidth={2.4} />
      <Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

/**
 * Confidence/review indicator for recognition results. Maps the engine's
 * 0–1 confidence onto the three review bands the product rules define:
 * ≥ 0.75 auto-fillable, 0.5–0.75 needs review, < 0.5 manual only.
 * The numeric score is shown next to the band label — never a bare gauge.
 */
export function ConfidenceIndicator({
  confidence,
  highLabel,
  reviewLabel,
  lowLabel,
}: {
  confidence: number;
  highLabel: string;
  reviewLabel: string;
  lowLabel: string;
}) {
  const theme = useTheme();
  const band = confidence >= 0.75 ? "high" : confidence >= 0.5 ? "review" : "low";
  const label = band === "high" ? highLabel : band === "review" ? reviewLabel : lowLabel;
  const status: StatusKey = band === "high" ? "extracted" : band === "review" ? "needsReview" : "rejected";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <StatusBadge status={status} label={`${Math.round(confidence * 100)}% · ${label}`} />
      <View
        accessible
        accessibilityLabel={`${Math.round(confidence * 100)}%`}
        style={{
          width: 56,
          height: 5,
          borderRadius: 3,
          backgroundColor: theme.palette.track,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`,
            height: 5,
            borderRadius: 3,
            backgroundColor: toneColors(statusSemantics[status].tone, theme).fg,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Empty state: icon, title, optional body, optional primary action.
 * Used wherever a list has no data yet — never a fabricated dashboard stat.
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const p = theme.palette;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={title}
      style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          backgroundColor: p.brandTint,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        {React.createElement(icon, { size: 30, color: p.brand, strokeWidth: 2 })}
      </View>
      <Text style={{ fontSize: 17, fontWeight: "700", color: p.ink, textAlign: "center" }}>{title}</Text>
      {body ? (
        <Text style={{ fontSize: 14, color: p.sub, textAlign: "center", marginTop: 6, lineHeight: 20 }}>{body}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Press
          onPress={onAction}
          accessibilityLabel={actionLabel}
          style={{
            marginTop: 18,
            height: 46,
            paddingHorizontal: 22,
            borderRadius: 23,
            backgroundColor: p.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: p.onBrand, fontSize: 15, fontWeight: "700" }}>{actionLabel}</Text>
        </Press>
      ) : null}
    </View>
  );
}

/**
 * Error state with a genuine recovery action (usually retry). `detail` is for
 * sanitized, non-technical hints — never raw stack traces or internals.
 */
export function ErrorState({
  title,
  detail,
  retryLabel,
  onRetry,
}: {
  title: string;
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const p = theme.palette;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ alignItems: "center", paddingVertical: 32, paddingHorizontal: 24 }}
    >
      <AlertCircle size={34} color={p.danger} strokeWidth={2} style={{ marginBottom: 12 }} />
      <Text style={{ fontSize: 16, fontWeight: "700", color: p.ink, textAlign: "center" }}>{title}</Text>
      {detail ? (
        <Text style={{ fontSize: 13.5, color: p.sub, textAlign: "center", marginTop: 6, lineHeight: 19 }}>{detail}</Text>
      ) : null}
      {retryLabel && onRetry ? (
        <Press
          onPress={onRetry}
          accessibilityLabel={retryLabel}
          style={{
            marginTop: 16,
            height: TOUCH_TARGET,
            minHeight: TOUCH_TARGET,
            paddingHorizontal: 20,
            borderRadius: 23,
            borderWidth: 1.5,
            borderColor: p.brand,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: p.brand, fontSize: 15, fontWeight: "700" }}>{retryLabel}</Text>
        </Press>
      ) : null}
    </View>
  );
}

/**
 * Loading skeleton block. Screens compose these into the shape of the content
 * they replace, so loading looks like the screen rather than a spinner.
 */
export function Skeleton({ width, height = 16, style }: { width?: number | `${number}%`; height?: number; style?: object }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      style={[
        {
          width: width ?? "100%",
          height,
          borderRadius: 7,
          backgroundColor: theme.palette.row,
        },
        style,
      ]}
    />
  );
}

/** Inline loading row for list footers ("loading more…"). */
export function LoadingRow({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 16, gap: 8 }}>
      <ActivityIndicator size="small" color={theme.palette.brand} />
      <Text style={{ color: theme.palette.sub, fontSize: 13.5 }}>{label}</Text>
    </View>
  );
}

/**
 * Confirmation dialog, required before any destructive or irreversible action
 * (deleting approved marks, overwriting a register). `confirmLabel` should
 * name the action ("Delete register"), never a bare "OK".
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const p = theme.palette;
  const confirmFg = destructive ? p.danger : p.brand;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} accessibilityViewIsModal>
      <View style={[styles.scrim, { backgroundColor: p.scrim }]}>
        <Card style={{ width: "86%", maxWidth: 420, padding: 20 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: p.ink }}>{title}</Text>
          {body ? (
            <Text style={{ fontSize: 14, color: p.sub, marginTop: 8, lineHeight: 20 }}>{body}</Text>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <Press
              onPress={onCancel}
              accessibilityLabel={cancelLabel}
              style={{
                height: TOUCH_TARGET,
                minHeight: TOUCH_TARGET,
                paddingHorizontal: 18,
                borderRadius: 22,
                backgroundColor: p.chip,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: p.sub, fontSize: 15, fontWeight: "700" }}>{cancelLabel}</Text>
            </Press>
            <Press
              onPress={onConfirm}
              accessibilityLabel={confirmLabel}
              style={{
                height: TOUCH_TARGET,
                minHeight: TOUCH_TARGET,
                paddingHorizontal: 18,
                borderRadius: 22,
                borderWidth: 1.5,
                borderColor: confirmFg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: confirmFg, fontSize: 15, fontWeight: "700" }}>{confirmLabel}</Text>
            </Press>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
