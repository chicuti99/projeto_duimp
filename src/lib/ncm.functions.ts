import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
// Importa o cliente oficial do Google Gen AI
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
// Se o pacote acima expor de forma diferente na sua árvore, a convenção padrão do SDK atual é:
// import { GoogleGenAI } from "@google/genai";
import ws from "ws";


const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    realtime: {
      transport: ws,
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);
const InputSchema = z.object({
  query: z.string().min(2).max(500),
  operation: z.enum(["importacao", "exportacao", "ambos"]).default("ambos"),
  natureza: z
    .enum([
      "medicao_analise",
      "terapia",
      "reabilitacao",
      "monitoramento",
      "consumo_descartavel",
      "acessorio",
      "alimento_bebida",
      "vestuario_textil",
      "eletronico_consumo",
      "maquina_industrial",
      "quimico_insumo",
      "veiculo_parte",
      "outro",
      "nao_sei",
    ])
    .default("nao_sei"),
  atributos: z
    .object({
      finalidade: z.string().max(300).optional().default(""),
      principio_funcional: z.string().max(300).optional().default(""),
      composicao_material: z.string().max(300).optional().default(""),
      tem_software: z.boolean().optional().default(false),
      tem_sensor_eletronico: z.boolean().optional().default(false),
      gera_laudo_exame: z.boolean().optional().default(false),
      uso_profissional: z.boolean().optional().default(false),
      ficha_tecnica_disponivel: z.boolean().optional().default(false),
      manual_catalogo_disponivel: z.boolean().optional().default(false),
      marca: z.string().max(120).optional().default(""),
      modelo: z.string().max(120).optional().default(""),
      fabricante: z.string().max(160).optional().default(""),
      pais_origem: z.string().max(80).optional().default(""),
    })
    .optional()
    .default(() => ({})),
});

const ResultSchema = z.object({
  natureza_funcional: z.string().describe("Natureza funcional identificada (mede / trata / monitora / suporta / consome) com 1 frase"),
  nivel_dados: z.enum(["insuficiente", "basico", "razoavel", "completo"]).describe("Qualidade dos dados fornecidos"),
  confianca_maxima_permitida: z.enum(["baixa", "media", "alta", "muito_alta"]).describe("Teto de confiança que o sistema pode atribuir, dado o nível de dados"),
  perguntas_obrigatorias: z
    .array(z.string())
    .max(8)
    .describe("Perguntas técnicas que o usuário DEVE responder antes de operar com este NCM (vazio se dados completos)"),
  falsos_cognatos_alertados: z
    .array(z.string())
    .max(6)
    .describe("Palavras do produto que podem induzir a NCM errada e por quê (ex: 'respiratório ≠ terapêutico')"),
  analise_rgi: z.string().describe("Análise hierárquica aplicando RGI 1, 3 e 6 e referência à NESH quando aplicável"),
  classifications: z
    .array(
      z.object({
        ncm: z.string().describe("Código NCM de 8 dígitos no formato XXXX.XX.XX"),
        descricao: z.string().describe("Descrição oficial do NCM"),
        capitulo: z.string().describe("Capítulo (2 primeiros dígitos) e nome do capítulo"),
        confianca: z.enum(["muito_alta", "alta", "media", "baixa"]),
        nivel_risco: z.enum(["baixo", "medio", "alto"]).describe("Risco fiscal de reclassificação pela RFB"),
        justificativa: z.string().describe("Por que este NCM se aplica"),
        justificativa_auditavel: z.string().describe("Justificativa em formato auditável: função principal identificada, atributo decisivo, regra RGI aplicada, referência NESH/Solução de Consulta COSIT quando houver"),
        ii_aliquota: z.string().describe("Alíquota de Imposto de Importação aproximada (ex: 14%)"),
        ipi_aliquota: z.string().describe("Alíquota de IPI aproximada"),
        pis_cofins: z.string().describe("PIS/COFINS importação aproximado"),
        tratamento_administrativo: z.string().describe("Anuência/órgãos reguladores no Siscomex (Anvisa, Inmetro, MAPA, etc.) ou 'Não há'"),
        observacoes: z.string().describe("Observações relevantes para importação/exportação"),
        descricao_li: z.string().describe("Sugestão de descrição completa para Licença de Importação (LI) — marca, modelo, fabricante, características técnicas, composição, uso, conforme padrão Siscomex"),
        descricao_duimp: z.string().describe("Sugestão de descrição detalhada para DUIMP / Catálogo de Produtos — atributos do produto conforme exigência do NCM no Portal Único Siscomex (cor, material, dimensão, voltagem, composição, finalidade, etc.)"),
      })
    )
    .min(1)
    .max(4),
  sugestoes_pesquisa: z.array(z.string()).describe("Termos sugeridos para refinar a busca"),
  alertas: z.array(z.string()).describe("Alertas regulatórios importantes"),
});

