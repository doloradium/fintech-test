import { AlertCircle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import type { AnswerValue, Step } from '@funnel/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

type Props = {
  step: Step;
  value: AnswerValue | undefined;
  error: string | null;
  busy: boolean;
  canGoBack: boolean;
  onChange: (value: AnswerValue) => void;
  onSubmit: () => void;
  onBack: () => void;
};

const asArray = (value: AnswerValue | undefined): string[] => (Array.isArray(value) ? value : []);

const optionRow = (active: boolean): string =>
  cn(
    'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
    active ? 'border-primary bg-accent' : 'hover:bg-accent/50',
  );

export const StepView = ({ step, value, error, busy, canGoBack, onChange, onSubmit, onBack }: Props) => {
  const options = step.input?.options ?? [];

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Card>
        <CardHeader>
          {step.content.eyebrow ? (
            <Badge variant="secondary" className="mb-1 w-fit">
              {step.content.eyebrow}
            </Badge>
          ) : null}
          <CardTitle className="text-2xl leading-tight tracking-tight text-balance">
            {step.content.title ?? step.id}
          </CardTitle>
          {step.content.body ? <CardDescription className="text-base">{step.content.body}</CardDescription> : null}
          {step.content.helperText ? <CardDescription>{step.content.helperText}</CardDescription> : null}
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {step.type === 'single-select' ? (
            <RadioGroup
              value={typeof value === 'string' ? value : ''}
              onValueChange={(next) => onChange(next)}
              className="gap-2"
            >
              {options.map((option, index) => {
                const id = `${step.id}-${index}`;
                return (
                  <Label key={index} htmlFor={id} className={optionRow(value === option.value)}>
                    <RadioGroupItem id={id} value={option.value} className="mt-0.5" />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="text-muted-foreground text-sm font-normal">{option.description}</span>
                      ) : null}
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
          ) : null}

          {step.type === 'multi-select' ? (
            <div className="flex flex-col gap-2">
              {options.map((option, index) => {
                const id = `${step.id}-${index}`;
                const selected = asArray(value).includes(option.value);
                return (
                  <Label key={index} htmlFor={id} className={optionRow(selected)}>
                    <Checkbox
                      id={id}
                      checked={selected}
                      className="mt-0.5"
                      onCheckedChange={() => {
                        const current = asArray(value);
                        onChange(
                          selected ? current.filter((item) => item !== option.value) : [...current, option.value],
                        );
                      }}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="text-muted-foreground text-sm font-normal">{option.description}</span>
                      ) : null}
                    </span>
                  </Label>
                );
              })}
            </div>
          ) : null}

          {step.type === 'number' ? (
            <div className="flex items-center gap-3">
              <Input
                autoFocus
                type="number"
                inputMode="numeric"
                className="max-w-40 text-lg"
                min={step.input?.min}
                max={step.input?.max}
                step={step.input?.step ?? 'any'}
                placeholder={step.input?.placeholder ?? ''}
                value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
                onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
              />
              {step.input?.unit ? <span className="text-muted-foreground">{step.input.unit}</span> : null}
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        <CardFooter className="justify-between gap-3">
          <Button type="button" variant="ghost" onClick={onBack} disabled={!canGoBack || busy}>
            <ArrowLeft />
            {step.content.backActionLabel ?? 'Back'}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {step.content.primaryActionLabel ?? 'Continue'}
            {busy ? null : <ArrowRight />}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
};
