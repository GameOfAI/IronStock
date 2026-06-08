import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

export interface WizardStep {
  label: string;
}

interface WizardLayoutProps {
  steps: WizardStep[];
  currentStep: number; // 1-based
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  canProceed: boolean;
  isSubmitting?: boolean;
  children: React.ReactNode;
}

export function WizardLayout({
  steps,
  currentStep,
  onBack,
  onNext,
  onSubmit,
  canProceed,
  isSubmitting = false,
  children,
}: WizardLayoutProps) {
  const isLast = currentStep === steps.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Step indicator */}
      <div className="flex shrink-0 items-center justify-center gap-0 border-b border-slate-800 bg-slate-950 px-6 py-4">
        {steps.map((step, idx) => {
          const stepNum = idx + 1;
          const isDone = stepNum < currentStep;
          const isActive = stepNum === currentStep;
          return (
            <React.Fragment key={step.label}>
              {idx > 0 && (
                <div
                  className={cn(
                    'mx-1 h-px w-12 transition-colors',
                    isDone ? 'bg-blue-500' : 'bg-slate-700',
                  )}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
                    isDone
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : isActive
                        ? 'border-blue-400 bg-blue-400/10 text-blue-300'
                        : 'border-slate-700 text-slate-500',
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : stepNum}
                </div>
                <span
                  className={cn(
                    'hidden text-[10px] lg:block',
                    isActive ? 'font-medium text-slate-200' : 'text-slate-500',
                  )}
                >
                  {step.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step content */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {/* Navigation buttons */}
      <div className="flex shrink-0 items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-4">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={currentStep === 1 || isSubmitting}
        >
          Geri
        </Button>
        {isLast ? (
          <Button
            onClick={onSubmit}
            disabled={!canProceed || isSubmitting}
          >
            {isSubmitting ? 'Oluşturuluyor…' : 'Entity Oluştur'}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!canProceed}>
            İleri
          </Button>
        )}
      </div>
    </div>
  );
}
