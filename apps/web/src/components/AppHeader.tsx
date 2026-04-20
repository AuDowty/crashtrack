import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@/lib/api";
import { logout } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function AppHeader({ user }: { user: User }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const logoutMut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      nav("/");
    },
  });

  return (
    <header className="border-b">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/app" className="text-lg font-semibold">crashtrack</Link>
        <div className="flex items-center gap-3">
          {user.avatar_url && <img src={user.avatar_url} alt="" className="size-8 rounded-full" />}
          <span className="text-sm text-muted-foreground">{user.github_login}</span>
          <Button variant="outline" size="sm" onClick={() => logoutMut.mutate()}>
            sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
