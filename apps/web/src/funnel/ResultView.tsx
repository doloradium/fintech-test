import type { SessionView } from '@funnel/shared';

type Props = {
  view: SessionView;
  ctaClicked: boolean;
  onCta: () => void;
  onRestart: () => void;
  onBack: () => void;
};

export const ResultView = ({ view, ctaClicked, onCta, onRestart, onBack }: Props) => {
  const result = view.result_id ? view.funnel.results[view.result_id] : undefined;

  if (!result) {
    const step = view.funnel.steps.find((candidate) => candidate.id === view.current_step_id);
    return (
      <section className="card step">
        <h1 className="step__title">{step?.content.errorTitle ?? 'We could not build the recommendation'}</h1>
        <button type="button" className="button" onClick={onRestart}>
          {step?.content.retryLabel ?? 'Try again'}
        </button>
      </section>
    );
  }

  return (
    <section className="card step">
      <header className="step__head">
        <p className="badge badge--success">Your recommendation</p>
        <h1 className="step__title">{result.title}</h1>
        {result.summary ? <p className="step__subtitle">{result.summary}</p> : null}
      </header>

      <ul className="info-list">
        {result.recommendations.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>

      <dl className="summary">
        {Object.entries(view.answers).map(([stepId, value], index) => {
          const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
          if (!step || step.type === 'info' || step.type === 'result') return null;

          const options = step.input?.options ?? [];
          const labelFor = (raw: string): string =>
            options.find((option) => option.value === raw)?.label ?? raw;
          const rendered = Array.isArray(value)
            ? value.map(labelFor).join(', ')
            : `${labelFor(String(value ?? '—'))}${step.input?.unit ? ` ${step.input.unit}` : ''}`;

          return (
            <div className="summary__row" key={index}>
              <dt>{step.content.title ?? stepId}</dt>
              <dd>{rendered}</dd>
            </div>
          );
        })}
      </dl>

      <footer className="step__foot">
        <button type="button" className="button button--ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="button" onClick={onCta} disabled={ctaClicked}>
          {ctaClicked ? 'Opened' : result.cta.label}
        </button>
      </footer>

      <button type="button" className="link" onClick={onRestart}>
        Start again
      </button>
    </section>
  );
};
