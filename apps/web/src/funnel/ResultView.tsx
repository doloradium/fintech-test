import { ArrowLeft, Check, RotateCcw, Sparkles } from 'lucide-react';
import type { SessionView } from '@funnel/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

type Props = {
  view: SessionView;
  ctaClicked: boolean;
  onCta: () => void;
  onRestart: () => void;
  onBack: () => void;
};

export const ResultView = ({ view, ctaClicked, onCta, onRestart, onBack }: Props) => {
  const step = view.funnel.steps.find((candidate) => candidate.id === view.current_step_id);
  const result = view.result_id ? view.funnel.results[view.result_id] : undefined;

  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{step?.content.errorTitle ?? 'We could not build the recommendation'}</CardTitle>
        </CardHeader>
        <CardFooter>
          <Button onClick={onRestart}>{step?.content.retryLabel ?? 'Try again'}</Button>
        </CardFooter>
      </Card>
    );
  }

  const answered = Object.entries(view.answers).filter(([stepId]) => {
    const answeredStep = view.funnel.steps.find((candidate) => candidate.id === stepId);
    return answeredStep && answeredStep.type !== 'info' && answeredStep.type !== 'result';
  });

  return (
    <Card>
      <CardHeader>
        <Badge className="mb-1 w-fit" variant="secondary">
          <Sparkles className="size-3" aria-hidden />
          {view.result_id}
        </Badge>
        <CardTitle className="text-2xl leading-tight tracking-tight text-balance">{result.title}</CardTitle>
        {result.summary ? <CardDescription className="text-base">{result.summary}</CardDescription> : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <ul className="flex flex-col gap-3">
          {result.recommendations.map((line, index) => (
            <li key={index} className="flex gap-3 text-sm">
              <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {answered.length > 0 ? (
          <>
            <Separator />
            <dl className="flex flex-col gap-2 text-sm">
              {answered.map(([stepId, value], index) => {
                const answeredStep = view.funnel.steps.find((candidate) => candidate.id === stepId);
                const options = answeredStep?.input?.options ?? [];
                const labelFor = (raw: string): string =>
                  options.find((option) => option.value === raw)?.label ?? raw;
                const rendered = Array.isArray(value)
                  ? value.map(labelFor).join(', ')
                  : `${labelFor(String(value ?? '—'))}${answeredStep?.input?.unit ? ` ${answeredStep.input.unit}` : ''}`;

                return (
                  <div key={index} className="flex items-baseline justify-between gap-6">
                    <dt className="text-muted-foreground">{answeredStep?.content.title ?? stepId}</dt>
                    <dd className="text-right font-medium">{rendered}</dd>
                  </div>
                );
              })}
            </dl>
          </>
        ) : null}
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        <div className="flex justify-between gap-3">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft />
            Back
          </Button>
          <Button onClick={onCta} disabled={ctaClicked}>
            {ctaClicked ? <Check /> : null}
            {ctaClicked ? 'Opened' : result.cta.label}
          </Button>
        </div>
        <Button variant="link" size="sm" className="text-muted-foreground self-start" onClick={onRestart}>
          <RotateCcw />
          Start again
        </Button>
      </CardFooter>
    </Card>
  );
};
