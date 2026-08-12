import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LookupInputSchema = z.object({
  ncm: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().length(8)),
});

export type NcmTributoLookup = {
  ncm: string;
  descricao: string | null;
  aliquota_ii: number | null;
  aliquota_ipi: number | null;
  aliquota_pis: number | null;
  aliquota_cofins: number | null;
};

export const lookupNcmTributos = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => LookupInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await (supabaseAdmin as any)
      .from("ncm_tributos")
      .select(
        "ncm, descricao, aliquota_ii, aliquota_ipi, aliquota_pis, aliquota_cofins",
      )
      .eq("ncm", data.ncm)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return (row ?? null) as NcmTributoLookup | null;
  });
