import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { UTM_KEYS, validateAnswer, type AnswerValue, type SessionView } from '@funnel/shared';
import { ApiError, request } from '@/lib/api';
import { flush, flushOnUnload, initTracker, track } from '@/lib/tracker';
import { ResultView } from './ResultView';
import { StepView } from './StepView';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

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
  } catch {}
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
  const pendingViewRef = useRef<SessionView | null>(null);

  const startSession = useCallback(async (): Promise<SessionView> => {
    const params = new URLSearchParams(window.location.search);
    const variantParam = params.get('variant');

    const created = await request<SessionView>('/api/sessions', {
      body: { variant: variantParam, utm: utmFromSearch(window.location.search) },
    });

    writeSessionId(created.session_id);
    initTracker(created.session_id);
    track('session_started');
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
            const status = error instanceof ApiError ? error.status : 0;
            if (status !== 404 && status !== 410) throw error;
            writeSessionId(null);
          }
        }
        setView(await startSession());
      } catch (error) {
        setFatal(error instanceof Error ? error.message : 'The funnel could not be loaded');
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

    const pending = pendingViewRef.current;
    if (pending && urlStep === pending.current_step_id) {
      pendingViewRef.current = null;
      setStepError(null);
      setView(pending);
      return;
    }

    const current = view.current_step_id;
    if (urlStep === current) return;

    const params = new URLSearchParams(location.search);
    params.set('step', current);

    if (!urlStep || !view.path.includes(urlStep)) {
      navigate({ search: `?${params.toString()}` }, { replace: true });
      return;
    }

    const target = urlStep;
    const from = view.path.indexOf(current);
    const to = view.path.indexOf(target);

    navLock.current = true;
    void (async () => {
      try {
        if (to < from) track('back_clicked', current, { destination_step_id: target });
        const updated = await request<SessionView>(`/api/sessions/${view.session_id}/navigate`, {
          body: { step_id: target },
        });
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

    const step = view.funnel.steps.find((candidate) => candidate.id === stepId);
    if (!step) return;

    if (step.type === 'result') {
      track('result_viewed', stepId, { result_id: view.result_id });
      void flush();
      return;
    }

    track('step_viewed', stepId, {
      step_type: step.type,
      visible_step_index: view.progress.index + 1,
      visible_step_count: view.progress.total,
    });
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
      return;
    }

    setBusy(true);
    setStepError(null);
    navLock.current = true;

    try {
      track('answer_submitted', stepId, { answer_kind: step.type });

      const updated = await request<SessionView>(`/api/sessions/${view.session_id}/answer`, {
        body: { step_id: stepId, value: draft ?? null },
      });

      track('step_completed', stepId, { next_step_id: updated.current_step_id });

      const params = new URLSearchParams(window.location.search);
      params.set('step', updated.current_step_id);
      pendingViewRef.current = updated;
      navigate({ search: `?${params.toString()}` });
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'The answer could not be saved');
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
      pendingViewRef.current = created;
      navigate({ search: `?${params.toString()}` });
    } catch (error) {
      setFatal(error instanceof Error ? error.message : 'A new session could not be started');
    }
  }, [navigate, startSession]);

  if (fatal) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Воронка недоступна</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{fatal}</span>
            <span>
              Проверьте, что активная версия опубликована на странице{' '}
              <Link to="/admin/versions" className="underline underline-offset-4">
                управления версиями
              </Link>
              .
            </span>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const step = view.funnel.steps.find((candidate) => candidate.id === view.current_step_id);
  const isResult = step?.type === 'result';
  const percent = Math.round((isResult ? 1 : view.progress.ratio) * 100);
  const currentIndex = view.path.indexOf(view.current_step_id);
  const canGoBack = currentIndex > 0;

  const goBack = () => {
    const previous = view.path[Math.max(currentIndex - 1, 0)];
    if (previous && previous !== view.current_step_id) goToStep(previous);
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Версия {view.funnel_version}</Badge>
        <Badge variant="outline">Вариант {view.variant}</Badge>
        <Badge variant="secondary" className="font-mono text-[11px] font-normal">
          {view.funnel.experimentId}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <Progress value={percent} className="h-1.5" />
        <p className="text-muted-foreground text-xs">
          {isResult
            ? 'Результат'
            : view.progress.counted
              ? `Шаг ${view.progress.index + 1} из ${view.progress.total}`
              : 'Введение'}
        </p>
      </div>

      {isResult ? (
        <ResultView
          view={view}
          ctaClicked={ctaClicked}
          onCta={() => {
            setCtaClicked(true);
            const result = view.result_id ? view.funnel.results[view.result_id] : undefined;
            track('cta_clicked', view.current_step_id, {
              result_id: view.result_id,
              action: result?.cta.action ?? 'primary',
            });
            void flush();
          }}
          onRestart={() => void handleRestart()}
          onBack={goBack}
        />
      ) : step ? (
        <StepView
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
          onBack={goBack}
        />
      ) : null}
    </div>
  );
};
