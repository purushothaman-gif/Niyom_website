/**
 * DocumentService
 * -----------------------------------------------------------------------------
 * Read-only access to a client's documents (nw_documents). Files live in the
 * `crm-documents` storage bucket and are fetched via short-lived signed URLs —
 * never public URLs — matching the CRM's handling.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { ClientDocument } from '../types/activity';

const BUCKET = 'crm-documents';

const DOC_TYPE_LABELS: Record<string, string> = {
  PAN: 'PAN Card',
  CML: 'CML',
  BANK: 'Bank Documents',
  DEAL_CONFIRMATION: 'Deal Confirmation',
  DSA_DOCUMENTS: 'DSA Documents',
  KYC: 'KYC',
  FATCA: 'FATCA',
  STATEMENT: 'Statement',
  OTHER: 'Other',
};

const label = (key: string): string =>
  DOC_TYPE_LABELS[key] ??
  key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const DocumentService = {
  async getDocuments(clientId: string): Promise<ClientDocument[]> {
    const { data, error } = await supabase
      .from('nw_documents')
      .select('id, document_type, file_name, file_path, file_size, mime_type, uploaded_at')
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message);

    return (data ?? []).map((d) => ({
      id: d.id as string,
      fileName: d.file_name as string,
      docType: (d.document_type as string) ?? 'OTHER',
      docTypeLabel: label((d.document_type as string) ?? 'OTHER'),
      filePath: d.file_path as string,
      fileSize: (d.file_size as number) ?? 0,
      mimeType: (d.mime_type as string) ?? '',
      uploadedAt: d.uploaded_at as string,
    }));
  },

  /** Mint a short-lived signed URL to view/download a document. */
  async getSignedUrl(filePath: string): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 120);
    if (error || !data) throw new Error(error?.message ?? 'Could not generate download link.');
    return data.signedUrl;
  },
};
