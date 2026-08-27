import { useState } from 'react';
import { Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAdminToken, setAdminToken } from '@/lib/api';

export const AdminTokenField = ({ onSaved }: { onSaved: () => void }) => {
  const [draft, setDraft] = useState(getAdminToken());
  const [saved, setSaved] = useState(getAdminToken());

  const dirty = draft !== saved;

  return (
    <form
      className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty) return;
        setAdminToken(draft);
        setSaved(draft);
        toast.success(draft ? 'Админ-токен сохранён' : 'Админ-токен удалён', {
          description: 'Данные страницы перезагружены с новым токеном.',
        });
        onSaved();
      }}
    >
      <Label htmlFor="admin-token" className="text-muted-foreground shrink-0 text-xs font-normal">
        <KeyRound className="size-3.5" aria-hidden />
        Админ-токен — нужен, только если задана переменная ADMIN_TOKEN
      </Label>
      <div className="flex flex-1 gap-2 sm:max-w-md">
        <Input
          id="admin-token"
          type="password"
          value={draft}
          placeholder="оставьте пустым, если токен не задан"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant={dirty ? 'default' : 'outline'} disabled={!dirty} aria-label="Сохранить токен">
          {dirty ? 'Сохранить' : <Check aria-hidden />}
        </Button>
      </div>
    </form>
  );
};
