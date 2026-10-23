import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleProp,
  ViewStyle,
  TextStyle,
  TextInput,
  Image,
} from "react-native";
import { ArrowLeft, ChevronRight, Search, ClipboardCheck, X } from "lucide-react-native";

/** The app's display name, used consistently across branding surfaces. */
export const APP_NAME = "MarkBook";

/** Design-system colors sampled from the approved mockups */
export const C = {
  bg: "#F0F3EF",
  card: "#FFFFFF",
  ink: "#1F261F",
  sub: "#67736A",
  faint: "#98A39A",
  line: "#E5EAE4",
  green: "#1B5E3B",
  greenDeep: "#14472C",
  greenDarker: "#0E3A23",
  greenTint: "#E7EFE6",
  greenChip: "#DFEBDD",
  pill: "#D8E6D8",
  yellow: "#F2BC40",
  yellowTint: "#FBF2DA",
  amber: "#E8A013",
  amberText: "#A4680C",
  orange: "#E8871E",
  red: "#C63A2F",
  darkScreen: "#0B1F15",
  darkKey: "#1B3527",

  // Amber family (warnings, flagged records, conflict cards)
  amberCard: "#FBF3DC",
  amberLine: "#F0E3BC",
  amberChip: "#F6E7C6",
  amberSoft: "#FDEFD2",
  amberBtn: "#EDAF3C",
  amberInk: "#3D2A05",
  amberDark: "#6B5416",

  // Neutrals (chips, tracks, hairlines)
  chipGrey: "#EDF1EC",
  rowGrey: "#F1F4F0",
  greyBg: "#E7ECE6",
  fieldBg: "#F4F6F3",
  trackOff: "#D6DCD5",
  borderOff: "#B9C2BA",
  hairline: "#EFF2EE",
  chevron: "#5C6A5F",
  grabber: "#D4DAD3",

  // Green accents on light surfaces
  greenSoft: "#EAF2E9",
  greenBorder: "#D5E5D4",
  okBg: "#DFF0E0",
  okBorder: "#7FB28A",

  // Dark-green header palette
  headerGreen: "#1E5A39",
  headerLine: "#3A6B4C",
  headerSub: "#CFE2D2",
  headerFaint: "#9FC6AA",
  headerText: "#E8F0E8",
};

/** Pressable with the 0.97 scale-down micro-interaction */
export function Press({
  children,
  style,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessible={!!accessibilityLabel || !!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }: { pressed: boolean }) => [
        { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: C.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: C.line,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Btn({
  label,
  onPress,
  variant = "primary",
  icon,
  style,
  labelStyle,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "outline" | "amber" | "grey";
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
}) {
  const bg =
    variant === "primary"
      ? C.green
      : variant === "amber"
        ? C.amberBtn
        : variant === "grey"
          ? C.chipGrey
          : "transparent";
  const fg =
    variant === "outline" ? C.green : variant === "amber" ? C.amberInk : variant === "grey" ? C.sub : "#FFFFFF";
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[
        {
          backgroundColor: bg,
          borderRadius: 28,
          borderWidth: variant === "outline" ? 1.5 : 0,
          borderColor: variant === "outline" ? C.green : "transparent",
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingHorizontal: 20,
        },
        style,
      ]}
    >
      {icon}
      <Text style={[{ color: fg, fontSize: 16, fontWeight: "700" }, labelStyle]}>{label}</Text>
    </Press>
  );
}

export function Chip({
  label,
  active,
  tint,
  fg,
  icon,
  onPress,
  style,
}: {
  label: string;
  active?: boolean;
  tint?: string;
  fg?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={active ? { selected: true } : undefined}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          backgroundColor: tint ?? (active ? C.green : C.bg),
          borderRadius: 20,
          paddingHorizontal: 14,
          height: 36,
          borderWidth: active ? 0 : 1,
          borderColor: tint ? "transparent" : C.line,
        },
        style,
      ]}
    >
      {icon}
      <Text style={{ color: fg ?? (active ? "#fff" : C.sub), fontSize: 13.5, fontWeight: "600" }}>{label}</Text>
    </Press>
  );
}

/** Rounded light-green icon tile used across cards */
export function IconTile({
  children,
  size = 52,
  bg = C.greenTint,
  radius = 14,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  bg?: string;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Avatar({
  text,
  size = 40,
  bg = C.greenTint,
  fg = C.green,
  fontSize,
}: {
  text: string;
  size?: number;
  bg?: string;
  fg?: string;
  fontSize?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: fontSize ?? size * 0.36 }}>{text}</Text>
    </View>
  );
}

