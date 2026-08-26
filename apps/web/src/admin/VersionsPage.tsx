import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, History, Loader2, Rocket, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { VersionsResponse } from '@funnel/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { request } from '@/lib/api';

const ACTION_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  publish: 'default',
  activate: 'secondary',
  rollback: 'destructive',
};

export const VersionsPage = () => {
  const [data, setData] = useState<VersionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState('');
  const [notes, setNotes] = useState('');
  const [inlineConfig, setInlineConfig] = useState('');
  const [activateNow, setActivateNow] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await request<VersionsResponse>('/api/admin/versions', { admin: true });
      setData(next);
      setFile((current) => current || (next.bundled_configs[0]?.file ?? ''));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить версии');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { notes: notes || null, activate: activateNow };
      if (inlineConfig.trim()) body.config = JSON.parse(inlineConfig);
      else body.file = file;

      const result = await request<{ version: number }>('/api/admin/versions', { body, admin: true });
      toast.success(`Опубликована версия ${result.version}`, {
        description: activateNow ? 'Новые сессии стартуют на ней прямо сейчас' : 'Версия сохранена, но не активирована',
      });
      setInlineConfig('');
      setNotes('');
      await load();
    } catch (publishError) {
      toast.error('Не удалось опубликовать версию', {
        description: publishError instanceof Error ? publishError.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const activate = async (version: number, isRollback: boolean) => {
    setBusy(true);
    try {
      await request(`/api/admin/versions/${version}/activate`, {
        body: { note: isRollback ? 'Откат из админки' : 'Переключение из админки' },
        admin: true,
      });
      toast.success(isRollback ? `Откат на версию ${version}` : `Активная версия — ${version}`);
      await load();
    } catch (activateError) {
      toast.error('Не удалось переключить версию', {
        description: activateError instanceof Error ? activateError.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!data) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardDescription>Активная версия</CardDescription>
            <CardTitle className="text-5xl tabular-nums">{data.active_version ?? '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Новые сессии стартуют только на активной версии. Уже начатые остаются на своей&nbsp;— версия
              закрепляется в момент создания сессии.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="size-4" aria-hidden />
              Опубликовать версию
            </CardTitle>
            <CardDescription>Файл из репозитория или JSON целиком. Передеплой не нужен.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="config-file">Конфиг из репозитория</Label>
                <Select value={file} onValueChange={setFile} disabled={inlineConfig.trim().length > 0}>
                  <SelectTrigger id="config-file">
                    <SelectValue placeholder="выберите файл" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.bundled_configs.map((config, index) => (
                      <SelectItem key={index} value={config.file}>
                        {config.file} — {config.steps} экранов
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="notes">Комментарий</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="например: вторая итерация"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="inline-config">…или вставьте JSON-конфиг целиком</Label>
              <Textarea
                id="inline-config"
                rows={5}
                className="font-mono text-xs"
                value={inlineConfig}
                onChange={(event) => setInlineConfig(event.target.value)}
                placeholder='{"schemaVersion": "1.0", "funnelId": "…"}'
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <Label className="text-muted-foreground font-normal">
                <Checkbox checked={activateNow} onCheckedChange={(next) => setActivateNow(next === true)} />
                Сразу сделать активной
              </Label>
              <Button onClick={() => void publish()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Rocket />}
                Опубликовать
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Версии</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Версия</TableHead>
                  <TableHead>Воронка</TableHead>
                  <TableHead className="text-right">Экранов</TableHead>
                  <TableHead className="text-right">Результатов</TableHead>
                  <TableHead>Варианты</TableHead>
                  <TableHead className="text-right">Сессий</TableHead>
                  <TableHead>Checksum</TableHead>
                  <TableHead>Создана</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.versions.map((version, index) => (
                  <TableRow key={index} className={version.is_active ? 'bg-accent/50' : undefined}>
                    <TableCell className="font-medium tabular-nums">
                      <span className="flex items-center gap-2">
                        {version.version}
                        {version.is_active ? (
                          <Badge variant="secondary">
                            <CheckCircle2 className="size-3" aria-hidden />
                            активна
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>{version.title}</div>
                      <div className="text-muted-foreground font-mono text-xs">{version.funnel_id}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{version.steps}</TableCell>
                    <TableCell className="text-right tabular-nums">{version.results}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {version.variants.map((variant, variantIndex) => (
                        <div key={variantIndex}>
                          {variant.key}: {variant.steps} экранов, вес {variant.weight}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{version.sessions}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {version.checksum}
                      <div>schema {version.schema_version}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(version.created_at).toLocaleString('ru-RU')}
                    </TableCell>
                    <TableCell className="text-right">
                      {version.is_active ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void activate(
                              version.version,
                              data.active_version !== null && version.version < data.active_version,
                            )
                          }
                        >
                          {data.active_version !== null && version.version < data.active_version ? (
                            <>
                              <Undo2 />
                              Откатить
                            </>
                          ) : (
                            'Активировать'
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" aria-hidden />
            История переключений
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {data.activations.map((entry, index) => (
              <li key={index} className="flex flex-wrap items-center gap-3 border-b pb-3 text-sm last:border-0 last:pb-0">
                <span className="text-muted-foreground font-mono text-xs">
                  {new Date(entry.created_at).toLocaleString('ru-RU')}
                </span>
                <Badge variant={ACTION_VARIANT[entry.action] ?? 'outline'}>{entry.action}</Badge>
                <span>версия {entry.version}</span>
                <span className="text-muted-foreground">{entry.actor}</span>
                {entry.note ? <span className="text-muted-foreground">— {entry.note}</span> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};
