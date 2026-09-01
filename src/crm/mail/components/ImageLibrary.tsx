// Upload and reuse campaign images.
//
// The bucket is public because a mail client fetches images anonymously, often
// months after delivery — a signed URL would render every past campaign broken
// the moment it expired. Objects are therefore named with a timestamp and a
// random suffix rather than by filename: two campaigns uploading "banner.png"
// must not overwrite each other when the first one is already in inboxes
// pointing at that URL.

import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Modal, PrimaryButton } from '../../ui/kit';
import { useAssets, useUploadAsset } from '../mailClient';

const MAX_BYTES = 2 * 1024 * 1024;

export default function ImageLibrary({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const { data: assets = [], isLoading } = useAssets();
  const upload = useUploadAsset();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    // Held down deliberately: images are embedded by URL and every recipient's
    // client downloads the full file, so a 10 MB hero costs 10 MB × the list.
    if (file.size > MAX_BYTES) {
      setError('That image is larger than 2 MB. Every recipient downloads it, so please compress it first.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('That is not an image file.');
      return;
    }
    try {
      const asset = await upload.mutateAsync(file);
      onPick(asset.public_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The upload failed.');
    }
  };

  return (
    <Modal open onClose={onClose} title="Campaign images" width="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <PrimaryButton type="button" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {upload.isPending ? 'Uploading…' : 'Upload an image'}
          </PrimaryButton>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>PNG or JPG, up to 2 MB</span>
        </div>

        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif" hidden
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />

        {error && (
          <div className="rounded-xl px-3 py-2 text-sm flex items-start gap-2"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}>
            <X size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : assets.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
            No images yet. Anything you upload here can be reused in later campaigns.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-80 overflow-y-auto">
            {assets.map((a) => (
              <button key={a.id} type="button" onClick={() => onPick(a.public_url)}
                className="rounded-xl overflow-hidden text-left transition hover:opacity-80"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <img src={a.public_url} alt={a.file_name} className="w-full h-24 object-cover" />
                <div className="px-2 py-1.5 text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {a.file_name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
