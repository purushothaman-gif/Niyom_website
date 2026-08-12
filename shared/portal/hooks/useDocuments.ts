/**
 * useDocuments
 * -----------------------------------------------------------------------------
 * Loads the client's documents from nw_documents (metadata only; files stay in
 * storage and are fetched on demand via a signed URL).
 */
import { useEffect, useState } from 'react';
import { DocumentService } from '../services/DocumentService';
import type { ClientDocument } from '../types/activity';

export function useDocuments(clientId: string) {
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    DocumentService.getDocuments(clientId)
      .then((docs) => {
        if (alive) {
          setDocuments(docs);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Failed to load documents.');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  return { documents, loading, error };
}
