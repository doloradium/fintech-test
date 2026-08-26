import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAdminToken, setAdminToken } from '@/lib/api';

export const AdminTokenField = () => {
  const [token, setToken] = useState(getAdminToken());

  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:gap-4">
      <Label htmlFor="admin-token" className="text-muted-foreground shrink-0 text-xs font-normal">
        <KeyRound className="size-3.5" aria-hidden />
        Админ-токен — нужен, только если задана переменная ADMIN_TOKEN
      </Label>
      <Input
        id="admin-token"
        type="password"
        className="sm:max-w-xs"
        value={token}
        placeholder="оставьте пустым, если токен не задан"
        onChange={(event) => {
          setToken(event.target.value);
          setAdminToken(event.target.value);
        }}
      />
    </div>
  );
};
