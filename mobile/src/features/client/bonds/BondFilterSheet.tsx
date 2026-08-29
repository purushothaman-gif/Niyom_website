/**
 * The bond filter, as a sheet.
 *
 * Same seven categories, same buckets and the same live match count as the
 * website's modal — all of it from `shared/portal/bonds/bondFilters.ts`, so this
 * file decides nothing about what a filter MEANS. It only draws it.
 *
 * ## Why the category rail survived the port
 *
 * The obvious phone shape is seven accordions in one scroll, and it was the
 * wrong one: with Rating and Payout collapsed below the fold, choosing a yield
 * band and a rating means scrolling, tapping, and scrolling back to check the
 * count. The rail keeps every category one tap away and the count permanently
 * visible in the footer, which is what makes the filter feel cheap to try. At
 * 375pt it splits 116/259 — narrow, but these are one-word labels.
 *
 * ## Why the draft is local
 *
 * Nothing filters until Apply. Live filtering behind a sheet means the list
 * re-flows under a surface the client cannot see, and "Show 12 bonds" is a
 * better promise than a number that already changed.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, X } from 'lucide-react-native';
import {
  EMPTY_FILTERS,
  countFilters,
  filterCategories,
  matchesFilters,
  toggleFilter,
  type BondFilterCategory,
  type BondFilters,
} from '@shared/portal/bonds/bondFilters';
import type { FilterableBond } from '@shared/portal/bonds/bondMath';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';

export function BondFilterSheet({
  bonds,
  initial,
  onApply,
  onClose,
}: {
  bonds: FilterableBond[];
  initial: BondFilters;
  onApply: (f: BondFilters) => void;
  onClose: () => void;
}) {
  const p = usePalette();
  const [draft, setDraft] = useState<BondFilters>(initial);
  const [cat, setCat] = useState<BondFilterCategory>('yield');

  const cats = useMemo(() => filterCategories(bonds), [bonds]);
  const activeCat = cats.find((c) => c.key === cat) ?? cats[0];

  const total = countFilters(draft);
  const matchCount = useMemo(
    () => bonds.filter((b) => matchesFilters(b, draft)).length,
    [bonds, draft],
  );

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: p.bg.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: p.bg.elevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            // Tall enough that the option list is not a peephole, short enough
            // that the list underneath stays visible as context.
            height: '82%',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: space[5],
              paddingVertical: space[4],
              borderBottomWidth: 1,
              borderBottomColor: p.border.subtle,
            }}
          >
            <Text variant="h2">Filter</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close filters">
              <X size={20} color={p.text.muted} />
            </Pressable>
          </View>

          {/* Category rail + options */}
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <ScrollView
              style={{
                width: 116,
                flexGrow: 0,
                backgroundColor: p.bg.surface,
                borderRightWidth: 1,
                borderRightColor: p.border.subtle,
              }}
              contentContainerStyle={{ paddingVertical: space[2] }}
              showsVerticalScrollIndicator={false}
            >
              {cats.map((c) => {
                const n = draft[c.key].length;
                const on = c.key === cat;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setCat(c.key);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: space[1],
                      paddingHorizontal: space[3],
                      paddingVertical: space[3],
                      backgroundColor: on ? p.bg.elevated : 'transparent',
                      borderLeftWidth: 2,
                      borderLeftColor: on ? p.accent.DEFAULT : 'transparent',
                    }}
                  >
                    <Text
                      variant="smallMedium"
                      tone={on ? 'accent' : 'secondary'}
                      numberOfLines={2}
                      style={{ flex: 1 }}
                    >
                      {c.label}
                    </Text>
                    {n > 0 ? (
                      <View
                        style={{
                          minWidth: 16,
                          paddingHorizontal: 4,
                          paddingVertical: 1,
                          borderRadius: radius.full,
                          alignItems: 'center',
                          backgroundColor: p.accent.tint(0.18),
                        }}
                      >
                        <Text variant="caption" tone="accent">
                          {n}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: space[4], gap: space[2] }}
              showsVerticalScrollIndicator={false}
            >
              <Text variant="overline" tone="faint" caps style={{ marginBottom: space[1] }}>
                {activeCat?.label ?? ''}
              </Text>

              {!activeCat || activeCat.opts.length === 0 ? (
                <Text variant="small" tone="muted" center style={{ paddingVertical: space[8] }}>
                  No options available for the bonds on offer.
                </Text>
              ) : (
                activeCat.opts.map((o) => {
                  const checked = draft[activeCat.key].includes(o.k);
                  return (
                    <Pressable
                      key={o.k}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setDraft((d) => toggleFilter(d, activeCat.key, o.k));
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: space[3],
                        paddingHorizontal: space[3],
                        paddingVertical: space[3],
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: checked ? p.accent.tint(0.4) : p.border.DEFAULT,
                        backgroundColor: checked ? p.bg.selected : p.bg.surface,
                      }}
                    >
                      <Text
                        variant="small"
                        tone={checked ? 'primary' : 'secondary'}
                        numberOfLines={2}
                        style={{ flex: 1 }}
                      >
                        {o.label}
                      </Text>
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: radius.sm,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: checked ? p.accent.DEFAULT : p.border.DEFAULT,
                          backgroundColor: checked ? p.accent.DEFAULT : 'transparent',
                        }}
                      >
                        {checked ? <Check size={13} color={p.text.onAccent} strokeWidth={3} /> : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>

          {/* Footer */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              paddingHorizontal: space[5],
              paddingTop: space[4],
              paddingBottom: space[7],
              borderTopWidth: 1,
              borderTopColor: p.border.subtle,
            }}
          >
            <Pressable
              onPress={() => setDraft(EMPTY_FILTERS)}
              disabled={total === 0}
              hitSlop={8}
              style={{ opacity: total === 0 ? 0.4 : 1, paddingVertical: space[2] }}
            >
              <Text variant="smallMedium" tone="secondary">
                Clear All
              </Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Button
                label={total > 0 ? `Show ${matchCount} bond${matchCount === 1 ? '' : 's'}` : 'Apply filters'}
                onPress={() => {
                  onApply(draft);
                  onClose();
                }}
                fullWidth
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
