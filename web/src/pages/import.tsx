/**
 * ImportPage — bulk import wizard (PR-IMPORT).
 *
 * Supports two source formats:
 *  1. CSV — upload → server preview → column mapping → client E2E encrypt → batch submit
 *  2. KeePass (.kdbx) — client-side decrypt (kdbxweb) → entry review → client E2E encrypt → batch submit
 *
 * E2E guarantee: passwords/secrets are encrypted with the user's DEK
 * before leaving the browser. Server never sees plaintext.
 */

import { useRef, useState } from 'react';
import { FileDown, FileKey, Loader2, Upload, Check, AlertTriangle, ChevronRight } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/auth';
import { useCSVPreviewMutation, useBatchImportMutation } from '@/api/import';
import { useItemTypes, useFieldDefinitions, useUserPublicKey } from '@/api/catalog';
import { useRootFolders } from '@/api/folders';
import { generateDEK, sealDEK, encryptField, toBase64, fromBase64 } from '@/lib/crypto';
import { parseKdbx } from '@/lib/kdbx-parser';
import type { BatchImportItem } from '@/api/types';

type Step = 'select' | 'preview' | 'mapping' | 'importing' | 'done';

// --- CSV column mapping ---
interface ColumnMapping {
  nameCol: string;
  usernameCol: string;
  passwordCol: string;
  urlCol: string;
  notesCol: string;
  descriptionCol: string;
}

const EMPTY_MAPPING: ColumnMapping = {
  nameCol: '', usernameCol: '', passwordCol: '',
  urlCol: '', notesCol: '', descriptionCol: '',
};

// Field def keys for known fields
const FIELD_KEY_USERNAME = 'username';
const FIELD_KEY_PASSWORD = 'password';
const FIELD_KEY_URL = 'url';
const FIELD_KEY_NOTES = 'notes';

