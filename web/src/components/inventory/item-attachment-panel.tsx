import * as React from 'react';
import { Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useAttachments,
  useInitUploadMutation,
  useConfirmUploadMutation,
  useDownloadURLMutation,
  useDeleteAttachmentMutation,
} from '@/api/attachments';
import type { Attachment } from '@/api/attachments';

interface ItemAttachmentPanelProps {
  itemId: string;
  canWrite: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentRow({
  att,
  itemId,
  canWrite,
}: {
  att: Attachment;
  itemId: string;
  canWrite: boolean;
}) {
  const downloadMutation = useDownloadURLMutation(itemId);
  const deleteMutation = useDeleteAttachmentMutation(itemId);

  async function handleDownload() {
    const { url } = await downloadMutation.mutateAsync(att.id);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{att.file_name}</div>
        <div className="text-xs text-muted-foreground">{formatBytes(att.size_bytes)}</div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={handleDownload}
        disabled={downloadMutation.isPending}
        aria-label="İndir"
      >
        {downloadMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </Button>
      {canWrite && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => deleteMutation.mutate(att.id)}
          disabled={deleteMutation.isPending}
          aria-label="Sil"
          className="text-muted-foreground hover:text-destructive"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}

export function ItemAttachmentPanel({ itemId, canWrite }: ItemAttachmentPanelProps) {
  const attachmentsQuery = useAttachments(itemId);
  const initUpload = useInitUploadMutation(itemId);
  const confirmUpload = useConfirmUploadMutation(itemId);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { attachment_id, upload_url } = await initUpload.mutateAsync({
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        is_encrypted: false,
      });

      const putResp = await fetch(upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!putResp.ok) {
        throw new Error(`MinIO yükleme hatası: ${putResp.status}`);
      }

      await confirmUpload.mutateAsync(attachment_id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Yükleme başarısız.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const attachments = attachmentsQuery.data ?? [];

  return (
    <section aria-label="Ekler">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Ekler</h3>
        <span className="text-xs text-muted-foreground">{attachments.length} ek</span>
      </div>

      {attachmentsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Yükleniyor…
        </div>
      ) : attachments.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">Ek bulunmuyor.</p>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <AttachmentRow key={att.id} att={att} itemId={itemId} canWrite={canWrite} />
          ))}
        </div>
      )}

      {uploadError && (
        <p className="mt-2 text-xs text-destructive">{uploadError}</p>
      )}

      {canWrite && (
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={handleFileChange}
            disabled={uploading}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploading ? 'Yükleniyor…' : 'Dosya Ekle'}
          </Button>
        </div>
      )}
    </section>
  );
}
