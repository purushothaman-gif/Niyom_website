/**
 * Toast state for the HR screens.
 *
 * Split out of hrUi so that file exports components only -- a module that mixes
 * components and hooks breaks React Fast Refresh, which matters on screens this
 * large.
 */

import React from 'react';
import { Toast } from './hrUi';

export function useToast() {
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null);
  const show = React.useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 4000);
  }, []);
  const node = toast ? <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} /> : null;
  return { show, node };
}
