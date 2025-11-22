
'use client';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const steps = [
  { id: 1, title: 'Upload' },
  { id: 2, title: 'Print Options' },
  { id: 3, title: 'Layout' },
  { id: 4, title: 'Confirm & Pay' },
];

interface StepperProps {
    currentStep: number;
    setStep: (step: number) => void;
}

export const Stepper = ({ currentStep, setStep }: StepperProps) => {
  return (
    <div className="w-full px-2 sm:px-0">
      <div className="flex items-center w-full">
        {steps.map((step, index) => {
          const isCompleted = currentStep > step.id;
          const isCurrent = currentStep === step.id;
          const canNavigate = isCompleted;

          return (
            <div key={step.id} className="flex items-center w-full">
              <button
                onClick={() => canNavigate && setStep(step.id)}
                disabled={!canNavigate && !isCurrent}
                className={cn('flex flex-col items-center gap-1.5 flex-shrink-0 w-16 sm:w-20', canNavigate ? 'cursor-pointer' : 'cursor-default')}
              >
                <div
                  className={cn(
                    'w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors border-2',
                    isCurrent ? 'bg-primary border-primary text-primary-foreground' :
                    isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'bg-muted border-gray-300 text-muted-foreground'
                  )}
                >
                  {isCompleted ? <Check className="w-5 h-5 sm:w-6 sm:h-6" /> : <span className="font-bold text-base sm:text-lg">{step.id}</span>}
                </div>
                <span className={cn('text-xs sm:text-sm font-medium text-center', isCurrent ? 'text-primary' : 'text-muted-foreground')}>{step.title}</span>
              </button>
              {index < steps.length - 1 && (
                <div className={cn('flex-1 h-1 mx-1 sm:mx-2 transition-colors', isCompleted || isCurrent ? 'bg-primary' : 'bg-gray-300')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
