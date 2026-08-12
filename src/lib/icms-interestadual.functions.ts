import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LookupInputSchema = z.object({
  ufOrigem: z.string().length(2),
  ufDestino: z.string().length(2),
});

export type IcmsInterestadualLookup = {
  ufOrigem: string;
  ufDestino: string;
  aliquota: number;
};

// "Operação via (UF)" é a origem (por onde a carga entra no país) e o
// UF de "Destino" é pra onde a mercadoria é revendida — juntos formam o
// par usado pra achar a alíquota de ICMS de saída em icms_interestadual
// (ver supabase/migrations/20260804023312_create_icms_interestadual.sql).
export const lookupIcmsInterestadual = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LookupInputSchema.parse(input))
  .handler(async ({ data }) => {
    const ufOrigem = data.ufOrigem.toUpperCase();
    const ufDestino = data.ufDestino.toUpperCase();

    const { data: row, error } = await (supabaseAdmin as any)
      .from("icms_interestadual")
      .select("uf_origem, uf_destino, aliquota")
      .eq("uf_origem", ufOrigem)
      .eq("uf_destino", ufDestino)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!row) return null;

    return {
      ufOrigem: row.uf_origem,
      ufDestino: row.uf_destino,
      aliquota: Number(row.aliquota),
    } as IcmsInterestadualLookup;
  });
