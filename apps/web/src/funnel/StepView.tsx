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
};

const asArray = (value: AnswerValue | undefined): string[] => (Array.isArray(value) ? value : []);

export const StepView = ({ step, value, error, busy, canGoBack, onChange, onSubmit, onBack }: Props) => {
  const options = step.input?.options ?? [];
  const submitLabel = step.content.primaryActionLabel ?? 'Continue';

  return (
    <form
      className="card step"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <header className="step__head">
        {step.content.eyebrow ? <p className="badge badge--muted">{step.content.eyebrow}</p> : null}
        <h1 className="step__title">{step.content.title ?? step.id}</h1>
        {step.content.body ? <p className="step__subtitle">{step.content.body}</p> : null}
        {step.content.helperText ? <p className="step__helper">{step.content.helperText}</p> : null}
      </header>

      {step.type === 'single-select' ? (
        <div className="options">
          {options.map((option, index) => (
            <label key={index} className={`option ${value === option.value ? 'option--active' : ''}`}>
              <input
                type="radio"
                name={step.input?.name ?? step.id}
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

      {step.type === 'multi-select' ? (
        <div className="options">
          {options.map((option, index) => {
            const selected = asArray(value).includes(option.value);
            return (
              <label key={index} className={`option ${selected ? 'option--active' : ''}`}>
                <input
                  type="checkbox"
                  name={step.input?.name ?? step.id}
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
            min={step.input?.min}
            max={step.input?.max}
            step={step.input?.step ?? 'any'}
            placeholder={step.input?.placeholder ?? ''}
            value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
            onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
          />
          {step.input?.unit ? <span className="number-field__unit">{step.input.unit}</span> : null}
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <footer className="step__foot">
        <button type="button" className="button button--ghost" onClick={onBack} disabled={!canGoBack || busy}>
          {step.content.backActionLabel ?? 'Back'}
        </button>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </footer>
    </form>
  );
};
