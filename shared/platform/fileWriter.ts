/**
 * Handing a generated file to the user, without knowing what "the user" has.
 * -----------------------------------------------------------------------------
 * The report exporters build a spreadsheet in memory and then have to deliver
 * it, and that last step is the one thing that cannot be shared: a browser
 * downloads it to a folder, a phone has no folder and instead opens a share
 * sheet so the person picks Files, Mail or WhatsApp.
 *
 * So the exporters produce BYTES and call `saveFile`; each platform registers
 * what to do with them at startup. Everything before that — the columns, the
 * rounding, the sheet layout — stays in one place.
 */

export interface SaveFileRequest {
  /** Suggested name including extension, e.g. "niyom_holdings_NW-001.xlsx". */
  fileName: string;
  /** File contents, base64-encoded. */
  base64: string;
  mimeType: string;
}

export type FileWriter = (request: SaveFileRequest) => Promise<void>;

const notRegistered: FileWriter = async () => {
  throw new Error(
    'No file writer registered. The platform entry point must call ' +
      'registerFileWriter() before a report can be exported.',
  );
};

let writer: FileWriter = notRegistered;

/** Called once at platform startup. */
export function registerFileWriter(next: FileWriter): void {
  writer = next;
}

export function saveFile(request: SaveFileRequest): Promise<void> {
  return writer(request);
}

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
