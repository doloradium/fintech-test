import type { SessionView } from '@funnel/shared';

type Props = {
  view: SessionView;
  ctaClicked: boolean;
  onCta: () => void;
  onRestart: () => void;
  onBack: () => void;
};

export const ResultView = ({ view, ctaClicked, onCta, onRestart, onBack }: Props) => {
  const { result } = view.funnel;

  return (
    <section className="card step">
      <header className="step__head">
        <p className="badge badge--success">Готово</p>
        <h1 className="step__title">{result.title}</h1>
        {result.subtitle ? <p className="step__subtitle">{result.subtitle}</p> : null}
      </header>

      <ul className="info-list">
        {result.body.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>

      <dl className="summary">
        {Object.entries(view.answers).map(([stepId, value], index) => {
          const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
          if (!step || step.type === 'info') return null;
          const labelFor = (raw: string): string =>
            step.type === 'single_select' || step.type === 'multi_select'
              ? (step.options.find((option) => option.value === raw)?.label ?? raw)
              : raw;
          const rendered = Array.isArray(value)
            ? value.map(labelFor).join(', ')
            : labelFor(String(value ?? '—'));

          return (
            <div className="summary__row" key={index}>
              <dt>{step.title}</dt>
              <dd>{rendered}</dd>
            </div>
          );
        })}
      </dl>

      {result.secondaryNote ? <p className="step__subtitle">{result.secondaryNote}</p> : null}

      <footer className="step__foot">
        <button type="button" className="button button--ghost" onClick={onBack}>
          Назад
        </button>
        <button type="button" className="button" onClick={onCta} disabled={ctaClicked}>
          {ctaClicked ? 'Заявка отправлена' : result.cta.label}
        </button>
      </footer>

      <button type="button" className="link" onClick={onRestart}>
        Пройти воронку заново
      </button>
    </section>
  );
};
