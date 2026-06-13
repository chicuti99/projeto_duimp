import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_DESCRICAO_IA = 1800;

function normalizarDescricao(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_DESCRICAO_IA) return normalized;
  return `${normalized.slice(0, MAX_DESCRICAO_IA - 18).trim()}… [texto reduzido]`;
}

const ItemSchema = z.object({
  descricao: z.string().transform(normalizarDescricao).pipe(z.string().min(2).max(MAX_DESCRICAO_IA)),
  ncm_informado: z.string().max(20).optional().default(""),
});

const InputSchema = z.object({
  itens: z.array(ItemSchema).min(1).max(50),
  operacao: z.enum(["importacao", "exportacao", "ambos"]).default("importacao"),
});

const ResultItemSchema = z.object({
  descricao_original: z.string(),
  ncm_informado: z.string(),
  ncm_sugerido: z.string().describe("NCM 8 dígitos XXXX.XX.XX"),
  descricao_ncm: z.string(),
  confianca: z.enum(["muito_alta", "alta", "media", "baixa"]),
  divergencia: z.boolean().describe("true quando ncm_informado existe e difere de ncm_sugerido nos 8 dígitos"),
  ii: z.string(),
  ipi: z.string(),
  pis_cofins: z.string(),
  tratamento_administrativo: z.string(),
  observacao: z.string(),
});

const ResultSchema = z.object({
  resultados: z.array(ResultItemSchema),
  resumo: z.string(),
});

export type NcmBatchResult = z.infer<typeof ResultSchema>;
export type NcmBatchItem = z.infer<typeof ResultItemSchema>;

export const classifyNcmBatch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY não configurada");

    const systemPrompt = `Você é auditor-fiscal especialista em NCM/TEC Mercosul e Siscomex. Receberá uma LISTA de itens (descrição do produto, e opcionalmente o NCM já informado pelo usuário). Para cada item:
1. Aplique RGI 1/3/6 e identifique a NCM mais provável (8 dígitos no formato XXXX.XX.XX).
2. Se o usuário informou um NCM, compare. Marque divergencia=true quando os 8 dígitos diferirem.
3. Informe alíquotas APROXIMADAS da TEC vigente: II (%), IPI (%), PIS/COFINS importação (%). Use "n/a" quando não aplicável.
4. Informe tratamento administrativo (Anvisa, Inmetro, MAPA, Anatel, Decex, Exército, IBAMA, ANP) ou "Não há".
5. Observação curta: risco fiscal, atributo decisivo ou pergunta-chave.
6. Mantenha descrição original exatamente como recebida em descricao_original.

REGRAS:
- Se a descrição for vaga, escolha a NCM mais provável mas use confianca="baixa" e explique na observação.
- Não invente alíquotas extremas; se incerto use faixa (ex.: "14-16%").
- Use formato exato XXXX.XX.XX nos NCMs.
- Retorne EXATAMENTE um resultado por item de entrada, na mesma ordem.`;

    const lista = data.itens
      .map((it, i) => `${i + 1}. "${it.descricao}"${it.ncm_informado ? ` | NCM informado: ${it.ncm_informado}` : ""}`)
      .join("\n");

    const userPrompt = `Operação: ${data.operacao}\nTotal de itens: ${data.itens.length}\n\nITENS:\n${lista}\n\nClassifique todos. Retorne EXATAMENTE ${data.itens.length} resultados na mesma ordem.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "retornar_lote",
              description: "Retorna a classificação em lote",
              parameters: {
                type: "object",
                properties: {
                  resultados: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        descricao_original: { type: "string" },
                        ncm_informado: { type: "string" },
                        ncm_sugerido: { type: "string" },
                        descricao_ncm: { type: "string" },
                        confianca: { type: "string", enum: ["muito_alta", "alta", "media", "baixa"] },
                        divergencia: { type: "boolean" },
                        ii: { type: "string" },
                        ipi: { type: "string" },
                        pis_cofins: { type: "string" },
                        tratamento_administrativo: { type: "string" },
                        observacao: { type: "string" },
                      },
                      required: [
                        "descricao_original",
                        "ncm_informado",
                        "ncm_sugerido",
                        "descricao_ncm",
                        "confianca",
                        "divergencia",
                        "ii",
                        "ipi",
                        "pis_cofins",
                        "tratamento_administrativo",
                        "observacao",
                      ],
                      additionalProperties: false,
                    },
                  },
                  resumo: { type: "string" },
                },
                required: ["resultados", "resumo"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "retornar_lote" } },
      }),
    });

    if (response.status === 429) throw new Error("Limite de requisições atingido. Aguarde e tente novamente.");
    if (response.status === 402) throw new Error("Créditos de IA insuficientes. Adicione créditos no workspace Lovable.");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha no gateway de IA [${response.status}]: ${text}`);
    }

    const json = await response.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("Resposta da IA sem dados estruturados");

    return ResultSchema.parse(JSON.parse(toolCall.function.arguments));
  });