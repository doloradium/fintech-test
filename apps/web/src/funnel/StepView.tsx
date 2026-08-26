import type { AnswerValue, Step } from '@funnel/shared';

type Props = {
  step: Step;
  value: AnswerValue | undefined;
  error: string | null;
  busy: boolean;
  canGoBack: boolean;
  onChange: (value: AnswerValue) => void;
  onSubmit: () => void;
  onBack: () => void;
  onHint: () => void;
};

const asArray = (value: AnswerValue | undefined): string[] => (Array.isArray(value) ? value : []);

export const StepView = ({ step, value, error, busy, canGoBack, onChange, onSubmit, onBack, onHint }: Props) => {
  const submitLabel = step.type === 'info' ? (step.ctaLabel ?? 'Далее') : 'Далее';

  return (
    <form
      className="card step"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <header className="step__head">
        <h1 className="step__title">{step.title}</h1>
        {step.subtitle ? <p className="step__subtitle">{step.subtitle}</p> : null}
      </header>

      {step.type === 'info' ? (
        <ul className="info-list">
          {step.body.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}

      {step.type === 'single_select' ? (
        <div className="options">
          {step.options.map((option, index) => (
            <label key={index} className={`option ${value === option.value ? 'option--active' : ''}`}>
              <input
                type="radio"
                name={step.id}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span className="option__body">
                <span className="option__label">{option.label}</span>
                {option.description ? <span className="option__hint">{option.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      {step.type === 'multi_select' ? (
        <div className="options">
          {step.options.map((option, index) => {
            const selected = asArray(value).includes(option.value);
            return (
              <label key={index} className={`option ${selected ? 'option--active' : ''}`}>
                <input
                  type="checkbox"
                  name={step.id}
                  checked={selected}
                  onChange={() => {
                    const current = asArray(value);
                    onChange(selected ? current.filter((item) => item !== option.value) : [...current, option.value]);
                  }}
                />
                <span className="option__body">
                  <span className="option__label">{option.label}</span>
                  {option.description ? <span className="option__hint">{option.description}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}

      {step.type === 'number' ? (
        <div className="number-field">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={step.min}
            max={step.max}
            step={step.integer ? 1 : 'any'}
            placeholder={step.placeholder ?? ''}
            value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
            onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
          />
          {step.unit ? <span className="number-field__unit">{step.unit}</span> : null}
        </div>
      ) : null}

      {step.hint ? (
        <details
          className="hint"
          onToggle={(event) => {
            if ((event.currentTarget as HTMLDetailsElement).open) onHint();
          }}
        >
          <summary>Подсказка</summary>
          <p>{step.hint}</p>
        </details>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <footer className="step__foot">
        <button type="button" className="button button--ghost" onClick={onBack} disabled={!canGoBack || busy}>
          Назад
        </button>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Сохраняем…' : submitLabel}
        </button>
      </footer>
    </form>
  );
};
