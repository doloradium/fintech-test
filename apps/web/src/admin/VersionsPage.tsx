import { useCallback, useEffect, useState } from 'react';
import type { VersionsResponse } from '@funnel/shared';
import { request } from '../lib/api';

export const VersionsPage = () => {
  const [data, setData] = useState<VersionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState('');
  const [notes, setNotes] = useState('');
  const [inlineConfig, setInlineConfig] = useState('');
  const [activateNow, setActivateNow] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await request<VersionsResponse>('/api/admin/versions', { admin: true });
      setData(next);
      if (!file && next.bundled_configs[0]) setFile(next.bundled_configs[0].file);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить версии');
    }
  }, [file]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const body: Record<string, unknown> = { notes: notes || null, activate: activateNow };
      if (inlineConfig.trim()) body.config = JSON.parse(inlineConfig);
      else body.file = file;

      const result = await request<{ version: number }>('/api/admin/versions', { body, admin: true });
      setNotice(`Опубликована версия ${result.version}${activateNow ? ' и назначена активной' : ''}`);
      setInlineConfig('');
      setNotes('');
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Не удалось опубликовать версию');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (version: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await request(`/api/admin/versions/${version}/activate`, { body: { note: 'Переключение из админки' }, admin: true });
      setNotice(`Активная версия — ${version}`);
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : 'Не удалось переключить версию');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Загружаем версии…</p>;

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card__title">Активная версия</h2>
        <p className="metric metric--lead">{data.active_version ?? '—'}</p>
        <p className="muted">
          Новые сессии стартуют только на активной версии. Уже начатые сессии остаются на своей&nbsp;— версия
          закрепляется в момент создания сессии.
        </p>
      </section>

      <section className="card">
        <h2 className="card__title">Опубликовать версию</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Конфиг из репозитория</span>
            <select className="input" value={file} onChange={(event) => setFile(event.target.value)}>
              {data.bundled_configs.map((config, index) => (
                <option key={index} value={config.file}>
                  {config.file} — {config.name} ({config.steps} экранов)
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Комментарий к публикации</span>
            <input
              className="input"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Например: вторая итерация, добавлена ветка дизайна"
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">…или вставьте JSON-конфиг целиком</span>
          <textarea
            className="input input--area"
            rows={6}
            value={inlineConfig}
            onChange={(event) => setInlineConfig(event.target.value)}
            placeholder='{"schemaVersion": 1, "funnelId": "…"}'
          />
        </label>

        <label className="checkbox">
          <input type="checkbox" checked={activateNow} onChange={(event) => setActivateNow(event.target.checked)} />
          <span>Сразу сделать активной</span>
        </label>

        <button type="button" className="button" onClick={() => void publish()} disabled={busy}>
          {busy ? 'Публикуем…' : 'Опубликовать'}
        </button>

        {notice ? <p className="notice">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="card">
        <h2 className="card__title">Версии</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Версия</th>
                <th>Название</th>
                <th>Экранов</th>
                <th>Варианты</th>
                <th>Сессий</th>
                <th>Checksum</th>
                <th>Создана</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.versions.map((version, index) => (
                <tr key={index} className={version.is_active ? 'row--active' : ''}>
                  <td>
                    {version.version}
                    {version.is_active ? <span className="badge badge--success">активна</span> : null}
                  </td>
                  <td>{version.name}</td>
                  <td>{version.steps}</td>
                  <td>
                    {version.variants.map((variant, variantIndex) => (
                      <div key={variantIndex} className="muted">
                        {variant.key}: {variant.steps} экранов
                      </div>
                    ))}
                  </td>
                  <td>{version.sessions}</td>
                  <td className="mono">{version.checksum}</td>
                  <td className="muted">{new Date(version.created_at).toLocaleString('ru-RU')}</td>
                  <td>
                    {version.is_active ? null : (
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => void activate(version.version)}
                        disabled={busy}
                      >
                        {data.active_version !== null && version.version < data.active_version
                          ? 'Откатить сюда'
                          : 'Активировать'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">История переключений</h2>
        <ul className="log">
          {data.activations.map((entry, index) => (
            <li key={index}>
              <span className="mono">{new Date(entry.created_at).toLocaleString('ru-RU')}</span>
              <span className={`badge ${entry.action === 'rollback' ? 'badge--warn' : ''}`}>{entry.action}</span>
              <span>версия {entry.version}</span>
              <span className="muted">{entry.actor}</span>
              {entry.note ? <span className="muted">— {entry.note}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
