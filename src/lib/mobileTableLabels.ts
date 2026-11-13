/**
 * Phone card labels for tables whose columns are built at runtime.
 *
 * The .m-table kit (index.css) turns a table into stacked cards on a phone,
 * reading each cell's label from `data-label`. Writing those by hand is right
 * for a fixed table, but not for ones whose columns depend on role, settings or
 * data (HR registers, MIS, shared table wrappers). Mark such a table with
 * `data-auto-label` and this fills the labels from its own header row:
 *
 *   <table data-auto-label className="m-table …">           labels only
 *   <div data-m-wrap><table data-auto-label …>               also opts the table
 *                                                           (and wrapper) into
 *                                                           cards, unless it has
 *                                                           more than MAX_COLS
 *
 * Optional `data-primary-col="2"` picks the card-title column; otherwise the
 * first column with a real header (not blank, not "#") is used. Cells that
 * already carry data-label / data-primary are left alone, and full-width rows
 * (loading, empty) are skipped.
 */

/** Wider than this, a card would be a long list — keep the sideways scroll. */
const MAX_COLS = 12;

function headerLabels(table: HTMLTableElement): string[] {
  const rows = table.tHead?.rows;
  if (!rows || rows.length === 0) return [];
  const row = rows[rows.length - 1];
  const out: string[] = [];
  for (const cell of Array.from(row.cells)) {
    const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < Math.max(1, cell.colSpan); i++) out.push(text);
  }
  return out;
}

function labelTable(table: HTMLTableElement) {
  const labels = headerLabels(table);
  if (labels.length === 0) return;

  const parent = table.parentElement;
  if (parent?.hasAttribute('data-m-wrap')) {
    const stack = labels.length <= MAX_COLS;
    table.classList.toggle('m-table', stack);
    parent.classList.toggle('m-table-wrap', stack);
    if (!stack) return;
  }

  const set = table.dataset.primaryCol;
  const primary =
    set !== undefined ? Number(set) : Math.max(0, labels.findIndex((l) => l !== '' && l !== '#'));

  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      const cells = Array.from(row.cells);
      if (cells.length === 1 && cells[0].colSpan > 1) continue;
      let col = 0;
      for (const cell of cells) {
        if (!cell.hasAttribute('data-label') && !cell.hasAttribute('data-primary')) {
          if (col === primary) cell.setAttribute('data-primary', '');
          else if (labels[col]) cell.setAttribute('data-label', labels[col]);
        }
        col += Math.max(1, cell.colSpan);
      }
    }
  }
}

let scheduled = false;
function run() {
  scheduled = false;
  document.querySelectorAll<HTMLTableElement>('table[data-auto-label]').forEach(labelTable);
}

export function installMobileTableLabels() {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  };
  // childList only: rows and tables appearing. Our own attribute writes don't
  // retrigger it, so there is no feedback loop.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
}
