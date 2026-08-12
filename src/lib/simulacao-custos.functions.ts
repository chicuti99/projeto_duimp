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

export const createSimulacaoCustoItem = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateItemInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { error } = await (supabaseAdmin as any)
      .from("simulacao_custos_itens")
      .insert({
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
      });

    if (error) {
      throw new Error(error.message);
    }

    return { ok: true } as const;
  });