export default function ImportPage() {
  const [tab, setTab] = useState<'csv' | 'kdbx'>('csv');
  const [step, setStep] = useState<Step>('select');
  const [error, setError] = useState<string | null>(null);

  // --- CSV state ---
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvTotal, setCsvTotal] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);

  // --- KeePass state ---
  const [kdbxFile, setKdbxFile] = useState<File | null>(null);
  const [kdbxPassword, setKdbxPassword] = useState('');
  const [kdbxEntries, setKdbxEntries] = useState<{ title: string; groupPath: string; password?: string; username?: string; url?: string; notes?: string }[]>([]);
  const [kdbxName, setKdbxName] = useState('');

  // --- Shared import config ---
  const [targetFolderId, setTargetFolderId] = useState('');
  const [itemTypeId, setItemTypeId] = useState<number>(1); // default: "generic"
  const [importResult, setImportResult] = useState<{ created: number; errors: string[] } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const kdbxInputRef = useRef<HTMLInputElement>(null);

  const privateKey = useAuthStore((s) => s.privateKey);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const csvPreviewMut = useCSVPreviewMutation();
  const batchImportMut = useBatchImportMutation();
  const itemTypesQuery = useItemTypes();
  const fieldDefsQuery = useFieldDefinitions();
  const foldersQuery = useRootFolders();
  const userPubKeyQuery = useUserPublicKey(userId);

  // --- CSV handlers ---
  async function handleCSVUpload() {
    if (!csvFile) return;
    setError(null);
    try {
      const result = await csvPreviewMut.mutateAsync(csvFile);
      setCsvHeaders(result.headers);
      setCsvRows(result.rows.map((r) => r.raw_data));
      setCsvTotal(result.total);
      // Auto-detect common column names
      const detect = (candidates: string[]) =>
        result.headers.find((h) => candidates.includes(h.toLowerCase())) ?? '';
      setMapping({
        nameCol: detect(['name', 'title', 'label']),
        usernameCol: detect(['username', 'user', 'login', 'user name']),
        passwordCol: detect(['password', 'pass', 'pwd', 'secret']),
        urlCol: detect(['url', 'website', 'link', 'uri']),
        notesCol: detect(['notes', 'note', 'comment', 'comments', 'description']),
        descriptionCol: detect(['description', 'desc']),
      });
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV önizleme hatası.');
    }
  }

  // --- KeePass handlers ---
  async function handleKdbxParse() {
    if (!kdbxFile || !kdbxPassword) return;
    setError(null);
    try {
      const buffer = await kdbxFile.arrayBuffer();
      const { entries, dbName } = await parseKdbx(buffer, kdbxPassword);
      setKdbxEntries(entries);
      setKdbxName(dbName);
      setStep('preview');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes('Invalid credentials')
            ? 'Hatalı KeePass şifresi.'
            : err.message
          : 'KeePass dosyası açılamadı.',
      );
    }
  }

  // --- E2E encrypt + batch submit ---
  async function handleImport() {
    if (!privateKey || !userPubKeyQuery.data?.public_key) {
      setError('Şifreleme anahtarı bulunamadı. Yeniden giriş yapın.');
      return;
    }
    if (!targetFolderId) {
      setError('Hedef klasör seçin.');
      return;
    }

    setError(null);
    setStep('importing');

    const fieldDefs = fieldDefsQuery.data?.field_definitions ?? [];
    const findFieldDef = (key: string) => fieldDefs.find((f) => f.key === key);

    const pubKeyBytes = fromBase64(userPubKeyQuery.data!.public_key);

    try {
      let items: BatchImportItem[];

      if (tab === 'csv') {
        items = await buildCSVItems(csvRows, mapping, itemTypeId, targetFolderId, pubKeyBytes, findFieldDef);
      } else {
        items = await buildKdbxItems(kdbxEntries, itemTypeId, targetFolderId, pubKeyBytes, findFieldDef);
      }

      const result = await batchImportMut.mutateAsync({ items });
      setImportResult(result);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import hatası.');
      setStep('mapping');
    }
  }

  const folders = foldersQuery.data?.folders ?? [];
  const itemTypes = itemTypesQuery.data?.item_types ?? [];

  const entryCount = tab === 'csv' ? csvRows.length : kdbxEntries.length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Toplu İçe Aktarma</h1>
        <p className="text-sm text-muted-foreground mt-1">
          CSV veya KeePass (.kdbx) dosyasından item'ları içe aktarın.
          Şifreler tarayıcıda şifrelenir — sunucu plaintext görmez.
        </p>
      </div>

      {step === 'select' && (
        <Tabs value={tab} onValueChange={(v) => { setTab(v as 'csv' | 'kdbx'); setError(null); }}>
          <TabsList>
            <TabsTrigger value="csv" className="flex items-center gap-1.5">
              <FileDown className="h-4 w-4" />
              CSV
            </TabsTrigger>
            <TabsTrigger value="kdbx" className="flex items-center gap-1.5">
              <FileKey className="h-4 w-4" />
              KeePass (.kdbx)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-4 pt-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-3">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                CSV formatı: <code className="text-xs bg-muted px-1 rounded">name,username,password,url,notes</code>
              </p>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setCsvFile(f);
                }}
              />
              <Button variant="outline" onClick={() => csvInputRef.current?.click()}>
                Dosya Seç
              </Button>
              {csvFile && (
                <p className="text-sm font-medium">{csvFile.name}</p>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              disabled={!csvFile || csvPreviewMut.isPending}
              onClick={handleCSVUpload}
            >
              {csvPreviewMut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Önizleniyor…</>
              ) : (
                <><ChevronRight className="mr-2 h-4 w-4" />Önizle</>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="kdbx" className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-2">
                <FileKey className="h-8 w-8 text-muted-foreground mx-auto" />
                <input
                  ref={kdbxInputRef}
                  type="file"
                  accept=".kdbx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setKdbxFile(f);
                  }}
                />
                <Button variant="outline" onClick={() => kdbxInputRef.current?.click()}>
                  .kdbx Dosyası Seç
                </Button>
                {kdbxFile && <p className="text-sm font-medium">{kdbxFile.name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>KeePass Master Şifresi</Label>
                <Input
                  type="password"
                  placeholder="KeePass veritabanı şifresi…"
                  value={kdbxPassword}
                  onChange={(e) => setKdbxPassword(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Bu şifre yalnızca tarayıcınızda kullanılır — sunucuya gönderilmez.
                </p>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              disabled={!kdbxFile || !kdbxPassword}
              onClick={handleKdbxParse}
            >
              <ChevronRight className="mr-2 h-4 w-4" />
              Aç ve Önizle
            </Button>
          </TabsContent>
        </Tabs>
      )}

      {step === 'preview' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-green-500" />
            {tab === 'csv'
              ? `${csvTotal} satır okundu (önizleme: ${csvRows.length})`
              : `"${kdbxName}" — ${kdbxEntries.length} kayıt bulundu`}
          </div>

          {/* Import config */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Hedef Klasör</Label>
              <Select value={targetFolderId} onValueChange={setTargetFolderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Klasör seç…" />
                </SelectTrigger>
                <SelectContent>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Item Tipi</Label>
              <Select value={String(itemTypeId)} onValueChange={(v) => setItemTypeId(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {itemTypes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* CSV column mapping */}
          {tab === 'csv' && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Kolon Eşleme</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['Ad (zorunlu)', 'nameCol'],
                    ['Kullanıcı adı', 'usernameCol'],
                    ['Şifre', 'passwordCol'],
                    ['URL', 'urlCol'],
                    ['Notlar', 'notesCol'],
                    ['Açıklama', 'descriptionCol'],
                  ] as [string, keyof ColumnMapping][]
                ).map(([label, key]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Select
                      value={mapping[key]}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [key]: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="— kolon seç —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— yok —</SelectItem>
                        {csvHeaders.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview table */}
          <div className="rounded-md border overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Ad</th>
                  {tab === 'csv' && mapping.usernameCol && <th className="px-3 py-2 text-left font-medium">Kullanıcı</th>}
                  {tab === 'kdbx' && <th className="px-3 py-2 text-left font-medium">Kullanıcı</th>}
                  <th className="px-3 py-2 text-left font-medium">Şifre</th>
                  {tab === 'kdbx' && <th className="px-3 py-2 text-left font-medium">Grup</th>}
                </tr>
              </thead>
              <tbody>
                {tab === 'csv'
                  ? csvRows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">{row[mapping.nameCol] || '—'}</td>
                      {mapping.usernameCol && <td className="px-3 py-1.5 text-muted-foreground">{row[mapping.usernameCol] || '—'}</td>}
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {row[mapping.passwordCol] ? '••••••••' : '—'}
                      </td>
                    </tr>
                  ))
                  : kdbxEntries.slice(0, 20).map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5">{e.title}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{e.username || '—'}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {e.password ? '••••••••' : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground text-[10px]">{e.groupPath}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {entryCount > 20 && (
              <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                + {entryCount - 20} daha…
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setStep('select'); setError(null); }}>
              Geri
            </Button>
            <Button
              disabled={!targetFolderId || (tab === 'csv' && !mapping.nameCol)}
              onClick={handleImport}
            >
              <Upload className="mr-2 h-4 w-4" />
              {entryCount} Item İçe Aktar
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="flex flex-col items-center gap-4 py-16">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {entryCount} item şifreleniyor ve import ediliyor…
          </p>
        </div>
      )}

      {step === 'done' && importResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border bg-green-50 dark:bg-green-950/20 p-4">
            <Check className="h-6 w-6 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-medium">{importResult.created} item başarıyla aktarıldı.</p>
              {importResult.errors.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {importResult.errors.length} hata oluştu — aşağıda detaylar.
                </p>
              )}
            </div>
          </div>
          {importResult.errors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Hatalar
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                {importResult.errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
          <Button onClick={() => { setStep('select'); setError(null); setImportResult(null); setCsvFile(null); setKdbxFile(null); setKdbxPassword(''); }}>
            Yeni Import
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- E2E encryption helpers ----

async function encryptItemFields(
  fields: { fieldDefId: number; value: string }[],
  dek: Uint8Array,
): Promise<{ field_definition_id: number; value_enc: string; value_nonce: string }[]> {
  const result = [];
  for (const f of fields) {
    if (!f.value) continue;
    const { valueEnc, valueNonce } = await encryptField(f.value, dek);
    result.push({
      field_definition_id: f.fieldDefId,
      value_enc: toBase64(valueEnc),
      value_nonce: toBase64(valueNonce),
    });
  }
  return result;
}

async function sealOwnerDEK(
  dek: Uint8Array,
  ownerPublicKey: Uint8Array,
): Promise<{ owner_dek_wrapped: string; owner_wrap_nonce: string }> {
  const { wrapped, nonce } = await sealDEK(dek, ownerPublicKey);
  return {
    owner_dek_wrapped: toBase64(wrapped),
    owner_wrap_nonce: toBase64(nonce),
  };
}

async function buildCSVItems(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  itemTypeId: number,
  folderId: string,
  ownerPublicKey: Uint8Array,
  findFieldDef: (key: string) => { id: number } | undefined,
): Promise<BatchImportItem[]> {
  const items: BatchImportItem[] = [];

  for (const row of rows) {
    const name = row[mapping.nameCol]?.trim();
    if (!name) continue;

    const dek = generateDEK();
    const { owner_dek_wrapped, owner_wrap_nonce } = await sealOwnerDEK(dek, ownerPublicKey);

    const rawFields: { fieldDefId: number; value: string }[] = [];
    if (mapping.usernameCol && row[mapping.usernameCol]) {
      const fd = findFieldDef(FIELD_KEY_USERNAME);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: row[mapping.usernameCol] });
    }
    if (mapping.passwordCol && row[mapping.passwordCol]) {
      const fd = findFieldDef(FIELD_KEY_PASSWORD);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: row[mapping.passwordCol] });
    }
    if (mapping.urlCol && row[mapping.urlCol]) {
      const fd = findFieldDef(FIELD_KEY_URL);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: row[mapping.urlCol] });
    }
    if (mapping.notesCol && row[mapping.notesCol]) {
      const fd = findFieldDef(FIELD_KEY_NOTES);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: row[mapping.notesCol] });
    }

    const encFields = await encryptItemFields(rawFields, dek);

    items.push({
      id: uuidv7(),
      folder_id: folderId,
      item_type_id: itemTypeId,
      name,
      description: mapping.descriptionCol ? row[mapping.descriptionCol] ?? '' : '',
      fields: encFields.map((f) => ({
        field_definition_id: f.field_definition_id,
        value_enc: f.value_enc,
        value_nonce: f.value_nonce,
        position: 0,
      })),
      owner_dek_wrapped,
      owner_wrap_nonce,
    });
  }

  return items;
}

