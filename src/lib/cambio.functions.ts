import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Cotação pública (sem chave de API) via AwesomeAPI, usada para
// pré-preencher a "Taxa de conversão" da Simulação de Custos. O valor
// retornado continua editável no formulário — isso aqui só evita o
// usuário ter que digitar a cotação do dia manualmente.
const InputSchema = z.object({
  moeda: z.enum(["USD", "EUR"]),
});

const AwesomeApiSchema = z.record(
  z.string(),
  z.object({
    bid: z.string(),
  }),
);

export const fetchCambio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const par = `${data.moeda}-BRL`;

    let response: Response;
    try {
      response = await fetch(
        `https://economia.awesomeapi.com.br/json/last/${par}`,
        { signal: AbortSignal.timeout(10_000) },
      );
    } catch {
      throw new Error("Não foi possível consultar a cotação no momento.");
    }

    if (!response.ok) {
      throw new Error("Não foi possível consultar a cotação no momento.");
    }

    const parsed = AwesomeApiSchema.parse(await response.json());
    const key = `${data.moeda}BRL`;
    const quote = parsed[key];

    if (!quote) {
      throw new Error("Cotação não encontrada para a moeda selecionada.");
    }

    return { bid: quote.bid };
  });
