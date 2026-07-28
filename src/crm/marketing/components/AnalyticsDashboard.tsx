// Admin analytics for the Content Creation module.
//
// Figures span live content AND the history of deleted/expired items, so the
// 48-hour purge never makes past work disappear from the numbers.

import { ArrowLeft, TrendingUp, Users, MousePointerClick, UserPlus } from 'lucide-react';
import {
  useContentPerformance, useDashboardTotals, useLeaderboard, usePlatformUsage,
} from '../marketingClient';
import { EmployeeAvatar } from '../../EmployeeAvatar';
import { PLATFORMS } from '../marketingConstants';

export default function AnalyticsDashboard({ onBack }: { onBack: () => void }) {
  const { data: totals, isLoading, error } = useDashboardTotals();
  const { data: leaderboard = [] } = useLeaderboard();
  const { data: performance = [] } = useContentPerformance(15);
  const { data: platforms = [] } = usePlatformUsage();

  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-sm mb-4 transition-colors hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Back to library
      </button>

      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
          Marketing Tool
        </p>
        <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>Content Analytics</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Lifetime figures — expired and deleted content still counts here.
        </p>
      </div>

      {error && (
        <div className="rounded-xl p-3 mb-4 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          {error instanceof Error ? error.message : 'Could not load analytics'}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : (
        <>
          {/* funnel */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat icon={MousePointerClick} label="Referral clicks" value={totals?.referral_clicks ?? 0}
              hint="Link opens from captions" />
            <Stat icon={UserPlus} label="Leads generated" value={totals?.leads_generated ?? 0}
              hint="Signups attributed to content" />
            <Stat icon={Users} label="Clients onboarded" value={totals?.clients_onboarded ?? 0}
              hint="Completed onboarding" accent />
            <Stat icon={TrendingUp} label="Live right now" value={totals?.live_now ?? 0}
              hint="Visible to employees" />
          </div>

          {/* content counts */}
          <div className="rounded-2xl p-5 mb-5"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <p className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Content</p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <Mini label="Generated" value={totals?.generated_total ?? 0} />
              <Mini label="Approved" value={totals?.approved_total ?? 0} />
              <Mini label="Rejected" value={totals?.rejected_total ?? 0} />
              <Mini label="Expired" value={totals?.expired_total ?? 0} />
              <Mini label="Deleted" value={totals?.admin_deleted_total ?? 0} />
              <Mini label="Downloads" value={totals?.downloads_total ?? 0} />
              <Mini label="Caption copies" value={totals?.caption_copies ?? 0} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* leaderboard */}
            <Panel title="Employee leaderboard" subtitle="Ranked by clients onboarded">
              {leaderboard.length === 0 ? (
                <Empty>No employee activity yet.</Empty>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {['Employee', 'Downloads', 'Copies', 'Clicks', 'Leads', 'Clients'].map((h, i) => (
                        <th key={h} className={`pb-2 text-xs font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}
                          style={{ color: 'var(--text-faint)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map(r => (
                      <tr key={r.employee_id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <EmployeeAvatar name={r.full_name} url={r.avatar_url} size={24} rounded="lg"
                              badgeStyle={{ background: 'rgba(var(--accent-soft-rgb),0.15)', color: 'var(--accent-soft)' }} />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                {r.full_name}
                              </p>
                              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.employee_code}</p>
                            </div>
                          </div>
                        </td>
                        <Num v={r.downloads} />
                        <Num v={r.copies} />
                        <Num v={r.clicks} />
                        <Num v={r.leads} />
                        <Num v={r.clients} accent />
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            {/* platform usage */}
            <Panel title="Platform usage" subtitle="Content produced per platform">
              {platforms.length === 0 ? (
                <Empty>No content published yet.</Empty>
              ) : (
                <div className="space-y-3">
                  {platforms.map(p => {
                    const max = Math.max(...platforms.map(x => Number(x.content_count)), 1);
                    const pct = (Number(p.content_count) / max) * 100;
                    return (
                      <div key={p.platform}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span style={{ color: 'var(--text-primary)' }}>
                            {PLATFORMS.find(x => x.id === p.platform)?.label ?? p.platform}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {p.content_count} items · {p.downloads} downloads
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-base)' }}>
                          <div className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: 'var(--accent-soft)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>

          {/* top content */}
          <div className="mt-5">
            <Panel title="Top performing content" subtitle="Most downloaded first — includes expired items">
              {performance.length === 0 ? (
                <Empty>No content activity yet.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr>
                        {['Reference', 'Title', 'Status', 'Downloads', 'Copies', 'Clicks', 'Leads', 'Clients'].map((h, i) => (
                          <th key={h} className={`pb-2 text-xs font-semibold ${i < 3 ? 'text-left' : 'text-right'}`}
                            style={{ color: 'var(--text-faint)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {performance.map(r => (
                        <tr key={r.content_no} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td className="py-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{r.content_no}</td>
                          <td className="py-2 text-xs max-w-xs truncate" style={{ color: 'var(--text-primary)' }}>{r.title}</td>
                          <td className="py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{r.status}</td>
                          <Num v={r.downloads} />
                          <Num v={r.copies} />
                          <Num v={r.clicks} />
                          <Num v={r.leads} />
                          <Num v={r.clients} accent />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, accent }: {
  icon: React.ElementType; label: string; value: number; hint: string; accent?: boolean;
}) {
  return (
    <div className="rounded-2xl p-4"
      style={{
        background: accent ? 'rgba(var(--accent-soft-rgb),0.08)' : 'var(--bg-surface)',
        border: `1px solid ${accent ? 'rgba(var(--accent-soft-rgb),0.25)' : 'var(--border)'}`,
      }}>
      <Icon className="w-4 h-4 mb-2" style={{ color: 'var(--accent-soft)' }} />
      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-xs font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{hint}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</p>
    </div>
  );
}

function Num({ v, accent }: { v: number; accent?: boolean }) {
  return (
    <td className="py-2 text-xs text-right font-semibold"
      style={{ color: accent && v > 0 ? 'var(--accent-soft)' : 'var(--text-muted)' }}>{v}</td>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>{subtitle}</p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs py-4" style={{ color: 'var(--text-faint)' }}>{children}</p>;
}