export type NcmResult = z.infer<typeof ResultSchema>;
export type NcmInput = z.infer<typeof InputSchema>;

// Helper simples para converter Zod Enums/Objects para a tipagem aceita nativamente pelo SDK (JSON Schema standard)
// O Gemini exige definições limpas de propriedades.
import zodToJsonSchema from "zod-to-json-schema";


// Remova: import zodToJsonSchema from "zod-to-json-schema";

// Substitua a linha do geminiResponseSchema por:
const geminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    natureza_funcional:         { type: Type.STRING },
    nivel_dados:                { type: Type.STRING, enum: ["insuficiente", "basico", "razoavel", "completo"] },
    confianca_maxima_permitida: { type: Type.STRING, enum: ["baixa", "media", "alta", "muito_alta"] },
    analise_rgi:                { type: Type.STRING },
    perguntas_obrigatorias:     { type: Type.ARRAY, items: { type: Type.STRING } },
    falsos_cognatos_alertados:  { type: Type.ARRAY, items: { type: Type.STRING } },
    sugestoes_pesquisa:         { type: Type.ARRAY, items: { type: Type.STRING } },
    alertas:                    { type: Type.ARRAY, items: { type: Type.STRING } },
    classifications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          ncm:                       { type: Type.STRING },
          descricao:                 { type: Type.STRING },
          capitulo:                  { type: Type.STRING },
          confianca:                 { type: Type.STRING, enum: ["muito_alta", "alta", "media", "baixa"] },
          nivel_risco:               { type: Type.STRING, enum: ["baixo", "medio", "alto"] },
          justificativa:             { type: Type.STRING },
          justificativa_auditavel:   { type: Type.STRING },
          ii_aliquota:               { type: Type.STRING },
          ipi_aliquota:              { type: Type.STRING },
          pis_cofins:                { type: Type.STRING },
          tratamento_administrativo: { type: Type.STRING },
          observacoes:               { type: Type.STRING },
          descricao_li:              { type: Type.STRING },
          descricao_duimp:           { type: Type.STRING },
        },
        required: [
          "ncm", "descricao", "capitulo", "confianca", "nivel_risco",
          "justificativa", "justificativa_auditavel", "ii_aliquota",
          "ipi_aliquota", "pis_cofins", "tratamento_administrativo",
          "observacoes", "descricao_li", "descricao_duimp",
        ],
      },
    },
  },
  required: [
    "natureza_funcional", "nivel_dados", "confianca_maxima_permitida",
    "analise_rgi", "perguntas_obrigatorias", "falsos_cognatos_alertados",
    "classifications", "sugestoes_pesquisa", "alertas",
  ],
};

