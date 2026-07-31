/**
 * Settings — the console's connection to BSE, stated plainly.
 *
 * Read-only on purpose: the credentials, environment and whitelisted IP live in
 * the proxy's .env on the droplet, and a screen that could change them from a
 * browser would be a liability. This shows what is configured (never the
 * password) and whether it currently works, so "is BSE up?" and "which IP does
 * BSE see?" are answerable without SSH.
 */
import { Activity, Globe, KeyRound, Server, Settings as SettingsIcon, Webhook } from 'lucide-react';
import { StatusPill } from '../../../portal/components/StatusPill';
import { LogoLoader } from '../../../components/LogoLoader';
import { BseOpsExtra, isBseConfigured, type BseDiagnostics } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { ErrorNote, NotConfigured } from './formBits';
import { PageHead, Panel, PanelHead } from '../../ui/Surface';

function Line({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span
        className={`min-w-0 break-all text-right text-xs font-medium ${mono ? 'font-mono' : ''} ${
          tone === 'success'
            ? 'text-success'
            : tone === 'warning'
              ? 'text-warning'
              : tone === 'danger'
                ? 'text-danger'
                : 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function SettingsPage() {
  const { data, loading, error, refresh } = useBseData<BseDiagnostics>(() =>
    BseOpsExtra.diagnostics(),
  );

  if (!isBseConfigured()) return <NotConfigured title="Settings" />;
  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }
  if (error) return <ErrorNote title="Couldn’t reach the BSE proxy." message={error} />;
  if (!data) return null;

  const isProd = data.environment === 'prod';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Settings" subtitle="Read-only diagnostics for the console’s connection to BSE. Credentials live in the proxy’s .env on the droplet." />
      <div className="space-y-5">
      <Panel>
        <div className="flex items-start justify-between gap-3">
          <PanelHead title="BSE connection" icon={Server} />
          <div className="flex items-center gap-2">
            <StatusPill tone={data.bseReachable ? 'success' : 'danger'}>
              {data.bseReachable ? 'Connected' : 'Unreachable'}
            </StatusPill>
            <button
              type="button"
              onClick={refresh}
              className="rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:text-accent"
            >
              Re-test
            </button>
          </div>
        </div>

        <Line
          label="Environment"
          value={isProd ? 'Production — real money' : 'Demo / UAT — no real money'}
          tone={isProd ? 'success' : 'warning'}
        />
        <Line label="BSE endpoint" value={data.bseBaseUrl} mono />
        <Line label="Member code" value={data.memberCode} mono />
        <Line
          label="Credentials"
          value={data.credentialsConfigured ? 'Configured' : 'Missing'}
          tone={data.credentialsConfigured ? 'success' : 'danger'}
        />
        {!data.bseReachable && data.bseError && (
          <Line label="Last error" value={data.bseError} tone="danger" />
        )}
      </Panel>

      <Panel>
        <PanelHead title="Network" icon={Globe} />
        <Line
          label="Outbound IP (whitelisted by BSE)"
          value={data.egressIp || 'could not determine'}
          mono
          tone={data.egressIp ? undefined : 'warning'}
        />
        <Line label="Allowed browser origins" value={data.allowedOrigins.join(', ') || 'none'} mono />
        <p className="pt-3 text-[11px] text-text-faint">
          BSE only accepts API calls from explicitly whitelisted IPs. If the outbound IP above ever
          changes, BSE must be told or every call will fail.
        </p>
      </Panel>

      <Panel>
        <PanelHead title="Webhooks" icon={Webhook} />
        <Line label="Callback URL registered with BSE" value={data.webhookUrl} mono />
        <Line
          label="Event persistence"
          value={data.webhookPersistence ? 'Enabled' : 'Disabled — events are logged only'}
          tone={data.webhookPersistence ? 'success' : 'warning'}
        />
      </Panel>

      <Panel>
        <PanelHead title="Security" icon={KeyRound} />
        <Line
          label="Caller authentication"
          value={data.requireAuth ? 'Required (employee session)' : 'DISABLED'}
          tone={data.requireAuth ? 'success' : 'danger'}
        />
        <p className="pt-3 text-[11px] text-text-faint">
          <Activity className="mr-1 inline h-3 w-3 align-[-2px]" />
          Proxy time {new Date(data.serverTime).toLocaleString('en-IN')}. Credentials and keys live
          in the proxy’s environment on the droplet and are never exposed here or to the browser.
        </p>
      </Panel>

      <p className="text-center text-[11px] text-text-faint">
        <SettingsIcon className="mr-1 inline h-3 w-3 align-[-2px]" />
        Read-only. Change these on the droplet, then re-test above.
      </p>
      </div>
    </div>
  );
}
