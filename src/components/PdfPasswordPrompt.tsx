import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lock } from 'lucide-react';
import { unlockPdfForUpload, type AskPassword, type UnlockOutcome } from '../lib/pdfUnlock';
import { passwordCandidates, type PasswordHints } from '../lib/pdfPasswordCandidates';

/**
 * Password prompt for a locked PDF, mounted on demand at <body>.
 *
 * Self-mounting on purpose: upload code runs in many screens, several of which
 * swap to a "saving…" view mid-upload, so a prompt placed inside the screen
 * could be unmounted exactly when it is needed. This needs no wiring at all.
 *
 * Shown only when none of the automatic guesses opened the file. "Skip" keeps
 * the old behaviour (the locked file is uploaded as it is).
 */
function PasswordDialog({ fileName, wrong, done }: { fileName: string; wrong: boolean; done: (pw: string | null) => void }) {
  const [value, setValue] = useState('');
  // Inline styles only: this mounts outside any screen, so it must not depend
  // on which stylesheet the current page happens to have loaded.
  const font = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';
  const btn = { flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: font } as const;
  return (
    <div role="dialog" aria-modal="true" aria-label="PDF password"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', fontFamily: font }}>
      <form
        style={{ width: '100%', maxWidth: 384, borderRadius: 24, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bg-elevated, #0f1b2d)', border: '1px solid rgba(var(--accent-rgb, 201,162,77),0.25)', boxSizing: 'border-box' }}
        onSubmit={(e) => { e.preventDefault(); if (value) done(value); }}
      >
        <div style={{ width: 40, height: 40, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--accent-rgb, 201,162,77),0.12)' }}>
          <Lock size={20} color="var(--accent, #c9a24d)" />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-bright, #fff)' }}>This PDF is password-protected</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, wordBreak: 'break-all', color: 'var(--text-secondary, #cbd5e1)' }}>{fileName}</p>
          <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted, #94a3b8)' }}>
            Enter its password once. We save an unlocked copy so nobody needs the password again — the password itself is not stored.
          </p>
        </div>
        <input
          autoFocus
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="PDF password"
          aria-label="PDF password"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 12, fontSize: 14, outline: 'none', fontFamily: font, background: 'var(--bg-raised, #16243a)', border: `1px solid ${wrong ? '#DC2626' : 'var(--border, #334155)'}`, color: 'var(--text-bright, #fff)' }}
        />
        {wrong && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger-soft, #dc2626)' }}>That password didn't open the file. Try again.</p>}
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" onClick={() => done(null)}
            style={{ ...btn, background: 'var(--bg-raised, #16243a)', color: 'var(--text-secondary, #cbd5e1)', border: '1px solid var(--border, #334155)' }}>
            Skip (upload locked)
          </button>
          <button type="submit" disabled={!value}
            style={{ ...btn, fontWeight: 700, color: 'var(--text-on-accent, #081b33)', border: 'none', background: 'var(--accent, #c9a24d)', opacity: value ? 1 : 0.5 }}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}

export const askPdfPassword: AskPassword = (fileName, wrong) =>
  new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (pw: string | null) => {
      root.unmount();
      host.remove();
      resolve(pw);
    };
    root.render(<PasswordDialog fileName={fileName} wrong={wrong} done={done} />);
  });

/** Full outcome — for screens that want to say "password removed". */
export function unlockForUpload(file: File, hints: PasswordHints): Promise<UnlockOutcome> {
  return unlockPdfForUpload(file, passwordCandidates(hints), askPdfPassword);
}

/** The file to upload: an unlocked copy if it was a locked PDF, else unchanged. */
export async function prepareUploadFile(file: File, hints: PasswordHints): Promise<File> {
  return (await unlockForUpload(file, hints)).file;
}
