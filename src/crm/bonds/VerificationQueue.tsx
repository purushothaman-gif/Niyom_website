// Manual Verification Queue — bonds an admin should review (missing required
// fields). Opening one goes to its profile to enrich / fix.

import { ArrowLeft, ShieldAlert, ChevronRight } from 'lucide-react';
import { LogoLoader } from '../../components/LogoLoader';
import { useVerificationQueue } from './bondClient';

interface Props { onBack: () => void; onOpen: (id: string) => void; }

export default function VerificationQueue({ onBack, onOpen }: Props) {
  const { data: items = [], isLoading } = useVerificationQueue();

  return (
    <div className="space-y-5">
      <div>
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" /> Bond master
        </button>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Verification Queue</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>{items.length} bond{items.length === 1 ? '' : 's'} need manual review</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LogoLoader size={48} /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-24 rounded-2xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <ShieldAlert className="w-8 h-8 mx-auto mb-3" style={{ color: 'rgb(16,185,129)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Nothing to verify — every mastered bond has its required fields.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(it => (
            <button key={it.id} onClick={() => onOpen(it.bond_id)} className="w-full text-left rounded-2xl p-4 flex items-center justify-between gap-4 crm-row-hover"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{it.bond?.bond_name || it.bond?.isin || 'Bond'}</p>
                  <span className="text-[11px] px-2 py-0.5 rounded-lg font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: 'rgb(245,158,11)' }}>{Math.round(it.bond?.data_quality_score ?? it.confidence)}%</span>
                </div>
                <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-faint)' }}>{it.bond?.isin}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{it.reason || `Missing: ${it.missing_fields.join(', ')}`}</p>
              </div>
              <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
