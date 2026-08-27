import { useCallback, useEffect, useState } from 'react';
import { Activity, Filter, Loader2, ShieldCheck, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { AnalyticsResponse, SegmentMetrics } from '@funnel/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { request } from '@/lib/api';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const NO_CAMPAIGN = '__none__';

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

type Uplift = { value: number; control: string; test: string };

const upliftOf = (segments: SegmentMetrics[], metric: 'ctaCtr' | 'completionRate'): Uplift | null => {
  if (segments.length !== 2) return null;
  const [control, test] = segments;
  if (!control || !test || control[metric] === 0) return null;
  return { value: (test[metric] - control[metric]) / control[metric], control: control.key, test: test.key };
};

const formatUplift = (uplift: Uplift | null): string =>
  uplift === null ? '—' : `${uplift.value >= 0 ? '+' : ''}${(uplift.value * 100).toFixed(1)}%`;

const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardHeader className="gap-1">
      <CardDescription>{label}</CardDescription>
      <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      {hint ? <CardDescription className="text-xs">{hint}</CardDescription> : null}
    </CardHeader>
  </Card>
);

const SegmentTable = ({ title, description, rows }: { title: string; description?: string; rows: SegmentMetrics[] }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
    <CardContent>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Сегмент</TableHead>
              <TableHead className="text-right">Сессий</TableHead>
              <TableHead className="text-right">До результата</TableHead>
              <TableHead className="text-right">Конверсия</TableHead>
              <TableHead className="text-right">Кликов CTA</TableHead>
              <TableHead className="text-right">CTR CTA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
                <TableCell className="text-right tabular-nums">{row.reachedResult}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(row.completionRate)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.ctaClicks}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{percent(row.ctaCtr)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
);

