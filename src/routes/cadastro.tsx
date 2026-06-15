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

export const Route = createFileRoute("/cadastro")({
  component: CadastroPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Cadastro" },
      {
        name: "description",
        content: "Criação de conta.",
      },
    ],
  }),
});

function CadastroPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [telephoneValue, setTelephoneValue] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formValues, setFormValues] = useState({
    first_name: "",
    second_name: "",
    email: "",
    password: "",
    confirm_password: "",
  });

  function formatTelephone(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);

    if (digits.length <= 2) {
      return digits;
    }

    if (digits.length <= 7) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    }

    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function isStrongPassword(value: string) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(value);
  }

  function validateForm(values: typeof formValues, phone: string) {
    const nextErrors: Record<string, string> = {};

    if (!values.first_name.trim()) nextErrors.first_name = "Campo obrigatório";
    if (!values.second_name.trim()) nextErrors.second_name = "Campo obrigatório";

    if (!values.email.trim()) {
      nextErrors.email = "Campo obrigatório";
    } else if (!isValidEmail(values.email.trim().toLowerCase())) {
      nextErrors.email = "Email inválido";
    }

    if (!phone.trim()) {
      nextErrors.telephone = "Campo obrigatório";
    } else if (!/^\(\d{2}\) \d{5}-\d{4}$/.test(phone)) {
      nextErrors.telephone = "Telefone inválido";
    }

    if (!values.password) {
      nextErrors.password = "Campo obrigatório";
    } else if (!isStrongPassword(values.password)) {
      nextErrors.password = "Senha fraca";
    }

    if (!values.confirm_password) {
      nextErrors.confirm_password = "Campo obrigatório";
    } else if (values.confirm_password !== values.password) {
      nextErrors.confirm_password = "As senhas não coincidem";
    }

    return nextErrors;
  }

  function validateField(field: string, values = formValues, phone = telephoneValue) {
    const nextErrors = validateForm(values, phone);
    return nextErrors[field] ?? "";
  }

  function markTouched(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function showFieldError(field: string) {
    return Boolean(touched[field] || errors[field]);
  }

  const canSubmit = Object.keys(validateForm(formValues, telephoneValue)).length === 0;

  async function handleCadastro(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("first_name") ?? "").trim();
    const secondName = String(formData.get("second_name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const telephone = String(formData.get("telephone") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");
    const currentValues = {
      first_name: firstName,
      second_name: secondName,
      email,
      password,
      confirm_password: confirmPassword,
    };
    const nextErrors = validateForm(currentValues, telephone);

    setErrors(nextErrors);
    setTouched({
      first_name: true,
      second_name: true,
      email: true,
      telephone: true,
      password: true,
      confirm_password: true,
    });

    if (Object.keys(nextErrors).length > 0) {
      toast.error("Corrija os campos destacados em vermelho");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            second_name: secondName,
            telephone,
          },
        },
      });

      if (error?.code === "over_email_send_rate_limit") {
        toast.error("Muitas tentativas de cadastro", {
          description: "Aguarde alguns segundos e tente novamente.",
        });
        return;
      }

      if (error) throw error;

      const userId = data.user?.id;
      if (userId) {
        await saveUserProfile({
          data: {
            id: userId,
            first_name: firstName,
            second_name: secondName,
            email,
            telephone,
          },
        });
      }

      toast.success("Cadastro realizado com sucesso", {
        description: "Agora você pode acessar o sistema.",
      });
      setFormValues({
        first_name: "",
        second_name: "",
        email: "",
        password: "",
        confirm_password: "",
      });
      setTelephoneValue("");
      setErrors({});
      setTouched({});
      navigate({ to: "/" });
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível cadastrar", {
        description: "Verifique seus dados e tente novamente.",
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
          <h1 className="text-3xl font-bold tracking-tight">Criar conta</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Preencha seus dados para liberar o acesso ao sistema.
          </p>
        </div>

        <Card className="shadow-xl border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Cadastro</CardTitle>
            <CardDescription>Use um e-mail válido e crie uma senha segura.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCadastro}>
              <div className="space-y-2">
                <Label htmlFor="first_name">Primeiro nome</Label>
                <Input
                  id="first_name"
                  name="first_name"
                  type="text"
                  placeholder="Primeiro nome"
                  value={formValues.first_name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormValues((current) => ({ ...current, first_name: value }));
                    if (touched.first_name) {
                      setErrors((current) => ({ ...current, first_name: validateField("first_name", { ...formValues, first_name: value }, telephoneValue) }));
                    }
                  }}
                  onBlur={() => {
                    markTouched("first_name");
                    setErrors((current) => ({
                      ...current,
                      first_name: validateField("first_name"),
                    }));
                  }}
                  className={
                    showFieldError("first_name") && validateField("first_name")
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {showFieldError("first_name") && validateField("first_name") ? (
                  <p className="text-xs text-red-500">{validateField("first_name")}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="second_name">Segundo nome</Label>
                <Input
                  id="second_name"
                  name="second_name"
                  type="text"
                  placeholder="Segundo nome"
                  value={formValues.second_name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormValues((current) => ({ ...current, second_name: value }));
                    if (touched.second_name) {
                      setErrors((current) => ({ ...current, second_name: validateField("second_name", { ...formValues, second_name: value }, telephoneValue) }));
                    }
                  }}
                  onBlur={() => {
                    markTouched("second_name");
                    setErrors((current) => ({
                      ...current,
                      second_name: validateField("second_name"),
                    }));
                  }}
                  className={
                    showFieldError("second_name") && validateField("second_name")
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {showFieldError("second_name") && validateField("second_name") ? (
                  <p className="text-xs text-red-500">{validateField("second_name")}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Digite seu e-mail"
                  autoComplete="email"
                  value={formValues.email}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormValues((current) => ({ ...current, email: value }));
                    if (touched.email) {
                      setErrors((current) => ({
                        ...current,
                        email: validateField("email", { ...formValues, email: value }, telephoneValue),
                      }));
                    }
                  }}
                  onBlur={() => {
                    markTouched("email");
                    setErrors((current) => ({ ...current, email: validateField("email") }));
                  }}
                  className={
                    showFieldError("email") && validateField("email")
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {showFieldError("email") && validateField("email") ? (
                  <p className="text-xs text-red-500">{validateField("email")}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Exemplo: nome@empresa.com
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="telephone">Telefone</Label>
                <Input
                  id="telephone"
                  name="telephone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="(00) 00000-0000"
                  autoComplete="tel"
                  value={telephoneValue}
                  onChange={(event) => {
                    const formatted = formatTelephone(event.target.value);
                    setTelephoneValue(formatted);
                    if (touched.telephone) {
                      setErrors((current) => ({
                        ...current,
                        telephone: validateField("telephone", formValues, formatted),
                      }));
                    }
                  }}
                  onBlur={() => {
                    markTouched("telephone");
                    setErrors((current) => ({
                      ...current,
                      telephone: validateField("telephone"),
                    }));
                  }}
                  maxLength={15}
                  className={
                    showFieldError("telephone") && validateField("telephone")
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {showFieldError("telephone") && validateField("telephone") ? (
                  <p className="text-xs text-red-500">{validateField("telephone")}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Formato automático: (xx) xxxxx-xxxx
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Crie uma senha"
                  autoComplete="new-password"
                  value={formValues.password}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormValues((current) => ({ ...current, password: value }));
                    if (touched.password || touched.confirm_password) {
                      const nextValues = { ...formValues, password: value };
                      setErrors((current) => ({
                        ...current,
                        password: validateField("password", nextValues, telephoneValue),
                        confirm_password: validateField("confirm_password", nextValues, telephoneValue),
                      }));
                    }
                  }}
                  onBlur={() => {
                    markTouched("password");
                    setErrors((current) => ({
                      ...current,
                      password: validateField("password"),
                    }));
                  }}
                  className={
                    showFieldError("password") && validateField("password")
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {showFieldError("password") && validateField("password") ? (
                  <p className="text-xs text-red-500">{validateField("password")}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Mínimo de 8 caracteres, com maiúscula, minúscula e número.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm_password">Confirmar senha</Label>
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  placeholder="Confirme sua senha"
                  autoComplete="new-password"
                  value={formValues.confirm_password}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormValues((current) => ({ ...current, confirm_password: value }));
                    if (touched.confirm_password) {
                      const nextValues = { ...formValues, confirm_password: value };
                      setErrors((current) => ({
                        ...current,
                        confirm_password: validateField("confirm_password", nextValues, telephoneValue),
                      }));
                    }
                  }}
                  onBlur={() => {
                    markTouched("confirm_password");
                    setErrors((current) => ({
                      ...current,
                      confirm_password: validateField("confirm_password"),
                    }));
                  }}
                  className={
                    showFieldError("confirm_password") && validateField("confirm_password")
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {showFieldError("confirm_password") && validateField("confirm_password") ? (
                  <p className="text-xs text-red-500">{validateField("confirm_password")}</p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={loading || !canSubmit}>
                {loading ? "Cadastrando..." : "Cadastrar"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              <Link to="/" className="text-primary underline-offset-4 hover:underline font-medium">
                voltar para login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
