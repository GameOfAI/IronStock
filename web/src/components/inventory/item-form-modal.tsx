import { useEffect, useReducer, useState } from 'react';
import { ChevronDown, ChevronRight, DatabaseZap, Eye, EyeOff, HelpCircle, Lock, Loader2, Plus, Trash2 } from 'lucide-react';
import { TemplateGallery } from './item-form-templates';
import type { ItemTemplate } from './item-form-templates';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useCreateItemMutation, useUpdateItemMutation, useItemDuplicatesQuery } from '@/api/items';
import { useAuthStore } from '@/store/auth';
import { generateDEK, encryptField, toBase64, fromBase64, openDEKWithKEK, decryptField } from '@/lib/crypto';
import type { ExternalSourceVault, FieldDefinition, Item, ItemType } from '@/api/types';
import { useVaultPathsQuery } from '@/api/vault';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folderId: string;
  fieldDefinitions: FieldDefinition[];
  itemTypes: ItemType[];
  /**
   * When set, we're editing an existing item.
   * Pass the full item (with owner_dek_wrapped + fields) so we can decrypt.
   */
  editItem?: Item | null;
  /**
   * When set, opens in CREATE mode but pre-fills name/type/fields from this
   * template (used by the Duplicate action). Plaintext field values per
   * field_definition_id; the form re-encrypts on save.
   */
  duplicateFrom?: {
    name: string;
    description?: string;
    itemTypeId: number;
    fieldValues: Record<number, string>;
  } | null;
}

interface FieldState {
  value: string;
  visible: boolean;
}

type FieldMap = Record<number, FieldState>;

function buildInitialFields(suggested: string[], defs: FieldDefinition[]): FieldMap {
  const map: FieldMap = {};
  for (const key of suggested) {
    const def = defs.find((d) => d.key === key);
    if (def) map[def.id] = { value: '', visible: false };
  }
  return map;
}

type FieldAction =
  | { type: 'set'; id: number; value: string }
  | { type: 'toggle'; id: number }
  | { type: 'reset'; fields: FieldMap };

function fieldReducer(state: FieldMap, action: FieldAction): FieldMap {
  switch (action.type) {
    case 'set':
      return { ...state, [action.id]: { ...state[action.id], value: action.value } };
    case 'toggle':
      return {
        ...state,
        [action.id]: { ...state[action.id], visible: !state[action.id]?.visible },
      };
    case 'reset':
      return action.fields;
    default:
      return state;
  }
}

