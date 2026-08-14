import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuthGuard } from "@/hooks/use-auth-guard";

// Envolve a tela inteira de uma rota interna: só renderiza `children`
// depois de confirmar sessão válida (ver useAuthGuard). Enquanto checa,
// ou se não houver sessão, mostra só o spinner — nunca o conteúdo real.
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthGuard();

  if (status !== "authenticated") {
    return <AuthGuardFallback />;
  }

  return <>{children}</>;
}

export function AuthGuardFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
