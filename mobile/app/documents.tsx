/**
 * Documents — KYC papers, deal confirmations and statements.
 *
 * Files live in a private bucket, so nothing here holds a URL. Opening one
 * mints a short-lived signed URL at the moment of the tap and hands it to the
 * system browser; the link expires on its own, and a screenshot of this screen
 * carries nothing that could be replayed.
 *
 * Grouped by document type because that is how people look for them — "where's
 * my PAN copy" rather than "what did I upload on the 4th".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Download, FolderClosed } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmtDate } from '@shared/crm/utils';
import { DocumentService } from '@shared/portal/services/DocumentService';
import type { ClientDocument } from '@shared/portal/types/activity';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { EmptyState, ErrorState, ListRow, SkeletonScreen } from '@/ui/kit';

export default function Documents() {
  const clientId = useClientId();
  const p = usePalette();

  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await DocumentService.getDocuments(clientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your documents.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const byType = new Map<string, ClientDocument[]>();
    for (const doc of docs) {
      const key = doc.docTypeLabel ?? 'Other';
      const list = byType.get(key) ?? [];
      list.push(doc);
      byType.set(key, list);
    }
    return [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [docs]);

  const open = async (doc: ClientDocument) => {
    setOpening(doc.id);
    try {
      const url = await DocumentService.getSignedUrl(doc.filePath);
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert(
        'Could not open this document',
        'Please try again, or ask your relationship manager to resend it.',
      );
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen onRefresh={load} refreshing={loading && docs.length > 0}>
      <ScreenHeader
        title="Documents"
        subtitle="Your KYC papers, deal confirmations and statements in one place."
        showBack
      />

      {loading && docs.length === 0 ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FolderClosed}
          title="Nothing here yet"
          message="Documents you or your relationship manager upload will appear here."
        />
      ) : (
        <View style={{ gap: space[5] }}>
          {groups.map(([type, list], gi) => (
            <Animated.View key={type} entering={FadeInDown.duration(360).delay(gi * 60)}>
              <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
                {type}
              </Text>
              <Card padding={4}>
                {list.map((doc, i) => (
                  <ListRow
                    key={doc.id}
                    icon={opening === doc.id ? Download : FolderClosed}
                    iconColor={p.accent.DEFAULT}
                    title={doc.fileName}
                    subtitle={[
                      doc.uploadedAt ? fmtDate(doc.uploadedAt) : null,
                      formatSize(doc.fileSize),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    showChevron
                    onPress={() => void open(doc)}
                    last={i === list.length - 1}
                  />
                ))}
              </Card>
            </Animated.View>
          ))}

          <Text variant="caption" tone="faint" center>
            Links open in your browser and expire shortly after — nothing is stored on this phone.
          </Text>
        </View>
      )}
    </Screen>
  );
}

/** Bytes → "1.4 MB". Null size is common for older rows; show nothing then. */
function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
