import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  RESULT_STEP_ID,
  UTM_KEYS,
  validateAnswer,
  type AnswerValue,
  type SessionView,
} from '@funnel/shared';
import { ApiError, request } from '../lib/api';
import { flush, flushOnUnload, initTracker, track } from '../lib/tracker';
import { ResultView as ResultBlock } from './ResultView';
import { StepView as StepBlock } from './StepView';

const SESSION_KEY = 'funnel.session_id';

const readSessionId = (): string | null => {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};

const writeSessionId = (id: string | null): void => {
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage is unavailable: the session will not survive a reload */
  }
};

const utmFromSearch = (search: string): Record<string, string | null> => {
  const params = new URLSearchParams(search);
  const utm: Record<string, string | null> = {};
  for (const key of UTM_KEYS) utm[key] = params.get(key);
  return utm;
};

export const FunnelPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [view, setView] = useState<SessionView | null>(null);
  const [draft, setDraft] = useState<AnswerValue | undefined>(undefined);
  const [stepError, setStepError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ctaClicked, setCtaClicked] = useState(false);

  const bootstrapped = useRef(false);
  const lastViewedRef = useRef<string>('');
  const navLock = useRef(false);

  const startSession = useCallback(async (): Promise<SessionView> => {
    const params = new URLSearchParams(window.location.search);
    const variantParam = params.get('variant');
    const variant = variantParam === 'A' || variantParam === 'B' ? variantParam : null;

    const created = await request<SessionView>('/api/sessions', {
      body: { variant, utm: utmFromSearch(window.location.search) },
    });

    writeSessionId(created.session_id);
    initTracker(created.session_id);
    track('session_started', null, {
      variant_source: created.variant_source,
      funnel_version: created.funnel_version,
    });
    return created;
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      try {
        const stored = readSessionId();
        if (stored) {
          try {
            const restored = await request<SessionView>(`/api/sessions/${stored}`);
            initTracker(restored.session_id);
            setView(restored);
            return;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
            writeSessionId(null);
          }
        }
        setView(await startSession());
      } catch (error) {
        setFatal(error instanceof Error ? error.message : 'Не удалось загрузить воронку');
      }
    })();
  }, [startSession]);

  useEffect(() => {
    const onHide = () => flushOnUnload();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  useEffect(() => {
    if (!view || navLock.current) return;

    const urlStep = new URLSearchParams(location.search).get('step');
    const current = view.current_step_id;

    if (urlStep === current) return;

    const params = new URLSearchParams(location.search);
    params.set('step', current);

    if (!urlStep || (urlStep !== RESULT_STEP_ID && !view.path.includes(urlStep))) {
      navigate({ search: `?${params.toString()}` }, { replace: true });
      return;
    }

    const target = urlStep;
    const from = view.path.indexOf(current);
    const to = view.path.indexOf(target);

    navLock.current = true;
    void (async () => {
      try {
        if (to < from || current === RESULT_STEP_ID) track('back_clicked', current, { to_step_id: target });
        const updated = await request<SessionView>(`/api/sessions/${view.session_id}/navigate`, {
          body: { step_id: target },
        });
        setDraft(updated.answers[target]);
        setStepError(null);
        setView(updated);
      } catch {
        navigate({ search: `?${params.toString()}` }, { replace: true });
      } finally {
        navLock.current = false;
      }
    })();
  }, [location.search, view, navigate]);

  useEffect(() => {
    if (!view) return;
    const stepId = view.current_step_id;
    if (lastViewedRef.current === stepId) return;
    lastViewedRef.current = stepId;

    if (stepId === RESULT_STEP_ID) {
      track('result_viewed', RESULT_STEP_ID, { funnel_version: view.funnel_version });
      void flush();
      return;
    }

    track('step_viewed', stepId, { position: view.progress.index + 1, path_length: view.progress.total });
  }, [view]);

  useEffect(() => {
    if (!view) return;
    setDraft(view.answers[view.current_step_id]);
  }, [view]);

  const goToStep = useCallback(
    (stepId: string) => {
      const params = new URLSearchParams(window.location.search);
      params.set('step', stepId);
      navigate({ search: `?${params.toString()}` });
    },
    [navigate],
  );

  const handleSubmit = useCallback(async () => {
    if (!view || busy) return;
    const stepId = view.current_step_id;
    const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
    if (!step) return;

    const localError = validateAnswer(step, draft);
    if (localError) {
      setStepError(localError);
      track('answer_submitted', stepId, { is_valid: false });
      return;
    }

    setBusy(true);
    setStepError(null);
    navLock.current = true;

    try {
      track('answer_submitted', stepId, {
        is_valid: true,
        value_type: Array.isArray(draft) ? 'array' : typeof draft,
        option_count: Array.isArray(draft) ? draft.length : 1,
      });

      const updated = await request<SessionView>(`/api/sessions/${view.session_id}/answer`, {
        body: { step_id: stepId, value: draft ?? null },
      });

      track('step_completed', stepId);

      const params = new URLSearchParams(window.location.search);
      params.set('step', updated.current_step_id);
      setView(updated);
      navigate({ search: `?${params.toString()}` });
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'Не удалось сохранить ответ');
    } finally {
      navLock.current = false;
      setBusy(false);
    }
  }, [busy, draft, navigate, view]);

  const handleRestart = useCallback(async () => {
    writeSessionId(null);
    setCtaClicked(false);
    lastViewedRef.current = '';
    try {
      const created = await startSession();
      const params = new URLSearchParams(window.location.search);
      params.set('step', created.current_step_id);
      setView(created);
      navigate({ search: `?${params.toString()}` });
    } catch (error) {
      setFatal(error instanceof Error ? error.message : 'Не удалось начать новую сессию');
    }
  }, [navigate, startSession]);

  if (fatal) {
    return (
      <section className="card">
        <h1 className="step__title">Воронка недоступна</h1>
        <p className="step__subtitle">{fatal}</p>
        <p className="step__subtitle">
          Убедитесь, что активная версия опубликована на странице{' '}
          <a href="/admin/versions">управления версиями</a>.
        </p>
      </section>
    );
  }

  if (!view) return <section className="card">Загружаем воронку…</section>;

  const isResult = view.current_step_id === RESULT_STEP_ID;
  const step = view.funnel.steps.find((candidate) => candidate.id === view.current_step_id);
  const percent = Math.round((isResult ? 1 : view.progress.ratio) * 100);
  const canGoBack = isResult || view.progress.index > 0;

  return (
    <div className="funnel">
      <div className="funnel__meta">
        <span className="badge">Версия {view.funnel_version}</span>
        <span className="badge">Вариант {view.variant}</span>
        <span className="badge badge--muted">{view.funnel.variantLabel}</span>
      </div>

      <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__bar" style={{ width: `${percent}%` }} />
      </div>
      <p className="progress__label">
        {isResult ? 'Результат' : `Шаг ${view.progress.index + 1} из ${view.progress.total}`}
      </p>

      {isResult ? (
        <ResultBlock
          view={view}
          ctaClicked={ctaClicked}
          onCta={() => {
            setCtaClicked(true);
            track('cta_clicked', RESULT_STEP_ID, { cta_id: view.funnel.result.cta.id });
            void flush();
          }}
          onRestart={() => void handleRestart()}
          onBack={() => {
            const previous = view.path[view.path.length - 1];
            if (previous) goToStep(previous);
          }}
        />
      ) : step ? (
        <StepBlock
          step={step}
          value={draft}
          error={stepError}
          busy={busy}
          canGoBack={canGoBack}
          onChange={(value) => {
            setDraft(value);
            setStepError(null);
          }}
          onSubmit={() => void handleSubmit()}
          onBack={() => {
            const index = view.path.indexOf(view.current_step_id);
            const previous = view.path[Math.max(index - 1, 0)];
            if (previous && previous !== view.current_step_id) goToStep(previous);
          }}
          onHint={() => {
            if (view.funnel.extraEvents.includes('hint_opened')) track('hint_opened', view.current_step_id);
          }}
        />
      ) : null}
    </div>
  );
};

