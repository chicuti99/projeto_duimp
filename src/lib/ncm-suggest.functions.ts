import { GoogleGenAI, Type } from "@google/genai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Sugestão rápida de NCM a partir só do nome do produto, para o botão
// "Buscar NCM" da tela de Simulação de Custos. Depois de setar o NCM
// sugerido no formulário, o efeito existente de lookupNcmTributos já
// confere o código contra a tabela ncm_tributos (mostra "encontrado"/
// "não encontrado na tabela"), então essa função só precisa devolver a
// sugestão — a confirmação contra a tabela acontece no client.
const InputSchema = z.object({
  nomeProduto: z.string().min(2).max(300),
});

const ResultSchema = z.object({
  ncm: z.string().describe("Código NCM de 8 dígitos no formato XXXX.XX.XX"),
  descricao: z.string().describe("Descrição oficial curta do NCM sugerido"),
  confianca: z.enum(["muito_alta", "alta", "media", "baixa"]),
});

export type NcmSuggestResult = z.infer<typeof ResultSchema>;

const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    ncm: { type: Type.STRING },
    descricao: { type: Type.STRING },
    confianca: { type: Type.STRING, enum: ["muito_alta", "alta", "media", "baixa"] },
  },
  required: ["ncm", "descricao", "confianca"],
};

export const suggestNcmByProductName = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY não configurada");
    }

    // O SDK já reexecuta automaticamente em erros 429/5xx (até 2 vezes,
    // por padrão), então não adicionamos retry por cima disso — só
    // encurtamos o timeout de cada tentativa (padrão é 1 minuto) pra
    // essa cadeia não passar de ~1 minuto no pior caso.
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: { timeout: 20_000 },
    });

    const systemPrompt = `Você é um auditor-fiscal especialista em classificação de mercadorias (NCM/SH/TEC Mercosul). Dado apenas o nome/descrição curta de um produto, informe o NCM de 8 dígitos mais provável (formato XXXX.XX.XX), aplicando RGI 1/3/6. Como a informação é só um nome de produto (sem ficha técnica), a confiança nunca deve passar de "media" a menos que o nome já seja muito específico e inequívoco. Responda estritamente no formato JSON solicitado.`;

    const userPrompt = `Nome do produto: "${data.nomeProduto}"\n\nRetorne o NCM mais provável, a descrição oficial curta desse NCM e o nível de confiança.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: geminiResponseSchema as any,
          temperature: 0.0,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Resposta da IA retornou vazia.");
      }

      return ResultSchema.parse(JSON.parse(responseText));
    } catch (error: any) {
      if (error?.status === 429) {
        throw new Error("Limite de requisições atingido na API do Gemini. Aguarde um momento.");
      }
      if (error?.status === 503) {
        throw new Error("O serviço de IA está sobrecarregado no momento. Tente novamente em instantes.");
      }
      throw new Error(`Não foi possível sugerir o NCM: ${error.message || error}`);
    }
  });
