import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsResponse, SegmentMetrics } from '@funnel/shared';
import { request } from '../lib/api';

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const uplift = (segments: SegmentMetrics[], metric: 'ctaCtr' | 'completionRate'): string => {
  const control = segments.find((segment) => segment.key === 'A');
  const test = segments.find((segment) => segment.key === 'B');
  if (!control || !test || control[metric] === 0) return '—';
  const delta = (test[metric] - control[metric]) / control[metric];
  return `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
};

const SegmentTable = ({ title, rows, note }: { title: string; rows: SegmentMetrics[]; note?: string }) => (
  <section className="card">
    <h2 className="card__title">{title}</h2>
    {note ? <p className="muted">{note}</p> : null}
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Сегмент</th>
            <th>Сессий</th>
            <th>Дошли до результата</th>
            <th>Конверсия в результат</th>
            <th>Кликов по CTA</th>
            <th>CTR CTA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{row.label}</td>
              <td>{row.sessions}</td>
              <td>{row.reachedResult}</td>
              <td>{percent(row.completionRate)}</td>
              <td>{row.ctaClicks}</td>
              <td className="strong">{percent(row.ctaCtr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

export const AnalyticsPage = () => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [variant, setVariant] = useState('');
  const [campaign, setCampaign] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (version) params.set('version', version);
    if (variant) params.set('variant', variant);
    if (campaign) params.set('utm_campaign', campaign);

    try {
      const next = await request<AnalyticsResponse>(`/api/admin/analytics?${params.toString()}`, { admin: true });
      setData(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить аналитику');
    }
  }, [campaign, variant, version]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Считаем метрики…</p>;

  const maxEntered = data.steps.reduce((max, step) => Math.max(max, step.entered), 0);

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card__title">Фильтры</h2>
        <div className="form-grid form-grid--three">
          <label className="field">
            <span className="field__label">Версия воронки</span>
            <select className="input" value={version} onChange={(event) => setVersion(event.target.value)}>
              <option value="">Все версии</option>
              {data.available.versions.map((item, index) => (
                <option key={index} value={String(item)}>
                  Версия {item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Вариант эксперимента</span>
            <select className="input" value={variant} onChange={(event) => setVariant(event.target.value)}>
              <option value="">A и B</option>
              {data.available.variants.map((item, index) => (
                <option key={index} value={item}>
                  Вариант {item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">UTM campaign</span>
            <select className="input" value={campaign} onChange={(event) => setCampaign(event.target.value)}>
              <option value="">Все кампании</option>
              {data.available.campaigns.map((item, index) => (
                <option key={index} value={item}>
                  {item === '' ? 'Без кампании' : item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          Все показатели считаются по уникальным сессиям: повторные просмотры, возвраты назад и дубли событий
          не увеличивают числа.
        </p>
      </section>

      <section className="kpis">
        <div className="card kpi">
          <span className="kpi__label">Начали воронку</span>
          <span className="metric">{data.overview.sessions}</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Дошли до результата</span>
          <span className="metric">{data.overview.reachedResult}</span>
          <span className="muted">{percent(data.overview.completionRate)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Кликнули CTA</span>
          <span className="metric">{data.overview.ctaClicks}</span>
          <span className="muted">{percent(data.overview.ctaCtr)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi__label">Uplift B к A по CTR</span>
          <span className="metric">{uplift(data.byVariant, 'ctaCtr')}</span>
          <span className="muted">основная метрика эксперимента</span>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Воронка по шагам</h2>
        <p className="muted">
          «Дошли дальше»&nbsp;— сессии, которые после этого шага увидели любой следующий экран своего варианта
          или результат. Отвал&nbsp;= вошли − дошли дальше.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Шаг</th>
                <th>Вошли</th>
                <th>Ответили</th>
                <th>Дошли дальше</th>
                <th>Отвал</th>
                <th>Конверсия дальше</th>
                <th>Возвраты назад</th>
                <th>Доля от старта</th>
              </tr>
            </thead>
            <tbody>
              {data.steps.map((step, index) => (
                <tr key={index}>
                  <td>
                    <div className="strong">{step.title ?? step.stepId}</div>
                    <div className="mono muted">{step.stepId}</div>
                  </td>
                  <td>
                    <div className="bar">
                      <div
                        className="bar__fill"
                        style={{ width: maxEntered === 0 ? '0%' : `${(step.entered / maxEntered) * 100}%` }}
                      />
                      <span>{step.entered}</span>
                    </div>
                  </td>
                  <td>{step.completed}</td>
                  <td>{step.continued}</td>
                  <td className={step.dropoff > 0 ? 'warn' : ''}>{step.dropoff}</td>
                  <td className="strong">{percent(step.conversionToNext)}</td>
                  <td>{step.backClicks}</td>
                  <td className="muted">{percent(step.conversionFromStart)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SegmentTable
        title="A/B: сравнение вариантов"
        rows={data.byVariant}
        note={`Uplift B к A: CTR ${uplift(data.byVariant, 'ctaCtr')}, конверсия в результат ${uplift(data.byVariant, 'completionRate')}`}
      />
      <SegmentTable title="Сравнение версий воронки" rows={data.byVersion} />
      <SegmentTable title="Разрез по UTM campaign" rows={data.byCampaign} />

      <section className="card">
        <h2 className="card__title">События и качество данных</h2>
        <div className="form-grid form-grid--three">
          <div>
            <span className="kpi__label">Событий в выборке</span>
            <p className="metric">{data.dataQuality.events}</p>
          </div>
          <div>
            <span className="kpi__label">Отброшено дублей при приёме</span>
            <p className="metric">{data.dataQuality.duplicateAttempts}</p>
          </div>
          <div>
            <span className="kpi__label">Отклонено некорректных</span>
            <p className="metric">{data.dataQuality.rejectedEvents}</p>
          </div>
          <div>
            <span className="kpi__label">Пришли не по порядку</span>
            <p className="metric">{data.dataQuality.outOfOrderEvents}</p>
          </div>
          <div>
            <span className="kpi__label">Сессий с возвратом назад</span>
            <p className="metric">{data.dataQuality.sessionsWithBack}</p>
          </div>
        </div>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Тип события</th>
                <th>Событий</th>
                <th>Уникальных сессий</th>
              </tr>
            </thead>
            <tbody>
              {data.eventCounts.map((row, index) => (
                <tr key={index}>
                  <td className="mono">{row.type}</td>
                  <td>{row.events}</td>
                  <td>{row.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Данные на {new Date(data.generated_at).toLocaleString('ru-RU')}</p>
      </section>
    </div>
  );
};
