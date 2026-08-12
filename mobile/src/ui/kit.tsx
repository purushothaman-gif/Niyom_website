/**
 * The small display primitives.
 *
 * Grouped in one file the way the website groups `src/portal/ui/kit.tsx`: these
 * are one-screen components with no state, and eleven separate files for them
 * costs more to navigate than it saves.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { radius, space } from '@/design/tokens';
import { usePalette, useTheme } from '@/design/ThemeProvider';
import { Text } from './Text';
import { Card } from './Card';

/* -------------------------------------------------------------------------- */
/*  Section header                                                            */
/* -------------------------------------------------------------------------- */

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: space[3],
        gap: space[3],
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="h2">{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text variant="smallMedium" tone="accent">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status pill                                                               */
/* -------------------------------------------------------------------------- */

export type PillTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'accent';

export function StatusPill({
  label,
  tone = 'neutral',
  dot,
}: {
  label: string;
  tone?: PillTone;
  /** A filled dot before the label — for live/stale states. */
  dot?: boolean;
}) {
  const p = usePalette();
  const color =
    tone === 'success'
      ? p.state.successSoft
      : tone === 'danger'
        ? p.state.dangerSoft
        : tone === 'warning'
          ? p.state.warningSoft
          : tone === 'info'
            ? p.state.infoSoft
            : tone === 'accent'
              ? p.accent.DEFAULT
              : p.text.muted;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1] + 2,
        alignSelf: 'flex-start',
        paddingHorizontal: space[2] + 2,
        paddingVertical: 4,
        borderRadius: radius.full,
        backgroundColor: `${color}1F`, // ~12% — a tint, not a fill
        borderWidth: 1,
        borderColor: `${color}33`,
      }}
    >
      {dot ? (
        <View style={{ width: 6, height: 6, borderRadius: radius.full, backgroundColor: color }} />
      ) : null}
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

export function ComingSoonBadge() {
  return <StatusPill label="Coming soon" tone="neutral" />;
}

/* -------------------------------------------------------------------------- */
/*  KPI stat                                                                  */
/* -------------------------------------------------------------------------- */

export function KpiStat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  style,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: 'success' | 'danger' | 'accent';
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const valueColor =
    tone === 'success'
      ? p.state.successSoft
      : tone === 'danger'
        ? p.state.dangerSoft
        : tone === 'accent'
          ? p.accent.DEFAULT
          : p.text.primary;

  return (
    <Card weight="surface" padding={4} style={[{ flex: 1, minWidth: 150 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        {Icon ? <Icon size={13} color={p.text.muted} style={{ marginTop: 1 }} /> : null}
        {/*
         * Two lines, not one. These sit two-across on a 375pt screen, and
         * "Awaiting payment" truncating to "Awaiting paym…" beside a rupee
         * figure makes the number ambiguous — which is the one thing a KPI
         * tile must never be.
         */}
        <Text variant="overline" tone="muted" caps numberOfLines={2} style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <Text variant="moneySmall" style={{ color: valueColor, marginTop: space[2] }}>
        {value}
      </Text>
      {sub ? (
        <Text variant="caption" tone="faint" style={{ marginTop: 2 }} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  List row                                                                  */
/* -------------------------------------------------------------------------- */

export function ListRow({
  title,
  subtitle,
  value,
  valueSub,
  valueTone,
  icon: Icon,
  iconColor,
  onPress,
  showChevron,
  last,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  valueSub?: string;
  valueTone?: 'success' | 'danger' | 'muted';
  icon?: LucideIcon;
  iconColor?: string;
  onPress?: () => void;
  showChevron?: boolean;
  /** Drops the hairline under the last row of a group. */
  last?: boolean;
}) {
  const p = usePalette();
  const vColor =
    valueTone === 'success'
      ? p.state.successSoft
      : valueTone === 'danger'
        ? p.state.dangerSoft
        : valueTone === 'muted'
          ? p.text.muted
          : p.text.primary;

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingVertical: space[3] + 2,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: p.border.subtle,
      }}
    >
      {Icon ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.sm + 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${iconColor ?? p.accent.DEFAULT}1A`,
          }}
        >
          <Icon size={18} color={iconColor ?? p.accent.DEFAULT} strokeWidth={2} />
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="moneySmall" style={{ color: vColor }}>
            {value}
          </Text>
          {valueSub ? (
            <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
              {valueSub}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showChevron ? <ChevronRight size={17} color={p.text.faint} /> : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      android_ripple={{ color: p.bg.hover }}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*  Segmented control                                                         */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: p.bg.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: p.border.subtle,
          padding: 3,
          gap: 3,
        },
        style,
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(opt.value);
            }}
            style={{
              flex: 1,
              paddingVertical: space[2],
              borderRadius: radius.sm,
              alignItems: 'center',
              backgroundColor: active ? p.accent.tint(0.16) : 'transparent',
            }}
          >
            <Text variant="smallMedium" tone={active ? 'accent' : 'muted'} numberOfLines={1}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                               */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space[9], gap: space[3] }}>
      {Icon ? (
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.bg.surface,
            borderWidth: 1,
            borderColor: p.border.subtle,
          }}
        >
          <Icon size={26} color={p.text.faint} strokeWidth={1.6} />
        </View>
      ) : null}
      <Text variant="h3" center>
        {title}
      </Text>
      {message ? (
        <Text variant="small" tone="muted" center style={{ maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space[2] }}>{action}</View> : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Skeleton                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A shimmering placeholder, used instead of a spinner wherever the SHAPE of
 * what is coming is known. A dashboard that fades in at the right size feels
 * faster than an identical one behind a spinner, because nothing jumps.
 */
export function Skeleton({
  width,
  height = 16,
  rounded = 'sm',
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  rounded?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(0.9, { duration: 750 }), withTiming(0.45, { duration: 750 })),
      -1,
      false,
    );
  }, [pulse]);

  const anim = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        {
          width: width ?? '100%',
          height,
          borderRadius: radius[rounded],
          backgroundColor: p.bg.raised,
        },
        anim,
        style,
      ]}
    />
  );
}

/** The generic "loading a screen" block — three stacked skeleton cards. */
export function SkeletonScreen({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ gap: space[4] }}>
      <Skeleton height={120} rounded="lg" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={72} rounded="lg" />
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline loading / error                                                    */
/* -------------------------------------------------------------------------- */

export function Loading({ label }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: space[9], alignItems: 'center', gap: space[3] }}>
      <ActivityIndicator color={p.accent.DEFAULT} />
      {label ? (
        <Text variant="small" tone="muted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { theme: p } = useTheme();
  return (
    <View style={{ paddingVertical: space[8], alignItems: 'center', gap: space[3] }}>
      <Text variant="body" center tone="secondary" style={{ maxWidth: 320 }}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          style={{
            paddingHorizontal: space[4],
            paddingVertical: space[2] + 2,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.border.strong,
            backgroundColor: p.bg.surface,
          }}
        >
          <Text variant="smallMedium">Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