export const AnalyticsPage = () => {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(ALL);
  const [variant, setVariant] = useState(ALL);
  const [campaign, setCampaign] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (version !== ALL) params.set('version', version);
    if (variant !== ALL) params.set('variant', variant);
    if (campaign !== ALL) params.set('utm_campaign', campaign === NO_CAMPAIGN ? '' : campaign);
    if (from) params.set('from', `${from}T00:00:00.000Z`);
    if (to) params.set('to', `${to}T23:59:59.999Z`);

    try {
      const next = await request<AnalyticsResponse>(`/api/admin/analytics?${params.toString()}`, { admin: true });
      setData(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить аналитику');
    }
  }, [campaign, from, to, variant, version]);

  useEffect(() => {
    void load();
  }, [load]);


  const seed = async () => {
    setSeeding(true);
    try {
      const result = await request<{ elapsed_ms: number; stats: { sessions: number; accepted: number; rejected: number } }>(
        '/api/admin/seed',
        { body: { sessions: 100 }, admin: true },
      );
      toast.success(`Сгенерировано ${result.stats.sessions} сессий за ${(result.elapsed_ms / 1000).toFixed(1)} с`, {
        description: `Принято ${result.stats.accepted} событий, отклонено ${result.stats.rejected}.`,
      });
      await load();
    } catch (seedError) {
      toast.error('Не удалось сгенерировать трафик', {
        description: seedError instanceof Error ? seedError.message : undefined,
      });
    } finally {
      setSeeding(false);
    }
  };

  if (error && !data) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const maxEntered = data.steps.reduce((max, step) => Math.max(max, step.entered), 0);
  const ctrUplift = upliftOf(data.byVariant, 'ctaCtr');

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="size-4" aria-hidden />
                Фильтры
              </CardTitle>
              <CardDescription>
                Все показатели считаются по уникальным сессиям: повторные просмотры, возвраты назад и дубли событий
                не увеличивают числа.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void seed()} disabled={seeding}>
              {seeding ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {seeding ? 'Генерируем…' : 'Сгенерировать 100 тестовых сессий'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="f-version">Версия воронки</Label>
            <Select value={version} onValueChange={setVersion}>
              <SelectTrigger id="f-version">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все версии</SelectItem>
                {data.available.versions.map((item, index) => (
                  <SelectItem key={index} value={String(item)}>
                    Версия {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="f-variant">Вариант эксперимента</Label>
            <Select value={variant} onValueChange={setVariant}>
              <SelectTrigger id="f-variant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все варианты</SelectItem>
                {data.available.variants.map((item, index) => (
                  <SelectItem key={index} value={item}>
                    Вариант {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="f-campaign">UTM campaign</Label>
            <Select value={campaign} onValueChange={setCampaign}>
              <SelectTrigger id="f-campaign">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все кампании</SelectItem>
                {data.available.campaigns.map((item, index) => (
                  <SelectItem key={index} value={item === '' ? NO_CAMPAIGN : item}>
                    {item === '' ? 'Без кампании' : item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
                  <div className="flex flex-col gap-2">
            <Label htmlFor="f-from">С даты</Label>
            <Input id="f-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="f-to">По дату</Label>
            <Input id="f-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>

</CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Начали воронку" value={String(data.overview.sessions)} />
        <Kpi
          label="Дошли до результата"
          value={String(data.overview.reachedResult)}
          hint={percent(data.overview.completionRate)}
        />
        <Kpi label="Кликнули CTA" value={String(data.overview.ctaClicks)} hint={percent(data.overview.ctaCtr)} />
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>
              {ctrUplift ? `Uplift ${ctrUplift.test} к ${ctrUplift.control} по CTR` : 'Uplift по CTR'}
            </CardDescription>
            <CardTitle
              className={cn(
                'flex items-center gap-2 text-3xl tabular-nums',
                ctrUplift !== null && ctrUplift.value < 0 && 'text-destructive',
              )}
            >
              {ctrUplift !== null ? (
                ctrUplift.value >= 0 ? (
                  <TrendingUp className="size-6" aria-hidden />
                ) : (
                  <TrendingDown className="size-6" aria-hidden />
                )
              ) : null}
              {formatUplift(ctrUplift)}
            </CardTitle>
            <CardDescription className="text-xs">основная метрика эксперимента</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Воронка по шагам</CardTitle>
          <CardDescription>
            «Дошли дальше»&nbsp;— сессии, которые после этого шага увидели любой следующий экран своего варианта
            или результат. Для экрана результата это клик по&nbsp;CTA, то есть конверсия среди дошедших.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Шаг</TableHead>
                  <TableHead className="w-48">Вошли</TableHead>
                  <TableHead className="text-right">Ответили</TableHead>
                  <TableHead className="text-right">Дошли дальше</TableHead>
                  <TableHead className="text-right">Отвал</TableHead>
                  <TableHead className="text-right">Конверсия</TableHead>
                  <TableHead className="text-right">Возвраты</TableHead>
                  <TableHead className="text-right">От старта</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.steps.map((step, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="font-medium">{step.title ?? step.stepId}</div>
                      <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
                        {step.stepId}
                        {step.type ? (
                          <Badge variant="outline" className="font-mono text-[10px] font-normal">
                            {step.type}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress
                          value={maxEntered === 0 ? 0 : (step.entered / maxEntered) * 100}
                          className="h-1.5 w-24"
                        />
                        <span className="tabular-nums">{step.entered}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{step.completed}</TableCell>
                    <TableCell className="text-right tabular-nums">{step.continued}</TableCell>
                    <TableCell
                      className={cn('text-right tabular-nums', step.dropoff > 0 && 'text-destructive')}
                    >
                      {step.dropoff}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {percent(step.conversionToNext)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{step.backClicks}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {percent(step.conversionFromStart)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SegmentTable
        title="Сравнение вариантов эксперимента"
        description={
          ctrUplift
            ? `Uplift ${ctrUplift.test} к ${ctrUplift.control}: CTR ${formatUplift(ctrUplift)}, конверсия в результат ${formatUplift(
                upliftOf(data.byVariant, 'completionRate'),
              )}`
            : undefined
        }
        rows={data.byVariant}
      />
      <SegmentTable title="Сравнение версий воронки" rows={data.byVersion} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Распределение по экранам результата</CardTitle>
          <CardDescription>
            Какой из результатов воронка выдала сессии по правилам <span className="font-mono">resultRules</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Результат</TableHead>
                  <TableHead className="text-right">Сессий</TableHead>
                  <TableHead className="text-right">Кликов CTA</TableHead>
                  <TableHead className="text-right">CTR CTA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byResult.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="font-medium">{row.title ?? row.resultId}</div>
                      <div className="text-muted-foreground font-mono text-xs">{row.resultId}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.ctaClicks}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{percent(row.ctaCtr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SegmentTable title="Разрез по UTM campaign" rows={data.byCampaign} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" aria-hidden />
              Качество данных
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ['Событий в выборке', data.dataQuality.events],
                ['Пришли не по порядку', data.dataQuality.outOfOrderEvents],
                ['Сессий с возвратом', data.dataQuality.sessionsWithBack],
              ].map(([label, value], index) => (
                <div key={index} className="flex flex-col">
                  <span className="text-muted-foreground text-xs">{label}</span>
                  <span className="text-xl font-medium tabular-nums">{value}</span>
                </div>
              ))}
            </div>

            <div className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                Счётчики приёма — за всё время работы, фильтры на них не действуют: у отклонённой
                попытки часто нет ни валидной сессии, ни даты, к которым её можно отнести.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  ['Отброшено дублей', data.dataQuality.duplicateAttempts],
                  ['Отклонено некорректных', data.dataQuality.rejectedEvents],
                ].map(([label, value], index) => (
                  <div key={index} className="flex flex-col">
                    <span className="text-muted-foreground text-xs">{label}</span>
                    <span className="text-xl font-medium tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4" aria-hidden />
              События
            </CardTitle>
            <CardDescription>Данные на {new Date(data.generated_at).toLocaleString('ru-RU')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Имя</TableHead>
                  <TableHead className="text-right">Событий</TableHead>
                  <TableHead className="text-right">Сессий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.eventCounts.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-xs">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.events}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
