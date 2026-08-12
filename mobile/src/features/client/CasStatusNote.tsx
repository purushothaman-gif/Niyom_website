/**
 * Where the mutual-fund numbers came from, and whether they are current.
 *
 * This is not a status chip for its own sake. For mutual funds the portfolio
 * shows EITHER the client's imported statement or the funds Niyom recorded —
 * never both merged, because a fund bought through us appears in each and
 * summing them would double it. Which of the two is in play decides whether
 * "complete" means "everything you own" or "everything you bought through
 * Niyom", and nobody can infer that from a list of holdings.
 *
 * The wording is `CAS_FRESHNESS_COPY` from `shared/`, so the app and the
 * website say the same thing about the same state.
 */
import { View } from 'react-native';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react-native';
import { CAS_FRESHNESS_COPY, type CasFreshness } from '@shared/portal/types/cas';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';

export function CasStatusNote({
  freshness,
  hasImportedStatement,
  valuedOn,
  onImport,
}: {
  freshness: CasFreshness;
  hasImportedStatement: boolean;
  valuedOn: string | null;
  onImport: () => void;
}) {
  const p = usePalette();

  /* No statement at all — the useful thing to say is what importing one adds. */
  if (!hasImportedStatement || freshness.state === 'none') {
    return (
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: p.accent.tint(0.35),
          backgroundColor: p.accent.tint(0.08),
          padding: space[4],
          gap: space[3],
        }}
      >
        <Text variant="bodyMedium">Only what you bought through Niyom</Text>
        <Text variant="small" tone="secondary">
          Import your Consolidated Account Statement to include funds you hold elsewhere. It is
          read once and never stored.
        </Text>
        <Button label="Import my statement" icon={Upload} size="sm" onPress={onImport} />
      </View>
    );
  }

  /* A statement exists but transactions have happened since it was issued. */
  if (freshness.state === 'stale') {
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: space[3],
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: `${p.state.warningSoft}55`,
          backgroundColor: `${p.state.warningSoft}14`,
          padding: space[4],
        }}
      >
        <AlertTriangle size={17} color={p.state.warningSoft} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: space[3] }}>
          <Text variant="small" tone="secondary">
            {CAS_FRESHNESS_COPY.stale}
          </Text>
          <Button label="Import a newer statement" size="sm" variant="secondary" onPress={onImport} />
        </View>
      </View>
    );
  }

  /* Current. A quiet line, not a banner — nothing needs doing. */
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[1] }}>
      <CheckCircle2 size={14} color={p.state.successSoft} />
      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
        {CAS_FRESHNESS_COPY.current(valuedOn ?? freshness.statementTo ?? 'your latest statement')}
      </Text>
    </View>
  );
}
