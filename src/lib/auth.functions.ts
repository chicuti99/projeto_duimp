import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SaveProfileInputSchema = z.object({
  id: z.string().min(1),
  first_name: z.string().min(1),
  second_name: z.string().optional().default(""),
  email: z.string().email(),
  telephone: z.string().optional().default(""),
});

// Fica sem requireSupabaseAuth de propósito: no cadastro (signUp), o
// Supabase deste projeto exige confirmação de e-mail (mailer_autoconfirm
// = false), então ainda não existe sessão/bearer token no momento dessa
// chamada — exigir auth aqui quebraria a criação de perfil no primeiro
// cadastro. Ver [[protecao-telas-internas-sem-login]] para o resto do
// que foi protegido.
export const saveUserProfile = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SaveProfileInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("usuarios").upsert({
      id: data.id,
      first_name: data.first_name,
      second_name: data.second_name || null,
      email: data.email,
      telephone: data.telephone || null,
      status: "ativo",
      role: "usuario",
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Falha ao salvar perfil do usuário: ${error.message}`);
    }

    return { ok: true };
  });
