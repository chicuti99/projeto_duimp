import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

export const Route = createFileRoute("/esqueci-senha")({
  component: EsqueciSenhaPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Esqueci minha senha" },
      {
        name: "description",
        content: "Solicitar redefinição de senha.",
      },
    ],
  }),
});

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function EsqueciSenhaPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      toast.error("Informe um e-mail válido");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });

      if (error?.code === "over_email_send_rate_limit") {
        toast.error("Muitas tentativas", {
          description: "Aguarde alguns segundos e tente novamente.",
        });
        return;
      }

      if (error) throw error;

      // Não revelamos se o e-mail existe ou não na base — sempre mostramos
      // a mesma mensagem de sucesso, evitando enumeração de contas.
      setSent(true);
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível enviar o e-mail", {
        description: "Tente novamente em instantes.",
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
          <h1 className="text-3xl font-bold tracking-tight">Esqueci minha senha</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Informe seu e-mail para receber o link de redefinição.
          </p>
        </div>

        <Card className="shadow-xl border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Redefinir senha</CardTitle>
            <CardDescription>
              {sent
                ? "Se o e-mail estiver cadastrado, você vai receber um link em instantes."
                : "Enviaremos um link de redefinição para o seu e-mail."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center text-sm text-muted-foreground">
                Verifique também a caixa de spam. O link expira em algumas horas.
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" name="email" type="email" placeholder="Digite seu e-mail" />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Enviando..." : "Enviar link de redefinição"}
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