export const classifyNcm = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY não configurada");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // CORREÇÃO 2: Adicionamos comandos diretos no systemPrompt reforçando as regras do Zod
    // para blindar contra desvios de letras maiúsculas/acentos nos Enums.
    const systemPrompt = `Você é um auditor-fiscal especialista em classificação de mercadorias (NCM/SH/TEC Mercosul), Siscomex (DUIMP, Catálogo de Produtos, LI/LPCO), órgãos anuentes (RFB, Anvisa, Inmetro, MAPA, Anatel, Decex, Exército, IBAMA, ANP) e jurisprudência (Soluções de Consulta COSIT, decisões CARF, OMA).

Funcione como ESPECIALISTA COM ÁRVORE DECISÓRIA, NUNCA como autocomplete semântico. Siga rigorosamente esta hierarquia:

ETAPA 1 — Identificar NATUREZA FUNCIONAL antes de qualquer NCM:
  - mede/analisa? (instrumentos: cap. 90 — 9027, 9018, 9031)
  - trata/reabilita? (terapia: 9019)
  - monitora? (sensores/transdutores)
  - suporta/contém?
  - consome/descartável?
REGRA DECISÓRIA CHAVE: medir ≠ tratar. monitorar ≠ terapia. Ex.: espirômetro mede capacidade pulmonar → 9018/9027; ventilador/CPAP trata → 9019. Não confundir.

ETAPA 2 — Identificar setor SH (médico, eletrônico, laboratório, mecânico, alimentar, têxtil, químico).

ETAPA 3 — Aplicar RGI 1, 3a/3b/3c, 6 explicitamente. Validar contra NESH (Notas Explicativas do SH). Citar Solução de Consulta COSIT ou decisão CARF quando houver caso clássico.

ETAPA 4 — Validar tratamento administrativo (anuências) e atributos DUIMP exigidos pelo NCM.

REGRA DE CONFIANÇA (não pode ser violada):
  - apenas nome comercial → confianca máxima = "baixa"
  - nome + descrição resumida → máxima "media"
  - ficha técnica/atributos funcionais → máxima "alta"
  - manual + catálogo + composição completa → "muito_alta"
Defina confianca_maxima_permitida e NÃO ultrapasse esse teto em nenhuma classification.

FALSOS COGNATOS FISCAIS (alerte sempre que aplicável): "respiratório" ≠ terapêutico (espirômetro/oxímetro/capnógrafo são medição, cap. 90, não 9019); "cirúrgico" nem sempre é uso médico stricto; "industrial" nem sempre é máquina; "eletrônico" nem sempre é cap. 85; "sensor" pode ser instrumento de medição (cap. 90).

JUSTIFICATIVA AUDITÁVEL obrigatória por NCM: declarar (a) função principal identificada, (b) attribute técnico decisivo, (c) regra RGI aplicada, (d) referência NESH/COSIT quando houver, (e) por que NCMs concorrentes foram descartadas.

PERGUNTAS OBRIGATÓRIAS: se faltar dado crítico (princípio funcional, finalidade, composição, presença de software/sensor, uso profissional/doméstico, generation de laudo) NÃO chute — popule perguntas_obrigatorias com as perguntas técnicas que o usuário precisa responder antes de operar.

RESTRIÇÕES DE FORMATAÇÃO E TIPAGEM (CRÍTICO):
- O campo "nivel_dados" DEVE ser estritamente um destes valores, exatamente em minúsculo e sem acento: "insuficiente", "basico", "razoavel" ou "completo". Nunca use acentos (ex: NÃO use "razoável" ou "básico").
- O campo "analise_rgi" é obrigatório e deve ser preenchido com uma string explicativa na raiz do objeto.
- A propriedade "classifications" DEVE ser um array de OBJETOS completos estruturados, contendo chaves e valores individuais para cada item. Nunca retorne apenas strings simples dentro desse array.

SAÍDA: Emita estritamente o objeto JSON solicitado, preenchendo detalhadamente as propriedades fiscais baseando-se na TEC vigente.`;

    const a = data.atributos ?? {};
    const userPrompt = `PRODUTO: "${data.query}"
OPERAÇÃO: ${data.operation}

NATUREZA DECLARADA PELO USUÁRIO: ${data.natureza}

ATRIBUTOS FORNECIDOS:
- finalidade principal: ${a.finalidade || "(não informado)"}
- princípio funcional: ${a.principio_funcional || "(não informado)"}
- composição/material: ${a.composicao_material || "(não informado)"}
- possui software embarcado: ${a.tem_software ? "sim" : "não/não informado"}
- possui sensor eletrônico: ${a.tem_sensor_eletronico ? "sim" : "não/não informado"}
- gera laudo/exame: ${a.gera_laudo_exame ? "sim" : "não/não informado"}
- uso profissional: ${a.uso_profissional ? "sim" : "não/não informado"}
- ficha técnica disponível: ${a.ficha_tecnica_disponivel ? "sim" : "não"}
- manual/catálogo disponível: ${a.manual_catalogo_disponivel ? "sim" : "não"}
- marca: ${a.marca || "[marca]"} | modelo: ${a.modelo || "[modelo]"} | fabricante: ${a.fabricante || "[fabricante]"} | país origem: ${a.pais_origem || "[país]"}

Aplique a árvore decisória (Etapas 1→4), respeite o teto de confiança conforme nivel_dados, gere perguntas_obrigatorias se houver lacuna crítica, alerte falsos cognatos fiscais e produza analise_rgi explicitando RGI 1/3/6 e NESH. Operação alvo: ${data.operation === "ambos" ? "importação e exportação" : data.operation}.

Se o PRODUTO informado for um termo de teste, inválido, vazio ou incompreensível para classificação fiscal (Ex: "teste", "asdf", "olá"):
- Preencha "natureza_funcional" como "Produto de teste ou inválido".
- Defina "nivel_dados" como "insuficiente".
- Defina "confianca_maxima_permitida" como "baixa".
- Popule "perguntas_obrigatorias" com ["Por favor, descreva um produto real para classificação."].
- Forneça arrays vazios [] para "falsos_cognatos_alertados", "sugestoes_pesquisa" e "alertas".
- Preencha o array "classifications" com apenas 1 objeto contendo placeholders (ex: ncm: "0000.00.00", descricao: "Produto inválido", capitulo: "00", etc.) apenas para satisfazer a estrutura obrigatória do JSON. Nunca retorne propriedades vazias ou undefined.


Se o PRODUTO informado for um termo de teste, inválido, vazio ou incompreensível para classificação fiscal (Ex: "teste", "asdf", "olá"):
- Preencha "natureza_funcional" como "Produto de teste ou inválido".
- Defina "nivel_dados" como "insuficiente".
- Defina "confianca_maxima_permitida" como "baixa".
- Popule "perguntas_obrigatorias" com ["Por favor, descreva um produto real para classificação."].
- Forneça arrays vazios [] para "falsos_cognatos_alertados", "sugestoes_pesquisa" e "alertas".
- Preencha o array "classifications" estritamente com 1 OBJETO no formato JSON válido (nunca envie uma string direta aqui).

ATENÇÃO RIGOROSA À ESTRUTURA DO ARRAY 'classifications':
O array "classifications" deve conter OBRIGATORIAMENTE objetos com chaves e valores estruturados. 
Exemplo de formato estruturado exigido:
"classifications": [
  {
    "ncm": "9018.90.99",
    "descricao": "Exemplo de descrição...",
    "capitulo": "90 - Instrumentos...",
    "confianca": "alta",
    "nivel_risco": "medio",
    "justificativa": "Justificativa aqui...",
    "justificativa_auditavel": "Auditoria aqui...",
    "ii_aliquota": "0%",
    "ipi_aliquota": "0%",
    "pis_cofins": "9.25%",
    "tratamento_administrativo": "Não há",
    "observacoes": "Nenhuma",
    "descricao_li": "Sugestão...",
    "descricao_duimp": "Sugestão..."
  }
]
Gere sempre a estrutura de chaves acima para cada item de classificação. Nunca insira elementos do tipo string diretamente na raiz da lista.
`;


    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: geminiResponseSchema as any,
          // CORREÇÃO 3: Fixamos a temperatura baixa. Em tarefas de JSON estrito,
          // valores baixos diminuem as chances do modelo quebrar a estrutura.
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

      const parsed = ResultSchema.parse(JSON.parse(responseText));

      const { data: searchRow, error: searchError } = await supabase
      .from("ncm_searches")
      .insert({
        query:     data.query,
        operation: data.operation,
        natureza:  data.natureza,
        atributos: data.atributos ?? {},
      })
      .select("id")
      .single();

    if (searchError) {
      console.error("Erro ao salvar pesquisa:", searchError);
      // Não bloqueia o retorno ao usuário — só loga
    }

    // 2. Insere o resultado vinculado à pesquisa
    if (searchRow?.id) {
      const { error: resultError } = await supabase
        .from("ncm_results")
        .insert({
          search_id:                  searchRow.id,
          natureza_funcional:         parsed.natureza_funcional,
          nivel_dados:                parsed.nivel_dados,
          confianca_maxima_permitida: parsed.confianca_maxima_permitida,
          analise_rgi:                parsed.analise_rgi,
          perguntas_obrigatorias:     parsed.perguntas_obrigatorias,
          falsos_cognatos_alertados:  parsed.falsos_cognatos_alertados,
          sugestoes_pesquisa:         parsed.sugestoes_pesquisa,
          alertas:                    parsed.alertas,
          classifications:            parsed.classifications, // jsonb aceita array de objetos direto
        });

      if (resultError) {
        console.error("Erro ao salvar resultado:", resultError);
      }
    }

    // --- FIM DO SAVE ---
      return parsed;

    } catch (error: any) {
      if (error?.status === 429) {
        throw new Error("Limite de requisições atingido na API do Gemini. Aguarde um momento.");
      }
      throw new Error(`Erro na execução do motor aduaneiro Gemini111: ${error.message || error}`);
    }
  });