// Admin panel on CRM → Mobile App: who gets phone notifications, and a form
// to send one (it also lands in everyone's bell).

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, Send } from 'lucide-react';
import { listPushDevices, sendStaffNotification, type PushDevice } from './pushRegistration';

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border)' } as const;
const input = { background: 'var(--bg-input, var(--bg-base))', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

function ago(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export default function PushPanel() {
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [onlyApp, setOnlyApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setDevices(await listPushDevices()); } catch { setDevices([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const people = [...new Map(devices.map((d) => [d.employee_id, d])).values()];

  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const n = await sendStaffNotification(title, message, onlyApp ? people.map((p) => p.employee_id) : null);
      setMsg({ ok: true, text: `Sent to ${n} employee${n === 1 ? '' : 's'}.` });
      setTitle(''); setMessage('');
    } catch (e) {
      setMsg({ ok: false, text: (e as Error)?.message || 'Could not send' });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl p-5 space-y-4" style={card}>
      <div className="flex items-center gap-2">
        <BellRing className="h-5 w-5 text-accent-soft" />
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Phone notifications <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>· admin</span></h2>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Every CRM bell alert (leads, HR, orders, tickets, app updates) also goes to the phone of each employee below. Needs app 1.3.0 or later with notifications allowed.
      </p>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {loading ? (
          <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        ) : people.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>No phones yet. Employees appear here once they open the CRM in app 1.3.0 and allow notifications.</p>
        ) : (
          <table className="w-full text-sm m-table" data-auto-label>
            <thead><tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left px-3 py-2 font-medium">Employee</th>
              <th className="text-left px-3 py-2 font-medium">Phone</th>
              <th className="text-left px-3 py-2 font-medium">App</th>
              <th className="text-left px-3 py-2 font-medium">Last opened</th>
            </tr></thead>
            <tbody>
              {devices.map((d, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{d.full_name}</td>
                  <td className="px-3 py-2">{d.device_name || '—'}</td>
                  <td className="px-3 py-2">{d.app_version || '—'}</td>
                  <td className="px-3 py-2">{ago(d.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Send a notification</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title"
          className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={3} placeholder="Message"
          className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
        <div className="flex flex-col gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <label className="flex items-center gap-2">
            <input type="radio" checked={onlyApp} onChange={() => setOnlyApp(true)} />
            Employees with the app ({people.length}) — phone + bell
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={!onlyApp} onChange={() => setOnlyApp(false)} />
            All active employees — bell for everyone, phone for those with the app
          </label>
        </div>
        {msg && <p className="text-sm" style={{ color: msg.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>{msg.text}</p>}
        <button type="button" onClick={send} disabled={busy || !title.trim() || (onlyApp && people.length === 0)}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
        </button>
      </div>
    </div>
  );
}
