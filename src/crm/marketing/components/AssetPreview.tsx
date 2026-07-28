// Renders a stored asset from the private bucket via a short-lived signed URL,
// and handles downloading it under a friendly filename.

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { MktAsset } from '../marketingTypes';
import { signedUrlFor } from '../marketingClient';

/** Signed URLs are short-lived by design; refresh well before they lapse. */
const SIGNED_URL_TTL_SECONDS = 300;
const REFRESH_MS = (SIGNED_URL_TTL_SECONDS - 60) * 1000;

export function useSignedAssetUrl(storagePath: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storagePath) { setUrl(null); return; }

    let cancelled = false;
    const load = async () => {
      try {
        const signed = await signedUrlFor(storagePath, SIGNED_URL_TTL_SECONDS);
        if (!cancelled) { setUrl(signed); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load asset');
      }
    };

    load();
    // Keep a long-lived preview working without the image silently 403-ing.
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [storagePath]);

  return { url, error };
}

export function AssetThumb({ asset, className }: { asset: MktAsset; className?: string }) {
  const { url, error } = useSignedAssetUrl(asset.storage_path);

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className ?? ''}`}
        style={{ background: 'var(--bg-base)', minHeight: 120 }}>
        <ImageOff className="w-5 h-5" style={{ color: 'var(--text-faint)' }} />
      </div>
    );
  }

  if (!url) {
    return <div className={className} style={{ background: 'var(--bg-base)', minHeight: 120 }} />;
  }

  if (asset.kind === 'video') {
    return <video src={url} controls className={className} style={{ width: '100%', display: 'block' }} />;
  }

  return <img src={url} alt={asset.variant} className={className} style={{ width: '100%', display: 'block' }} />;
}

/** Fetch the asset and save it locally. */
export async function downloadAsset(asset: MktAsset, contentNo: string): Promise<void> {
  const url = await signedUrlFor(asset.storage_path, 120);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();

  const ext = asset.storage_path.split('.').pop() || 'png';
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `NIYOM-${contentNo}-${asset.variant}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has definitely been handled.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
