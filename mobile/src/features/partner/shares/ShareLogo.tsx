/**
 * A company's logo, or its initials when there is none (or it fails to load).
 * The admin uploads logos to a public bucket; a missing one is normal, not an
 * error, so the fallback is a quiet monogram rather than a broken-image box.
 */
import { useState } from 'react';
import { Image, View } from 'react-native';
import { font, radius } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ShareLogo({
  name,
  url,
  size = 40,
}: {
  name: string;
  url: string | null | undefined;
  size?: number;
}) {
  const p = usePalette();
  const [failed, setFailed] = useState(false);
  const showImage = !!url && !failed;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm + 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: showImage ? '#FFFFFF' : p.accent.tint(0.12),
      }}
    >
      {showImage ? (
        <Image
          source={{ uri: url as string }}
          style={{ width: size - 6, height: size - 6 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          style={{
            fontFamily: font.displayBold,
            fontSize: Math.round(size * 0.36),
            color: p.accent.DEFAULT,
          }}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
