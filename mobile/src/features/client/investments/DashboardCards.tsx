/**
 * The dashboard's investment cards — top holdings, running SIPs and the
 * "import my portfolio" offer — the app's versions of the website's
 * `TopHoldingsCard`, `SipsCard` and `ImportHubBanner`.
 */
import { View } from 'react-native';
import { ChevronRight, PackagePlus } from 'lucide-react-native';
import { ASSET_META, type InvestmentRow } from '@shared/portal/investments/model';
import type { RtaSipRow } from '@shared/mf/rtaMf';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { inr, signOf, signedPct } from './format';

/** The client's largest holdings, compact. Returns stay "—" when cost is unknown. */
export function TopHoldingsCard({ rows, limit = 5, onOpen }: { rows: InvestmentRow[]; limit?: number; onOpen: () => void }) {
  const p = usePalette();
  if (!rows.length) return null;
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, limit);
  return (
    <Card padding={4} onPress={onOpen}>
      {top.map((r, i) => {
        const s = signOf(r.gainPct);
        return (
          <View
            key={r.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              paddingVertical: space[3],
              borderBottomWidth: i === top.length - 1 ? 0 : 1,
              borderBottomColor: p.border.subtle,
            }}
          >
            <View style={{ width: 4, height: 30, borderRadius: 2, backgroundColor: ASSET_META[r.asset].color }} />
            <View style={{ flex: 1 }}>
              <Text variant="smallMedium" numberOfLines={1}>
                {r.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
                {ASSET_META[r.asset].label}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="smallMedium">{inr(r.value)}</Text>
              <Text
                variant="caption"
                style={{
                  marginTop: 1,
                  color: s > 0 ? p.state.successSoft : s < 0 ? p.state.dangerSoft : p.text.faint,
                }}
              >
                {r.gainPct == null ? '—' : signedPct(r.gainPct)}
              </Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function nextInstalment(s: RtaSipRow, today = new Date()): Date | null {
  const day = Number(String(s.sipDay ?? '').replace(/\D/g, ''));
  if (!day || day < 1 || day > 31) return null;
  const f = (s.frequency ?? '').toLowerCase();
  if (f && !/month/.test(f)) return null;
  const d = new Date(today.getFullYear(), today.getMonth(), Math.min(day, 28));
  if (day > 28) d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setMonth(d.getMonth() + 1);
  if (s.toDate && d > new Date(s.toDate)) return null;
  return d;
}

/** Running SIPs/STPs/SWPs as the registrar reports them. */
export function SipsCard({ sips, onOpen }: { sips: RtaSipRow[]; onOpen?: () => void }) {
  const p = usePalette();
  const active = sips.filter((s) => s.status === 'active');
  const monthly = active
    .filter((s) => (s.type ?? 'SIP').toUpperCase() === 'SIP' && /month/i.test(s.frequency ?? 'monthly'))
    .reduce((t, s) => t + (s.amount ?? 0), 0);

  return (
    <Card padding={4} onPress={onOpen}>
      {monthly > 0 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space[2] }}>
          <Text variant="caption" tone="muted">
            Monthly SIP total
          </Text>
          <Text variant="smallMedium">{inr(monthly)}</Text>
        </View>
      ) : null}
      {active.length === 0 ? (
        <Text variant="small" tone="muted">
          No running SIPs. Start one from your mutual fund account.
        </Text>
      ) : (
        active.slice(0, 5).map((s, i, arr) => {
          const next = nextInstalment(s);
          return (
            <View
              key={s.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                paddingVertical: space[3],
                borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                borderBottomColor: p.border.subtle,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="smallMedium" numberOfLines={1}>
                  {s.schemeName ?? s.schemeCode}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
                  {(s.type ?? 'SIP').toUpperCase()} · {s.frequency ?? 'Monthly'}
                  {next ? ` · next ${next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
                </Text>
              </View>
              <Text variant="smallMedium">{s.amount != null ? inr(s.amount) : '—'}</Text>
            </View>
          );
        })
      )}
      {active.length > 5 ? (
        <Text variant="caption" tone="accent" style={{ marginTop: space[2] }}>
          +{active.length - 5} more
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * The one door into every import route. Full-size until something has been
 * imported — a client who holds funds or shares elsewhere is looking at a
 * partial portfolio and cannot know it — and a single quiet row afterwards.
 */
export function ImportHubBanner({ onOpen, compact }: { onOpen: () => void; compact?: boolean }) {
  const p = usePalette();
  return (
    <Card weight={compact ? 'surface' : 'elevated'} padding={4} onPress={onOpen}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View
          style={{
            width: compact ? 32 : 40,
            height: compact ? 32 : 40,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${p.accent.DEFAULT}24`,
          }}
        >
          <PackagePlus size={compact ? 16 : 19} color={p.accent.DEFAULT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="smallMedium">{compact ? 'Import more of your portfolio' : 'Import my portfolio'}</Text>
          {compact ? null : (
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              Mutual funds, shares, bonds and demat held elsewhere — see everything you own in one place.
            </Text>
          )}
        </View>
        <ChevronRight size={16} color={p.text.faint} />
      </View>
    </Card>
  );
}
