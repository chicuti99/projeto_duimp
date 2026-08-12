import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
