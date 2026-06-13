import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { saveUserProfile } from "@/lib/auth.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Login" },
      {
        name: "description",
        content: "Acesso ao sistema com Supabase Auth.",
      },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) throw error;

      const userId = data.user?.id;
      if (userId) {
        const metadata = data.user.user_metadata ?? {};
        try {
          await saveUserProfile({
            data: {
              id: userId,
              first_name: String(metadata.first_name ?? "Usuário"),
              second_name: String(metadata.second_name ?? ""),
              email,
              telephone: String(metadata.telephone ?? ""),
            },
          });
        } catch (profileError) {
          console.error(profileError);
        }
      }

      toast.success("Login realizado com sucesso");
      navigate({ to: "/classificacao" });
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível fazer login", {
        description: "Confira seu e-mail e senha.",
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
          <h1 className="text-3xl font-bold tracking-tight">FC Comércio Exterior</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Entre com sua conta para acessar a classificação NCM.
          </p>
        </div>

        <Card className="shadow-xl border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Login</CardTitle>
            <CardDescription>Use seu e-mail e senha cadastrados no Supabase Auth.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2">
                <Label htmlFor="email">Login</Label>
                <Input id="email" name="email" type="email" placeholder="Digite seu e-mail" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" name="password" type="password" placeholder="Digite sua senha" />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              <Link to="/cadastro" className="text-primary underline-offset-4 hover:underline font-medium">
                cadastrar
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
