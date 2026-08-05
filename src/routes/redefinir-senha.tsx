import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export const Route = createFileRoute("/redefinir-senha")({
  component: RedefinirSenhaPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Redefinir senha" },
      {
        name: "description",
        content: "Definir uma nova senha.",
      },
    ],
  }),
});

function isStrongPassword(value: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(value);
}

// O Supabase processa o token de recuperação que vem no link do e-mail
// (fragmento da URL) automaticamente ao carregar o client, e dispara o
// evento PASSWORD_RECOVERY quando a sessão de recuperação fica pronta.
// Só liberamos o formulário depois desse evento; se ele não chegar em
// alguns segundos, o link é tratado como inválido/expirado.
type Status = "verifying" | "ready" | "expired";

function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("verifying");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });

    const timeout = window.setTimeout(() => {
      setStatus((current) => (current === "verifying" ? "expired" : current));
    }, 5000);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");

    if (!isStrongPassword(password)) {
      toast.error("Senha fraca", {
        description: "Use ao menos 8 caracteres, com maiúscula, minúscula e número.",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast.success("Senha redefinida com sucesso");
      await supabase.auth.signOut();
      navigate({ to: "/" });
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível redefinir a senha", {
        description: "Solicite um novo link e tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_35%),linear-gradient(to_bottom_right,_hsl(var(--background)),_hsl(var(--muted)/0.35))]">
      <Toaster richColors position="top-center" />

      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold shadow-lg">
            FC
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Redefinir senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">Escolha uma nova senha para sua conta.</p>
        </div>

        <Card className="shadow-xl border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Nova senha</CardTitle>
            <CardDescription>
              {status === "expired"
                ? "Este link é inválido ou já expirou."
                : "Sua nova senha precisa ter pelo menos 8 caracteres, com maiúscula, minúscula e número."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === "expired" ? (
              <div className="text-center text-sm">
                <Link
                  to="/esqueci-senha"
                  className="text-primary underline-offset-4 hover:underline font-medium"
                >
                  solicitar um novo link
                </Link>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Digite a nova senha"
                    disabled={status !== "ready"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm_password">Confirmar nova senha</Label>
                  <Input
                    id="confirm_password"
                    name="confirm_password"
                    type="password"
                    placeholder="Repita a nova senha"
                    disabled={status !== "ready"}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading || status !== "ready"}>
                  {status === "verifying" ? "Verificando link..." : loading ? "Salvando..." : "Salvar nova senha"}
                </Button>
              </form>
            )}

            <div className="mt-4 text-center text-sm">
              <Link to="/" className="text-primary underline-offset-4 hover:underline font-medium">
                voltar ao login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
