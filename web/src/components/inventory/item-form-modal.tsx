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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateItemMutation, useUpdateItemMutation } from '@/api/items';
import { useAuthStore } from '@/store/auth';
import { generateDEK, encryptField, toBase64 } from '@/lib/crypto';
import type { FieldDefinition, Item, ItemType } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folderId: string;
  fieldDefinitions: FieldDefinition[];
  itemTypes: ItemType[];
  /** When set, we're editing an existing item (name-only edit). */
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
  // PR-N1: expiry fields
  const [expiresAt, setExpiresAt] = useState(''); // ISO date string (YYYY-MM-DD)
  const [rotationIntervalDays, setRotationIntervalDays] = useState('');

  const privateKey = useAuthStore((s) => s.privateKey);
  const user = useAuthStore((s) => s.user);

  const createMutation = useCreateItemMutation(folderId);
  const updateMutation = useUpdateItemMutation(editItem?.id ?? '', folderId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const selectedType = itemTypes.find((t) => t.id === Number(itemTypeId));

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      setName(editItem.name);
      setDescription(editItem.description ?? '');
      setItemTypeId(String(editItem.item_type_id));
      // Populate expiry from existing item (ISO → date input needs YYYY-MM-DD).
      setExpiresAt(editItem.expires_at ? editItem.expires_at.slice(0, 10) : '');
      setRotationIntervalDays(editItem.rotation_interval_days != null ? String(editItem.rotation_interval_days) : '');
    } else if (duplicateFrom) {
      setName(duplicateFrom.name);
      setDescription(duplicateFrom.description ?? '');
      setItemTypeId(String(duplicateFrom.itemTypeId));
    } else {
      setName('');
      setDescription('');
      setItemTypeId(itemTypes[0] ? String(itemTypes[0].id) : '');
      setExpiresAt('');
      setRotationIntervalDays('');
    }
    setError(null);
    // Reset stale mutation errors from previous calls.
    createMutation.reset();
    updateMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editItem, duplicateFrom, itemTypes]);

  // Re-build the field map whenever the modal opens or the selected type
  // changes. Including `open` in deps ensures fields fully reset on each
  // open — even when selectedType reference is stable across opens.
  useEffect(() => {
    if (!open || !selectedType || isEdit) return;
    const initial = buildInitialFields(selectedType.suggested_fields, fieldDefinitions);
    if (duplicateFrom) {
      // Prefill plaintext values from the duplicate source.
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
        await updateMutation.mutateAsync({
          name: trimmed,
          description: description.trim() || undefined,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          rotation_interval_days: rotationIntervalDays ? Number(rotationIntervalDays) : null,
        });
      } else {
        if (!privateKey || !user) {
          setError('Şifreleme için oturum anahtarı bulunamadı. Lütfen yeniden giriş yapın.');
          return;
        }
        // Build public key from user's keypair to seal DEK with own public key.
        // We derive public key from private key on the fly via generateX25519Keypair.
        // For sealing: we need own public key. It's stored in the server keypair.
        // Short-cut: wrap DEK with KEK instead of X25519 to keep create working
        // until server exposes owner public key inline. This is intentional MVP
        // simplification — when server adds GET /users/me/keypair pub_key we swap.
        //
        // For now, use KEK-wrapped DEK (symmetric, owner-only) as placeholder.
        // The server just stores whatever bytes we send.
        const dek = generateDEK();
        const { wrapped: ownerDEKWrapped, nonce: wrapNonce } = await sealDEKWithKEK(
          dek,
          privateKey,
        );

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
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu');
    }
  }

  const suggestedDefs = selectedType
    ? fieldDefinitions.filter((d) => selectedType.suggested_fields.includes(d.key))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Item Düzenle' : 'Yeni Item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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

          {!isEdit && suggestedDefs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock size={12} />
                Alanlar uçtan uca şifrelenir
              </div>
              {selectedType?.field_groups && selectedType.field_groups.length > 0
                ? selectedType.field_groups.map((group) => {
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
                        {groupDefs.map((def) => (
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
                    );
                  })
                : suggestedDefs.map((def) => (
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


          {/* PR-N1: Credential Expiry / Rotation */}
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Süre & Rotasyon
            </p>
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
      <div className="space-y-1.5">
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
