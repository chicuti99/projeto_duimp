import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type AuthGuardStatus = "checking" | "authenticated";

// Protege telas internas (classificação, histórico, simulação de custos):
// sem sessão válida — aba anônima, link direto sem login, sessão que
// expirou ou foi encerrada em outra aba — redireciona pro login antes de
// deixar o conteúdo da tela aparecer. As rotas que usam esse hook também
// marcam `ssr: false`; sem isso o HTML já sairia do servidor com a tela
// pronta, antes de qualquer checagem rodar no browser.
export function useAuthGuard(): AuthGuardStatus {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AuthGuardStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;

      if (!data.session) {
        navigate({ to: "/", replace: true });
        return;
      }

      setStatus("authenticated");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;

      if (!session) {
        navigate({ to: "/", replace: true });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  return status;
}