export function ItemFormModal({
  open,
  onOpenChange,
  folderId,
  fieldDefinitions,
  itemTypes,
  editItem,
  duplicateFrom,
}: Props) {
  const isEdit = Boolean(editItem);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [itemTypeId, setItemTypeId] = useState<string>('');
  const [fields, dispatchFields] = useReducer(fieldReducer, {});
  const [error, setError] = useState<string | null>(null);
  const [decryptingFields, setDecryptingFields] = useState(false);
  // PR-UX9: şablon galerisi — sadece "yeni oluştur" modunda göster
  const [showTemplates, setShowTemplates] = useState(true);
  // PR-N1: expiry fields
  const [expiresAt, setExpiresAt] = useState(''); // ISO date string (YYYY-MM-DD)
  const [rotationIntervalDays, setRotationIntervalDays] = useState('');

  // Cached DEK for edit mode — re-used on save to avoid re-wrapping.
  const [editDek, setEditDek] = useState<Uint8Array | null>(null);

  // PR-DUP: duplicate detection — query fires after user stops typing in name field.
  // In edit mode, exclude the current item from results.
  const dupQuery = useItemDuplicatesQuery(name, editItem?.id);
  const dupCount = dupQuery.data?.count ?? 0;
  const dupItems = dupQuery.data?.items ?? [];
  const showDupWarning = dupCount > 0 && name.trim().length >= 1;

  // PR-VAULT: external Vault source configuration (create mode only).
  const [useVault, setUseVault] = useState(false);
  const [vaultMount, setVaultMount] = useState('secret');
  const [vaultPath, setVaultPath] = useState('');
  const [vaultKvVersion, setVaultKvVersion] = useState<1 | 2>(2);
  const [vaultKeyMapping, setVaultKeyMapping] = useState<{ fieldKey: string; vaultKey: string }[]>([]);
  const [vaultPanelOpen, setVaultPanelOpen] = useState(false);
  // Path autocomplete (admin only; non-admins get empty list, no error).
  const vaultPathsQuery = useVaultPathsQuery(useVault ? vaultMount : '', useVault ? vaultPath : '');

  const privateKey = useAuthStore((s) => s.privateKey);
  const user = useAuthStore((s) => s.user);

  const createMutation = useCreateItemMutation(folderId);
  const updateMutation = useUpdateItemMutation(editItem?.id ?? '', folderId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const selectedType = itemTypes.find((t) => t.id === Number(itemTypeId));

  // Decrypt existing field values when opening in edit mode.
  useEffect(() => {
    if (!open || !editItem) return;
    setName(editItem.name);
    setDescription(editItem.description ?? '');
    setItemTypeId(String(editItem.item_type_id));
    setExpiresAt(editItem.expires_at ? editItem.expires_at.slice(0, 10) : '');
    setRotationIntervalDays(editItem.rotation_interval_days != null ? String(editItem.rotation_interval_days) : '');
    setError(null);
    createMutation.reset();
    updateMutation.reset();
    setEditDek(null);

    // Try to decrypt fields if we have the DEK and private key.
    if (!editItem.owner_dek_wrapped || !editItem.owner_wrap_nonce || !privateKey) {
      // Build empty field map from the item type so inputs are still shown.
      const type = itemTypes.find((t) => t.id === editItem.item_type_id);
      if (type) {
        dispatchFields({ type: 'reset', fields: buildInitialFields(type.suggested_fields, fieldDefinitions) });
      }
      return;
    }

    setDecryptingFields(true);
    openDEKWithKEK(
      fromBase64(editItem.owner_dek_wrapped),
      fromBase64(editItem.owner_wrap_nonce),
      privateKey,
    )
      .then(async (dek) => {
        setEditDek(dek);
        const type = itemTypes.find((t) => t.id === editItem.item_type_id);
        const initial = type
          ? buildInitialFields(type.suggested_fields, fieldDefinitions)
          : {};

        for (const f of editItem.fields ?? []) {
          if (!f.value_enc || !f.value_nonce) continue;
          try {
            const plain = await decryptField(fromBase64(f.value_enc), fromBase64(f.value_nonce), dek);
            initial[f.field_definition_id] = { value: plain, visible: false };
          } catch {
            // keep empty if decrypt fails
          }
        }
        dispatchFields({ type: 'reset', fields: initial });
      })
      .catch(() => {
        const type = itemTypes.find((t) => t.id === editItem.item_type_id);
        if (type) {
          dispatchFields({ type: 'reset', fields: buildInitialFields(type.suggested_fields, fieldDefinitions) });
        }
      })
      .finally(() => setDecryptingFields(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editItem]);

  // Reset for create/duplicate modes.
  useEffect(() => {
    if (!open || editItem) return;
    if (duplicateFrom) {
      setName(duplicateFrom.name);
      setDescription(duplicateFrom.description ?? '');
      setItemTypeId(String(duplicateFrom.itemTypeId));
      setShowTemplates(false);
    } else {
      setName('');
      setDescription('');
      setItemTypeId(itemTypes[0] ? String(itemTypes[0].id) : '');
      setExpiresAt('');
      setRotationIntervalDays('');
      setShowTemplates(true); // yeni oluşturma: şablon galerisini göster
    }
    setError(null);
    createMutation.reset();
    updateMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editItem, duplicateFrom, itemTypes]);

  // Re-build the field map whenever the modal opens or the selected type
  // changes — only for create/duplicate modes.
  useEffect(() => {
    if (!open || !selectedType || isEdit) return;
    const initial = buildInitialFields(selectedType.suggested_fields, fieldDefinitions);
    if (duplicateFrom) {
      for (const defIdStr of Object.keys(initial)) {
        const defId = Number(defIdStr);
        const v = duplicateFrom.fieldValues[defId];
        if (v !== undefined) {
          initial[defId] = { value: v, visible: false };
        }
      }
    }
    dispatchFields({ type: 'reset', fields: initial });
  }, [open, selectedType, fieldDefinitions, isEdit, duplicateFrom]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !itemTypeId) return;
    setError(null);

    try {
      if (isEdit && editItem) {
        if (!privateKey) {
          setError('Şifreleme anahtarı bulunamadı. Lütfen yeniden giriş yapın.');
          return;
        }
        // Re-use existing DEK if we decrypted it, otherwise create a new one.
        const dek = editDek ?? generateDEK();
        const { wrapped: ownerDEKWrapped, nonce: wrapNonce } = await sealDEKWithKEK(dek, privateKey);

        const encryptedFields = await Promise.all(
          Object.entries(fields)
            .filter(([, { value }]) => value.trim() !== '')
            .map(async ([defIdStr, { value }], idx) => {
              const defId = Number(defIdStr);
              const { valueEnc, valueNonce } = await encryptField(value.trim(), dek);
              return {
                field_definition_id: defId,
                value_enc: toBase64(valueEnc),
                value_nonce: toBase64(valueNonce),
                position: idx,
              };
            }),
        );

        await updateMutation.mutateAsync({
          name: trimmed,
          description: description.trim() || undefined,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          rotation_interval_days: rotationIntervalDays ? Number(rotationIntervalDays) : null,
          fields: encryptedFields,
          owner_dek_wrapped: toBase64(ownerDEKWrapped),
          owner_wrap_nonce: toBase64(wrapNonce),
        });
      } else {
        if (!privateKey || !user) {
          setError('Şifreleme için oturum anahtarı bulunamadı. Lütfen yeniden giriş yapın.');
          return;
        }
        const dek = generateDEK();
        const { wrapped: ownerDEKWrapped, nonce: wrapNonce } = await sealDEKWithKEK(dek, privateKey);

        const encryptedFields = await Promise.all(
          Object.entries(fields)
            .filter(([, { value }]) => value.trim() !== '')
            .map(async ([defIdStr, { value }], idx) => {
              const defId = Number(defIdStr);
              const { valueEnc, valueNonce } = await encryptField(value.trim(), dek);
              return {
                field_definition_id: defId,
                value_enc: toBase64(valueEnc),
                value_nonce: toBase64(valueNonce),
                position: idx,
              };
            }),
        );

        // Build vault external_source if vault mode enabled.
        let externalSource: ExternalSourceVault | null = null;
        if (useVault && vaultMount && vaultPath) {
          const mapping: Record<string, string> = {};
          for (const { fieldKey, vaultKey } of vaultKeyMapping) {
            if (fieldKey.trim() && vaultKey.trim()) {
              mapping[fieldKey.trim()] = vaultKey.trim();
            }
          }
          externalSource = { type: 'vault', mount: vaultMount, path: vaultPath, kv_version: vaultKvVersion, key_mapping: mapping };
        }

        await createMutation.mutateAsync({
          id: crypto.randomUUID(),
          folder_id: folderId,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          rotation_interval_days: rotationIntervalDays ? Number(rotationIntervalDays) : undefined,
          item_type_id: Number(itemTypeId),
          name: trimmed,
          description: description.trim() || undefined,
          fields: encryptedFields,
          owner_dek_wrapped: toBase64(ownerDEKWrapped),
          owner_wrap_nonce: toBase64(wrapNonce),
          external_source: externalSource as Record<string, unknown> | null,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu');
    }
  }

  // PR-UX9: şablon seçimi → tip ata + ön-değerleri fieldMap'e yaz
  function handleTemplateSelect(tpl: ItemTemplate) {
    const matched = itemTypes.find((t) => t.key === tpl.typeKey);
    if (matched) {
      setItemTypeId(String(matched.id));
      // Template default değerleri bir sonraki render cycle'da selectedType
      // değişince useEffect ile field map rebuild edilir; sonrasında override ederiz.
      // setTimeout ile rebuild'ın bitmesini bekle, sonra defaults'u yaz.
      setTimeout(() => {
        for (const [fieldKey, fieldValue] of Object.entries(tpl.defaults)) {
          const def = fieldDefinitions.find((d) => d.key === fieldKey);
          if (def) {
            dispatchFields({ type: 'set', id: def.id, value: fieldValue });
          }
        }
      }, 0);
    }
    setShowTemplates(false);
  }

  const suggestedDefs = selectedType
    ? fieldDefinitions.filter((d) => selectedType.suggested_fields.includes(d.key))
    : editItem
      ? fieldDefinitions.filter((d) =>
          itemTypes.find((t) => t.id === editItem.item_type_id)?.suggested_fields.includes(d.key),
        )
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Item Düzenle' : 'Yeni Item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* PR-UX9: Şablon galerisi — yalnızca yeni oluşturma modunda */}
          {!isEdit && !duplicateFrom && (
            <div className="rounded-lg border bg-muted/30">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowTemplates((v) => !v)}
              >
                <span>Şablondan başla</span>
                {showTemplates ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              {showTemplates && (
                <div className="border-t px-3 pb-3 pt-2">
                  <TemplateGallery
                    onSelect={handleTemplateSelect}
                    onSkip={() => setShowTemplates(false)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="item-name">
              Ad <span className="text-destructive">*</span>
            </Label>
            <Input
              id="item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item adı"
              autoFocus
              disabled={isPending}
            />
            {/* PR-DUP: duplicate name warning */}
            {showDupWarning && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-medium">
                  Bu ada sahip {dupCount} item zaten var:
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                  {dupItems.slice(0, 5).map((it) => (
                    <li key={it.id}>{it.name}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                  Yine de devam edebilirsiniz — aynı ad birden fazla item'da olabilir.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-description">Açıklama <span className="text-muted-foreground">(opsiyonel)</span></Label>
            <textarea
              id="item-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notlar, bağlam, kullanım bilgisi…"
              disabled={isPending}
              rows={3}
              className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="item-type">
                Tip <span className="text-destructive">*</span>
              </Label>
              <Select value={itemTypeId} onValueChange={setItemTypeId} disabled={isPending}>
                <SelectTrigger id="item-type">
                  <SelectValue placeholder="Tip seçin" />
                </SelectTrigger>
                <SelectContent>
                  {itemTypes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Field inputs — shown for both create and edit */}
          {suggestedDefs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock size={12} />
                Alanlar uçtan uca şifrelenir
                {decryptingFields && (
                  <span className="flex items-center gap-1 ml-2">
                    <Loader2 size={11} className="animate-spin" />
                    Şifre çözülüyor…
                  </span>
                )}
              </div>
              {(() => {
                const editType = isEdit ? itemTypes.find((t) => t.id === editItem?.item_type_id) : selectedType;
                const hasGroups = editType?.field_groups && editType.field_groups.length > 0;
                if (hasGroups && editType?.field_groups) {
                  return editType.field_groups.map((group) => {
                    const groupDefs = group.fields
                      .map((k) => suggestedDefs.find((d) => d.key === k))
                      .filter(Boolean) as FieldDefinition[];
                    if (groupDefs.length === 0) return null;
                    return (
                      <div key={group.name} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.name}
                          </span>
                          <div className="flex-1 border-t" />
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {groupDefs.map((def) => (
                            <FieldInput
                              key={def.id}
                              def={def}
                              state={fields[def.id] ?? { value: '', visible: false }}
                              disabled={isPending || decryptingFields}
                              onChangeValue={(v) => dispatchFields({ type: 'set', id: def.id, value: v })}
                              onToggleVisible={() => dispatchFields({ type: 'toggle', id: def.id })}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  });
                }
                return (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {suggestedDefs.map((def) => (
                      <FieldInput
                        key={def.id}
                        def={def}
                        state={fields[def.id] ?? { value: '', visible: false }}
                        disabled={isPending || decryptingFields}
                        onChangeValue={(v) => dispatchFields({ type: 'set', id: def.id, value: v })}
                        onToggleVisible={() => dispatchFields({ type: 'toggle', id: def.id })}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          )}


          {/* PR-VAULT: external Vault source (create mode only) */}
          {!isEdit && (
            <div className="rounded-md border border-dashed">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                onClick={() => {
                  if (!useVault) { setUseVault(true); setVaultPanelOpen(true); }
                  else setVaultPanelOpen((v) => !v);
                }}
              >
                <DatabaseZap className={`h-4 w-4 shrink-0 ${useVault ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vault Kaynağı
                  {useVault && <span className="ml-2 text-emerald-600 dark:text-emerald-400 normal-case font-normal">(etkin)</span>}
                </span>
                {vaultPanelOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {vaultPanelOpen && (
                <div className="border-t px-3 pb-3 pt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">Secret değerleri DB'ye kaydedilmez — Vault'tan canlı çekilir.</p>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
                      <input type="checkbox" checked={useVault} onChange={(e) => setUseVault(e.target.checked)} className="h-4 w-4 rounded accent-emerald-600" />
                      Vault kaynağını etkinleştir
                    </label>
                  </div>
                  {useVault && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="vault-mount">Mount</Label>
                          <Input id="vault-mount" value={vaultMount} onChange={(e) => setVaultMount(e.target.value)} placeholder="secret" disabled={isPending} className="font-mono text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="vault-kv">KV Sürümü</Label>
                          <Select value={String(vaultKvVersion)} onValueChange={(v) => setVaultKvVersion(Number(v) as 1 | 2)} disabled={isPending}>
                            <SelectTrigger id="vault-kv"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2">KV v2 (önerilen)</SelectItem>
                              <SelectItem value="1">KV v1</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="vault-path">Path</Label>
                        <Input id="vault-path" value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} placeholder="prod/db/postgres" disabled={isPending} className="font-mono text-sm" list="vault-path-suggestions" />
                        {(vaultPathsQuery.data?.paths ?? []).length > 0 && (
                          <datalist id="vault-path-suggestions">
                            {(vaultPathsQuery.data?.paths ?? []).map((p) => <option key={p} value={p} />)}
                          </datalist>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Anahtar Eşlemesi (field_key → vault_key)</Label>
                          <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setVaultKeyMapping((m) => [...m, { fieldKey: '', vaultKey: '' }])}>
                            <Plus className="h-3 w-3" /> Ekle
                          </button>
                        </div>
                        {vaultKeyMapping.length === 0 && <p className="text-xs text-muted-foreground italic">Eşleme yok — tüm Vault key'leri döner.</p>}
                        {vaultKeyMapping.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Input value={row.fieldKey} onChange={(e) => setVaultKeyMapping((m) => m.map((r, i) => i === idx ? { ...r, fieldKey: e.target.value } : r))} placeholder="password" disabled={isPending} className="font-mono text-xs h-7 flex-1" />
                            <span className="text-muted-foreground text-xs shrink-0">→</span>
                            <Input value={row.vaultKey} onChange={(e) => setVaultKeyMapping((m) => m.map((r, i) => i === idx ? { ...r, vaultKey: e.target.value } : r))} placeholder="db_password" disabled={isPending} className="font-mono text-xs h-7 flex-1" />
                            <button type="button" aria-label="Kaldır" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => setVaultKeyMapping((m) => m.filter((_, i) => i !== idx))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PR-N1: Credential Expiry / Rotation */}
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Süre & Rotasyon
              </p>
              <span title="Credential'ın ne zaman expire olacağını ve kaç günde bir değiştirilmesi gerektiğini belirtir. Yaklaşan/geçmiş tarihler için otomatik bildirim oluşturulur.">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="item-expires-at">
                  Son geçerlilik tarihi
                </Label>
                <Input
                  id="item-expires-at"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="item-rotation-days">
                  Rotasyon aralığı (gün)
                </Label>
                <Input
                  id="item-rotation-days"
                  type="number"
                  min={1}
                  value={rotationIntervalDays}
                  onChange={(e) => setRotationIntervalDays(e.target.value)}
                  placeholder="örn. 90"
                  disabled={isPending}
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- FieldInput ---

interface FieldInputProps {
  def: FieldDefinition;
  state: FieldState;
  disabled: boolean;
  onChangeValue: (v: string) => void;
  onToggleVisible: () => void;
}

function FieldInput({ def, state, disabled, onChangeValue, onToggleVisible }: FieldInputProps) {
  // Username is treated as hideable per UI policy (eye toggle in form too).
  const isSecret =
    def.is_secret || def.field_type === 'password' || def.key === 'username';
  const isNumeric = def.field_type === 'number' || def.field_type === 'port';
  const isIP = def.field_type === 'ip';

  const inputType =
    isSecret && !state.visible
      ? 'password'
      : def.field_type === 'url'
        ? 'url'
        : def.field_type === 'email'
          ? 'email'
          : isNumeric
            ? 'number'
            : 'text';

  // Integer constraints for numeric fields.
  const numericProps = isNumeric
    ? {
        step: 1,
        min: 0,
        max: def.field_type === 'port' ? 65535 : undefined,
        // Prevent non-integer input (e.g. "1.5").
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
          if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
        },
      }
    : {};

  // IPv4/IPv6 hint + soft pattern validation. The pattern accepts standard
  // dotted-quad IPv4 and any colon-bearing string for IPv6 (the latter is
  // too complex for a regex; client-side hint is sufficient).
  const ipProps = isIP
    ? {
        pattern:
          '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^([0-9a-fA-F:]+)$',
        title: 'IPv4 (örn 192.168.1.10) veya IPv6 (örn ::1)',
      }
    : {};

  const placeholder = def.hint ?? (isIP ? '192.168.1.10' : '');

  const id = `field-${def.id}`;

  if (def.field_type === 'enum' && def.allowed_values && def.allowed_values.length > 0) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{def.label}</Label>
        <Select
          value={state.value}
          onValueChange={onChangeValue}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={def.hint ?? `${def.label} seçin`} />
          </SelectTrigger>
          <SelectContent>
            {(def.allowed_values as string[]).map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (def.field_type === 'multiline') {
    return (
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id}>{def.label}</Label>
        <textarea
          id={id}
          value={state.value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={def.hint ?? ''}
          disabled={disabled}
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none font-mono"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{def.label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={inputType}
          value={state.value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={isSecret ? 'pr-9 font-mono' : ''}
          {...numericProps}
          {...ipProps}
        />
        {isSecret && (
          <button
            type="button"
            aria-label={state.visible ? 'Gizle' : 'Göster'}
            onClick={onToggleVisible}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {state.visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

// --- KEK-based DEK seal (MVP placeholder until server exposes owner pub_key inline) ---
// Uses AES-GCM with private key material as wrap key rather than full X25519 sealed box.
// The 12-byte nonce fits the server's owner_wrap_nonce CHECK constraint.
async function sealDEKWithKEK(
  dek: Uint8Array,
  privateKey: Uint8Array,
): Promise<{ wrapped: Uint8Array; nonce: Uint8Array }> {
  // Derive a 32-byte wrap key from the X25519 private key by hashing with SHA-256.
  const wrapKeyBits = await crypto.subtle.digest('SHA-256', privateKey as BufferSource);
  const wrapKey = await crypto.subtle.importKey(
    'raw',
    wrapKeyBits,
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      wrapKey,
      dek as BufferSource,
    ),
  );
  // Prepend a 32-byte ephemeral public key placeholder so wrapped is always 80B,
  // matching the X25519 sealed-box layout openDEK expects.
  const ephPubPlaceholder = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = new Uint8Array(ephPubPlaceholder.length + ctWithTag.length);
  wrapped.set(ephPubPlaceholder);
  wrapped.set(ctWithTag, ephPubPlaceholder.length);
  return { wrapped, nonce };
}