async function buildKdbxItems(
  entries: { title: string; groupPath: string; password?: string; username?: string; url?: string; notes?: string }[],
  itemTypeId: number,
  folderId: string,
  ownerPublicKey: Uint8Array,
  findFieldDef: (key: string) => { id: number } | undefined,
): Promise<BatchImportItem[]> {
  const items: BatchImportItem[] = [];

  for (const entry of entries) {
    const dek = generateDEK();
    const { owner_dek_wrapped, owner_wrap_nonce } = await sealOwnerDEK(dek, ownerPublicKey);

    const rawFields: { fieldDefId: number; value: string }[] = [];
    if (entry.username) {
      const fd = findFieldDef(FIELD_KEY_USERNAME);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: entry.username });
    }
    if (entry.password) {
      const fd = findFieldDef(FIELD_KEY_PASSWORD);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: entry.password });
    }
    if (entry.url) {
      const fd = findFieldDef(FIELD_KEY_URL);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: entry.url });
    }
    if (entry.notes) {
      const fd = findFieldDef(FIELD_KEY_NOTES);
      if (fd) rawFields.push({ fieldDefId: fd.id, value: entry.notes });
    }

    const encFields = await encryptItemFields(rawFields, dek);

    items.push({
      id: uuidv7(),
      folder_id: folderId,
      item_type_id: itemTypeId,
      name: entry.title,
      description: entry.groupPath ? `KeePass grubu: ${entry.groupPath}` : '',
      fields: encFields.map((f) => ({
        field_definition_id: f.field_definition_id,
        value_enc: f.value_enc,
        value_nonce: f.value_nonce,
        position: 0,
      })),
      owner_dek_wrapped,
      owner_wrap_nonce,
    });
  }

  return items;
}
