/**
 * CreatePage — Backstage-style Golden Path Template Wizard (PR-DP10).
 *
 * 5-step flow: kind selection → entity info → relations → lifecycle → confirm+submit.
 * E2E encryption: DEK generated client-side, sealed with user's private key (KEK).
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Server, Globe, Database, Key, ShieldCheck, Cloud, FileText, Lock } from 'lucide-react';
import { useItemTypes } from '@/api/catalog';
import { useRootFolders } from '@/api/folders';
import { useLifecycleStagesQuery } from '@/api/lifecycle';
import { useCreateItemMutation } from '@/api/items';
import { useAddRelationshipMutation } from '@/api/graph';
import { useSetItemLifecycleStagesMutation } from '@/api/lifecycle';
import { useUpsertAnnotationMutation } from '@/api/annotations';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/hooks/use-toast';
import { generateDEK, toBase64 } from '@/lib/crypto';
import { userFriendlyError } from '@/lib/user-error';
import type { ItemType, RelationshipType } from '@/api/types';
import { WizardLayout } from '@/components/create/wizard-layout';
import { TemplateSelector } from '@/components/create/template-selector';
import { EntityFormStep } from '@/components/create/entity-form-step';
import { RelationStep, type PendingRelation } from '@/components/create/relation-step';
import { LifecycleStep } from '@/components/create/lifecycle-step';
import { cn } from '@/lib/cn';

// ─── DEK sealing (mirrored from item-form-modal.tsx) ────────────────────────

async function sealDEKWithKEK(
  dek: Uint8Array,
  privateKey: Uint8Array,
): Promise<{ wrapped: Uint8Array; nonce: Uint8Array }> {
  const wrapKeyBits = await crypto.subtle.digest('SHA-256', privateKey as BufferSource);
  const wrapKey = await crypto.subtle.importKey('raw', wrapKeyBits, 'AES-GCM', false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, wrapKey, dek as BufferSource),
  );
  const ephPubPlaceholder = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = new Uint8Array(ephPubPlaceholder.length + ctWithTag.length);
  wrapped.set(ephPubPlaceholder);
  wrapped.set(ctWithTag, ephPubPlaceholder.length);
  return { wrapped, nonce };
}

// ─── Kind icons ──────────────────────────────────────────────────────────────

const KIND_ICON: Record<string, React.ElementType> = {
  Server: Server, Service: Globe, Database: Database,
  SSHKey: Key, Certificate: ShieldCheck, CloudCredential: Cloud,
  Note: FileText, Credential: Lock,
};

// ─── Wizard state ────────────────────────────────────────────────────────────

interface WizardState {
  selectedItemType: ItemType | null;
  name: string;
  description: string;
  folderId: string;
  kindFields: Record<string, string>;
  relations: PendingRelation[];
  lifecycleStageIds: number[];
}

const STEPS = [
  { label: 'Template' },
  { label: 'Bilgiler' },
  { label: 'İlişkiler' },
  { label: 'Lifecycle' },
  { label: 'Özet' },
];

// ─── Summary card ────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="w-32 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 text-[13px] text-slate-200">{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreatePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const privateKey = useAuthStore((s) => s.privateKey);

  const [step, setStep] = React.useState<number>(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [state, setState] = React.useState<WizardState>({
    selectedItemType: null,
    name: '',
    description: '',
    folderId: '',
    kindFields: {},
    relations: [],
    lifecycleStageIds: [],
  });

  // Pre-generate stable item ID so hooks can use it from mount
  const newItemId = React.useRef(crypto.randomUUID());

  const { data: typesData, isLoading: typesLoading } = useItemTypes();
  const { data: foldersData } = useRootFolders();
  const { data: stagesData } = useLifecycleStagesQuery();

  const createItemMut = useCreateItemMutation(state.folderId);
  const addRelMut = useAddRelationshipMutation(newItemId.current);
  const setLifecycleMut = useSetItemLifecycleStagesMutation(newItemId.current);
  const upsertAnnotationMut = useUpsertAnnotationMutation(newItemId.current);

  const itemTypes = typesData?.item_types ?? [];
  const folders = foldersData?.folders ?? [];
  const stages = stagesData?.stages ?? [];

  function canProceed(): boolean {
    switch (step) {
      case 1: return state.selectedItemType !== null;
      case 2: return state.name.trim().length >= 1 && state.folderId !== '';
      case 3: return true; // optional step
      case 4: return true; // optional step
      case 5: return !isSubmitting;
      default: return false;
    }
  }

  function handleNext() {
    if (step < 5) setStep((s) => s + 1);
  }

  function handleBack() {
    if (step > 1) setStep((s) => s - 1);
  }

  async function handleSubmit() {
    if (!privateKey) {
      toast({ title: 'Oturum hatası', description: 'Private key bulunamadı. Çıkış yapıp tekrar giriş yapın.', variant: 'destructive' });
      return;
    }
    if (!state.selectedItemType || !state.folderId) return;

    setIsSubmitting(true);
    try {
      const dek = generateDEK();
      const { wrapped, nonce } = await sealDEKWithKEK(dek, privateKey);

      const createdItem = await createItemMut.mutateAsync({
        id: newItemId.current,
        folder_id: state.folderId,
        item_type_id: state.selectedItemType.id,
        name: state.name.trim(),
        description: state.description.trim() || undefined,
        fields: [],
        owner_dek_wrapped: toBase64(wrapped),
        owner_wrap_nonce: toBase64(nonce),
      });

      for (const rel of state.relations) {
        await addRelMut.mutateAsync({ target_id: rel.targetId, type: rel.type });
      }

      if (state.lifecycleStageIds.length > 0) {
        await setLifecycleMut.mutateAsync({ stage_ids: state.lifecycleStageIds });
      }

      for (const [key, value] of Object.entries(state.kindFields)) {
        if (value) await upsertAnnotationMut.mutateAsync({ key, value });
      }

      toast({ title: 'Entity oluşturuldu', description: `"${createdItem.name}" başarıyla oluşturuldu.` });

      if (createdItem.kind) {
        navigate(`/catalog/${createdItem.kind}/default/${encodeURIComponent(createdItem.name)}`);
      } else {
        navigate(`/inventory?item=${createdItem.id}`);
      }
    } catch (e) {
      toast({ title: 'Oluşturma hatası', description: userFriendlyError(e), variant: 'destructive' });
      setIsSubmitting(false);
    }
  }

  const KindIcon = state.selectedItemType?.kind_key
    ? (KIND_ICON[state.selectedItemType.kind_key] ?? Lock)
    : Lock;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WizardLayout
        steps={STEPS}
        currentStep={step}
        onBack={handleBack}
        onNext={handleNext}
        onSubmit={handleSubmit}
        canProceed={canProceed()}
        isSubmitting={isSubmitting}
      >
        {/* ── Step 1: Template ─────────────────────────────────────────── */}
        {step === 1 && (
          typesLoading ? (
            <div className="grid grid-cols-2 gap-2 p-6 sm:grid-cols-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg border border-slate-800 bg-slate-900/40" />
              ))}
            </div>
          ) : (
            <TemplateSelector
              itemTypes={itemTypes}
              selectedItemTypeId={state.selectedItemType?.id ?? null}
              onSelect={(t) => setState((s) => ({ ...s, selectedItemType: t }))}
            />
          )
        )}

        {/* ── Step 2: Entity bilgileri ──────────────────────────────────── */}
        {step === 2 && (
          <EntityFormStep
            name={state.name}
            description={state.description}
            folderId={state.folderId}
            folders={folders}
            kindKey={state.selectedItemType?.kind_key}
            kindFields={state.kindFields}
            onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
          />
        )}

        {/* ── Step 3: İlişkiler (opsiyonel) ────────────────────────────── */}
        {step === 3 && (
          <RelationStep
            relations={state.relations}
            onChange={(relations) => setState((s) => ({ ...s, relations }))}
          />
        )}

        {/* ── Step 4: Lifecycle (opsiyonel) ────────────────────────────── */}
        {step === 4 && (
          <LifecycleStep
            stages={stages}
            selectedStageIds={state.lifecycleStageIds}
            onChange={(ids) => setState((s) => ({ ...s, lifecycleStageIds: ids }))}
          />
        )}

        {/* ── Step 5: Özet + Onay ──────────────────────────────────────── */}
        {step === 5 && (
          <div className="space-y-6 p-6">
            <div>
              <h2 className="mb-1 text-base font-semibold text-slate-200">Özet</h2>
              <p className="text-[13px] text-slate-500">
                Oluşturulacak entity'yi gözden geçirin.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 divide-y divide-slate-800">
              <SummaryRow
                label="Tür"
                value={
                  <span className="flex items-center gap-1.5">
                    <KindIcon className="h-3.5 w-3.5 text-slate-400" />
                    {state.selectedItemType?.kind_key ?? state.selectedItemType?.label ?? '—'}
                  </span>
                }
              />
              <SummaryRow label="İsim" value={<span className="font-mono">{state.name}</span>} />
              {state.description && (
                <SummaryRow label="Açıklama" value={state.description} />
              )}
              <SummaryRow
                label="Klasör"
                value={folders.find((f) => f.id === state.folderId)?.name ?? state.folderId}
              />
              {Object.entries(state.kindFields).filter(([, v]) => v).length > 0 && (
                <SummaryRow
                  label="Ek Bilgiler"
                  value={
                    <ul className="space-y-0.5">
                      {Object.entries(state.kindFields)
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <li key={k} className="text-[12px]">
                            <span className="font-mono text-slate-500">{k}</span>
                            {': '}
                            {v}
                          </li>
                        ))}
                    </ul>
                  }
                />
              )}
              {state.relations.length > 0 && (
                <SummaryRow
                  label="İlişkiler"
                  value={
                    <ul className="space-y-0.5">
                      {state.relations.map((r, i) => (
                        <li key={i} className="text-[12px]">
                          <span className="font-mono text-slate-500">{r.type}</span>
                          {' → '}
                          {r.targetName}
                        </li>
                      ))}
                    </ul>
                  }
                />
              )}
              {state.lifecycleStageIds.length > 0 && (
                <SummaryRow
                  label="Lifecycle"
                  value={
                    <span className="flex flex-wrap gap-1">
                      {stages
                        .filter((s) => state.lifecycleStageIds.includes(s.id))
                        .map((s) => (
                          <span
                            key={s.id}
                            className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300"
                          >
                            {s.key}
                          </span>
                        ))}
                    </span>
                  }
                />
              )}
            </div>

            {!privateKey && (
              <div className="rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-[12px] text-amber-300">
                ⚠️ Private key bulunamadı. Oturumunuz sona ermiş olabilir — çıkış yapıp tekrar giriş yapın.
              </div>
            )}
          </div>
        )}
      </WizardLayout>
    </div>
  );
}