export function Progress({
  frac,
  color = C.green,
  track = "#E2E8E1",
  height = 5,
  style,
}: {
  frac: number;
  color?: string;
  track?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: "hidden" }, style]}>
      <View style={{ width: `${Math.round(frac * 100)}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

export function Grabber() {
  return (
    <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
      <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: C.grabber }} />
    </View>
  );
}

/** Small status pill e.g. Scanned / Manual / Locked */
export function StatusPill({
  label,
  tint = C.greenChip,
  fg = C.green,
  icon,
}: {
  label: string;
  tint?: string;
  fg?: string;
  icon?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: tint,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      {icon}
      <Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Chevron({ size = 20, color = C.chevron }: { size?: number; color?: string }) {
  return <ChevronRight size={size} color={color} strokeWidth={2.2} />;
}

/**
 * General education-brand logo: rounded green mark with a clipboard-check
 * glyph, optional wordmark. Not tied to any individual school.
 */
export function Logo({ size = 40, wordmark = false, fg = "#FFFFFF" }: { size?: number; wordmark?: boolean; fg?: string }) {
  return (
    <View style={{ flexDirection: wordmark ? "row" : "column", alignItems: "center", gap: 10 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: C.green,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ClipboardCheck size={size * 0.56} color={fg} strokeWidth={2.2} />
      </View>
      {wordmark && (
        <Text style={{ fontSize: size * 0.52, fontWeight: "800", color: C.ink, letterSpacing: -0.3 }}>
          {APP_NAME}
        </Text>
      )}
    </View>
  );
}

/** Shared settings-style row: icon + label (+ value / chevron). */
export function ListRow({
  icon,
  label,
  value,
  onPress,
  last,
  danger,
  right,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Press onPress={onPress} disabled={!onPress} accessibilityLabel={label}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          gap: 14,
          borderTopWidth: last ? 1 : 0,
          borderTopColor: C.line,
        }}
      >
        {icon}
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: danger ? C.red : C.ink }}>{label}</Text>
        {value !== undefined && (
          <Text style={{ fontSize: 14, color: C.sub, textAlign: "right", flexShrink: 1 }}>{value}</Text>
        )}
        {right ?? (onPress ? <Chevron color={C.chevron} /> : null)}
      </View>
    </Press>
  );
}

/** Student/teacher initials for avatars — the single shared implementation. */
export function initialsOf(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((p) => p[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Shared plain-screen header: back arrow (or X) + centered title (one style across the app). */
export function ScreenHeader({
  title,
  onBack,
  accessibilityLabel,
  close = false,
}: {
  title: string;
  onBack: () => void;
  accessibilityLabel?: string;
  /** Renders a dismiss (X) instead of the back arrow — used by full-flow screens like scanning. */
  close?: boolean;
}) {
  // Titles always read as proper headings, even when a translation is lowercase.
  const display = title.charAt(0).toUpperCase() + title.slice(1);
  return (
    <View style={{ paddingTop: 10 }}>
      <View style={{ height: 46, alignItems: "center", justifyContent: "center" }}>
        <Text
          style={{ fontSize: 20, fontWeight: "800", color: C.ink, textAlign: "center", paddingHorizontal: 60, lineHeight: 28 }}
          numberOfLines={1}
        >
          {display}
        </Text>
      </View>
      <Press
        onPress={onBack}
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        style={{ position: "absolute", left: 14, top: 11, width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      >
        {close ? <X size={24} color={C.green} strokeWidth={2.4} /> : <ArrowLeft size={24} color={C.green} strokeWidth={2.4} />}
      </Press>
    </View>
  );
}

/** Shared rounded search field (archive, help, roster search). */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <View
      style={{
        backgroundColor: C.greyBg,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        height: 50,
        gap: 10,
      }}
    >
      <Search size={20} color={C.sub} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.sub}
        style={{ flex: 1, fontSize: 15.5, color: C.ink }}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Shared "Mar 5, 14:32" formatting — one locale style everywhere. */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Read-only info row (icon + label + right-aligned value). */
export function InfoRow({
  icon,
  label,
  value,
  last,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 15,
        gap: 14,
        borderTopWidth: last ? 1 : 0,
        borderTopColor: C.line,
      }}
    >
      {icon}
      <Text style={{ flex: 1, fontSize: 15.5, color: C.ink }}>{label}</Text>
      <Text style={{ fontSize: 14, color: C.sub, textAlign: "right", flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

/** Generated empty-state illustrations, hosted per asset key. */
export const ILLUSTRATIONS = {
  login: "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/0c407553-3893-4aba-b37d-55f330a6d392.png",
  classSetup: "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/f53762a1-079d-4f32-8668-7b1325d27cf1.png",
  newMarksheet: "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/ef9f26ac-f544-4141-af44-bec049f10c55.png",
  entrySheet: "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/4f4490ea-f9d7-4c36-87cc-9aab54d51683.png",
  resetPassword: "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/8545ff4e-b3b0-4688-abc5-9bef32c91e8b.png",
  requestCorrection: "https://qshek8cmnlm0stp2p66gq.rork.app/~assets/img/1154ad82-7466-40c8-8c04-a7bfd4c6d5ce.png",
} as const;

export type IlluName = keyof typeof ILLUSTRATIONS;

/** Unbordered illustration + caption, used on input screens per the design spec. */
export function Illu({ name, label }: { name: IlluName; label?: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 16 }} pointerEvents="none">
      <Image
        source={{ uri: ILLUSTRATIONS[name] }}
        style={{ width: 148, height: 148 }}
        resizeMode="contain"
        accessibilityLabel={label ?? name}
      />
      {label ? (
        <Text style={{ fontSize: 12.5, color: C.sub, textAlign: "center", marginTop: 4, lineHeight: 18 }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}
