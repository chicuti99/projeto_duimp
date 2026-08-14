import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GoogleGenAI, Type } from "@google/genai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

// Limite por chamada à IA (contexto/tempo de resposta) — o client
// (BatchClassifier.tsx) divide arquivos maiores em vários lotes desse
// tamanho e chama essa função uma vez por lote.
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

const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    resumo: { type: Type.STRING },
    resultados: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          descricao_original: { type: Type.STRING },
          ncm_informado: { type: Type.STRING },
          ncm_sugerido: { type: Type.STRING },
          descricao_ncm: { type: Type.STRING },
          confianca: { type: Type.STRING, enum: ["muito_alta", "alta", "media", "baixa"] },
          divergencia: { type: Type.BOOLEAN },
          ii: { type: Type.STRING },
          ipi: { type: Type.STRING },
          pis_cofins: { type: Type.STRING },
          tratamento_administrativo: { type: Type.STRING },
          observacao: { type: Type.STRING },
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
      },
    },
  },
  required: ["resultados", "resumo"],
};

export const classifyNcmBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY não configurada");
    }

    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      // Lote pode ter até 50 itens — dá mais folga que o timeout padrão
      // (1 min) usado na classificação individual.
      httpOptions: { timeout: 90_000 },
    });

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

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: geminiResponseSchema as any,
          temperature: 0.0,
          thinkingConfig: {
            thinkingBudget: 1024,
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Resposta da IA retornou vazia.");
      }

      return ResultSchema.parse(JSON.parse(responseText));
    } catch (error: any) {
      // O SDK nem sempre preenche `error.status` pra erros vindos do
      // gateway do Gemini (ex.: 504 DEADLINE_EXCEEDED chega só como JSON
      // cru dentro de error.message) — por isso também olhamos o texto da
      // mensagem, não só o status.
      const message = String(error?.message ?? error ?? "");
      if (error?.status === 429 || /"code":\s*429|RESOURCE_EXHAUSTED/.test(message)) {
        throw new Error("Limite de requisições atingido na API do Gemini. Aguarde um momento.");
      }
      if (
        error?.status === 503 ||
        error?.status === 504 ||
        /"code":\s*(503|504)|UNAVAILABLE|DEADLINE_EXCEEDED/.test(message)
      ) {
        // Mensagem reconhecida pelo client (BatchClassifier.runAll) pra
        // decidir se tenta o lote de novo automaticamente.
        throw new Error(
          "O serviço de IA está sobrecarregado ou demorou demais para responder. Tente novamente em instantes.",
        );
      }
      throw new Error(`Erro na classificação em lote: ${message}`);
    }
  });
