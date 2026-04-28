/**
 * Item oluşturma/düzenleme modalı.
 *
 * Yeni item: ad + tip seçimi + alan değerleri (E2E şifreli DEK).
 * Düzenleme: yalnızca ad değiştirilebilir (DEK expose PR-13 bekliyor).
 *
 * DEK wrap: sealDEKWithKEK (SHA-256(privateKey) → AES-GCM) — PR-13 sonrası
 * X25519 sealed-box ile değiştirilecek.
 */

import { useEffect, useReducer, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
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
import { useCreateItemMutation, useUpdateItemMutation } from '@/api/items';
import { useAuthStore } from '@/store/auth';
import { generateDEK, encryptField, toBase64, sealDEKWithKEK } from '@/lib/crypto';
import type { FieldDefinition, Item, ItemType } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folderId: string;
  fieldDefinitions: FieldDefinition[];
  itemTypes: ItemType[];
  editItem?: Item | null;
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
      return { ...state, [action.id]: { ...state[action.id], visible: !state[action.id]?.visible } };
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
}: Props) {
  const isEdit = Boolean(editItem);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [itemTypeId, setItemTypeId] = useState<string>('');
  const [fields, dispatchFields] = useReducer(fieldReducer, {});
  const [error, setError] = useState<string | null>(null);

  const privateKey = useAuthStore((s) => s.privateKey);

  const createMutation = useCreateItemMutation(folderId);
  const updateMutation = useUpdateItemMutation(editItem?.id ?? '', folderId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const selectedType = itemTypes.find((t) => t.id === Number(itemTypeId));
  const suggestedDefs = selectedType
    ? fieldDefinitions.filter((d) => selectedType.suggested_fields.includes(d.key))
    : [];

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      setName(editItem.name);
      setDescription(editItem.description ?? '');
      setItemTypeId(String(editItem.item_type_id));
    } else {
      setName('');
      setDescription('');
      setItemTypeId(itemTypes[0] ? String(itemTypes[0].id) : '');
    }
    setError(null);
  }, [open, editItem, itemTypes]);

  useEffect(() => {
    if (!selectedType || isEdit) return;
    dispatchFields({ type: 'reset', fields: buildInitialFields(selectedType.suggested_fields, fieldDefinitions) });
  }, [selectedType, fieldDefinitions, isEdit]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !itemTypeId) return;
    setError(null);

    try {
      if (isEdit && editItem) {
        await updateMutation.mutateAsync({
          name: trimmed,
          description: description.trim() || undefined,
        });
      } else {
        if (!privateKey) {
          setError('Şifreleme için oturum anahtarı bulunamadı. Lütfen yeniden giriş yapın.');
          return;
        }
        const dek = generateDEK();
        const { wrapped: ownerDEKWrapped, nonce: wrapNonce } = await sealDEKWithKEK(dek, privateKey);

        const encryptedFields = await Promise.all(
          Object.entries(fields)
            .filter(([, { value }]) => value.trim() !== '')
            .map(async ([defIdStr, { value }], idx) => {
              const { valueEnc, valueNonce } = await encryptField(value.trim(), dek);
              return {
                field_definition_id: Number(defIdStr),
                value_enc: toBase64(valueEnc),
                value_nonce: toBase64(valueNonce),
                position: idx,
              };
            }),
        );

        await createMutation.mutateAsync({
          id: crypto.randomUUID(),
          folder_id: folderId,
          item_type_id: Number(itemTypeId),
          name: trimmed,
          description: description.trim() || undefined,
          fields: encryptedFields,
          owner_dek_wrapped: toBase64(ownerDEKWrapped),
          owner_wrap_nonce: toBase64(wrapNonce),
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Item Düzenle' : 'Yeni Item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="item-name">Ad</Label>
            <Input
              id="item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item adı"
              autoFocus
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-description">
              Açıklama <span className="text-muted-foreground">(opsiyonel)</span>
            </Label>
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
              <Label htmlFor="item-type">Tip</Label>
              <select
                id="item-type"
                value={itemTypeId}
                onChange={(e) => setItemTypeId(e.target.value)}
                disabled={isPending}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {itemTypes.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isEdit && suggestedDefs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock size={12} />
                Alanlar uçtan uca şifrelenir
              </div>
              {suggestedDefs.map((def) => (
                <FieldInput
                  key={def.id}
                  def={def}
                  state={fields[def.id] ?? { value: '', visible: false }}
                  disabled={isPending}
                  onChangeValue={(v) => dispatchFields({ type: 'set', id: def.id, value: v })}
                  onToggleVisible={() => dispatchFields({ type: 'toggle', id: def.id })}
                />
              ))}
            </div>
          )}

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

interface FieldInputProps {
  def: FieldDefinition;
  state: FieldState;
  disabled: boolean;
  onChangeValue: (v: string) => void;
  onToggleVisible: () => void;
}

function FieldInput({ def, state, disabled, onChangeValue, onToggleVisible }: FieldInputProps) {
  const isSecret = def.is_secret || def.field_type === 'password';
  const inputType =
    isSecret && !state.visible ? 'password'
    : def.field_type === 'url' ? 'url'
    : def.field_type === 'email' ? 'email'
    : def.field_type === 'port' ? 'number'
    : 'text';

  const id = `field-${def.id}`;

  if (def.field_type === 'multiline') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{def.label}</Label>
        <textarea
          id={id}
          value={state.value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder={def.hint ?? ''}
          disabled={disabled}
          rows={3}
          className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    );
  }

  if (def.field_type === 'enum' && def.allowed_values && def.allowed_values.length > 0) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{def.label}</Label>
        <select
          id={id}
          value={state.value}
          onChange={(e) => onChangeValue(e.target.value)}
          disabled={disabled}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">{def.hint ?? `${def.label} seçin`}</option>
          {(def.allowed_values as string[]).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
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
          placeholder={def.hint ?? ''}
          disabled={disabled}
          className={isSecret ? 'pr-9 font-mono' : ''}
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
