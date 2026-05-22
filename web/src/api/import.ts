/**
 * Import API hooks — CSV preview + batch import (PR-IMPORT).
 */

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { BatchImportRequest, BatchImportResponse, CSVPreviewResponse } from './types';

/** Upload a CSV file for preview (no DB writes). Returns headers + up to 500 rows. */
export function useCSVPreviewMutation() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<CSVPreviewResponse>('/api/v1/import/csv/preview', {
        method: 'POST',
        rawBody: form,
      });
    },
  });
}

/** Batch create pre-encrypted items (CSV or KeePass origin). */
export function useBatchImportMutation() {
  return useMutation({
    mutationFn: (req: BatchImportRequest) =>
      apiFetch<BatchImportResponse>('/api/v1/import/batch', { method: 'POST', body: req }),
  });
}
