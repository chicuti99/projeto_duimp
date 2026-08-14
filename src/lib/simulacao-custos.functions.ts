import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateItemInputSchema = z.object({
  nomeProduto: z.string().min(1),
  contribuinteIcms: z.boolean(),
  contribuinteIpi: z.boolean(),
  ncm: z.string().optional(),
  aliquotaIi: z.number().optional(),
  aliquotaIpi: z.number().optional(),
  aliquotaPis: z.number().optional(),
  aliquotaCofins: z.number().optional(),
  aliquotaIcms: z.number().optional(),
  antidumping: z.number(),
  peso: z.number().optional(),
  quantidade: z.number().optional(),
  fobUnit: z.number().optional(),
  frete: z.number().optional(),
  seguro: z.number().optional(),
});

const UpdateItemInputSchema = CreateItemInputSchema.extend({
  id: z.string().min(1),
});

function toRow(data: z.infer<typeof CreateItemInputSchema>) {
  return {
    nome_produto: data.nomeProduto,
    contribuinte_icms: data.contribuinteIcms,
    contribuinte_ipi: data.contribuinteIpi,
    ncm: data.ncm || null,
    aliquota_ii: data.aliquotaIi ?? null,
    aliquota_ipi: data.aliquotaIpi ?? null,
    aliquota_pis: data.aliquotaPis ?? null,
    aliquota_cofins: data.aliquotaCofins ?? null,
    aliquota_icms: data.aliquotaIcms ?? null,
    antidumping: data.antidumping,
    peso: data.peso ?? null,
    quantidade: data.quantidade ?? null,
    fob_unit: data.fobUnit ?? null,
    frete: data.frete ?? null,
    seguro: data.seguro ?? null,
  };
}

export const createSimulacaoCustoItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateItemInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await (supabaseAdmin as any)
      .from("simulacao_custos_itens")
      .insert(toRow(data))
      .select("id")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return { ok: true, id: row.id as string } as const;
  });

// Usada quando o usuário edita um item que já foi persistido (tem dbId) —
// sem isso, clicar em "Salvar" numa edição só atualizava o estado local,
// sem nenhuma requisição pro servidor.
export const updateSimulacaoCustoItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateItemInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { id, ...rest } = data;
    const { error } = await (supabaseAdmin as any)
      .from("simulacao_custos_itens")
      .update(toRow(rest))
      .eq("id", id);

    if (error) {
      throw new Error(error.message);
    }

    return { ok: true } as const;
  });

export const SimulacaoCustoItemRowSchema = z.object({
  id: z.string(),
  nome_produto: z.string(),
  contribuinte_icms: z.boolean(),
  contribuinte_ipi: z.boolean(),
  ncm: z.string().nullable(),
  aliquota_ii: z.number().nullable(),
  aliquota_ipi: z.number().nullable(),
  aliquota_pis: z.number().nullable(),
  aliquota_cofins: z.number().nullable(),
  aliquota_icms: z.number().nullable(),
  antidumping: z.number(),
  peso: z.number().nullable(),
  quantidade: z.number().nullable(),
  fob_unit: z.number().nullable(),
  frete: z.number().nullable(),
  seguro: z.number().nullable(),
});

export type SimulacaoCustoItemRow = z.infer<typeof SimulacaoCustoItemRowSchema>;

// Lista compartilhada entre todos os usuários — mesmo padrão já usado pelo
// histórico de classificação NCM (ncm_searches), sem filtro por conta.
export const listSimulacaoCustoItens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await (supabaseAdmin as any)
      .from("simulacao_custos_itens")
      .select(
        "id, nome_produto, contribuinte_icms, contribuinte_ipi, ncm, aliquota_ii, aliquota_ipi, aliquota_pis, aliquota_cofins, aliquota_icms, antidumping, peso, quantidade, fob_unit, frete, seguro",
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return { items: z.array(SimulacaoCustoItemRowSchema).parse(data ?? []) };
  });

const DeleteItemInputSchema = z.object({
  id: z.string().min(1),
});

export const deleteSimulacaoCustoItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteItemInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("simulacao_custos_itens")
      .delete()
      .eq("id", data.id);

    if (error) {
      throw new Error(error.message);
    }

    return { ok: true } as const;
  });
