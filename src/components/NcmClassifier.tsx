import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, AlertTriangle, Lightbulb, FileBadge2, ShieldCheck, Sparkles, Copy, FileText, HelpCircle, GitBranch, Gauge } from "lucide-react";
import { classifyNcm, type NcmResult } from "@/lib/ncm.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {Modal,ModalOverlay,Dialog} from "@/components/application/modals/modal"

const examples = [
  "Mouse óptico USB sem fio",
  "Café torrado em grãos",
  "Capacete para motociclista",
  "Suplemento alimentar em cápsulas (vitamina D)",
  "Bateria de íon-lítio para notebook",
  "Chocolate ao leite em barra 100g sem açúcar",
  "Espirômetro digital portátil com software",
];

const NATUREZAS: { value: Natureza; label: string; hint: string }[] = [
  { value: "nao_sei", label: "Ainda não sei", hint: "A IA vai te perguntar" },
  { value: "medicao_analise", label: "Medição / análise", hint: "Ex.: espirômetro, oxímetro, balança" },
  { value: "terapia", label: "Terapia / tratamento", hint: "Ex.: ventilador, CPAP" },
  { value: "reabilitacao", label: "Reabilitação", hint: "Ex.: incentivador respiratório" },
  { value: "monitoramento", label: "Monitoramento", hint: "Sensores, transdutores" },
  { value: "consumo_descartavel", label: "Consumo / descartável", hint: "Bocal, filtro, seringa" },
  { value: "acessorio", label: "Acessório / parte", hint: "Sensor avulso, peça" },
  { value: "alimento_bebida", label: "Alimento / bebida", hint: "Cap. 04 a 22" },
  { value: "vestuario_textil", label: "Vestuário / têxtil", hint: "Cap. 50 a 63" },
  { value: "eletronico_consumo", label: "Eletrônico de consumo", hint: "Cap. 84/85" },
  { value: "maquina_industrial", label: "Máquina industrial", hint: "Cap. 84" },
  { value: "quimico_insumo", label: "Químico / insumo", hint: "Cap. 28 a 39" },
  { value: "veiculo_parte", label: "Veículo / parte", hint: "Cap. 87" },
  { value: "outro", label: "Outro", hint: "" },
];

type Natureza =
  | "medicao_analise"
  | "terapia"
  | "reabilitacao"
  | "monitoramento"
  | "consumo_descartavel"
  | "acessorio"
  | "alimento_bebida"
  | "vestuario_textil"
  | "eletronico_consumo"
  | "maquina_industrial"
  | "quimico_insumo"
  | "veiculo_parte"
  | "outro"
  | "nao_sei";

type Atributos = {
  finalidade: string;
  principio_funcional: string;
  composicao_material: string;
  tem_software: boolean;
  tem_sensor_eletronico: boolean;
  gera_laudo_exame: boolean;
  uso_profissional: boolean;
  ficha_tecnica_disponivel: boolean;
  manual_catalogo_disponivel: boolean;
  marca: string;
  modelo: string;
  fabricante: string;
  pais_origem: string;
};

const ATRIBUTOS_INICIAIS: Atributos = {
  finalidade: "",
  principio_funcional: "",
  composicao_material: "",
  tem_software: false,
  tem_sensor_eletronico: false,
  gera_laudo_exame: false,
  uso_profissional: false,
  ficha_tecnica_disponivel: false,
  manual_catalogo_disponivel: false,
  marca: "",
  modelo: "",
  fabricante: "",
  pais_origem: "",
};

function confidenceColor(c: string) {
  if (c === "muito_alta") return "bg-accent text-accent-foreground";
  if (c === "alta") return "bg-accent text-accent-foreground";
  if (c === "media") return "bg-primary/15 text-primary";
  return "bg-muted text-muted-foreground";
}

function riskColor(r: string) {
  if (r === "alto") return "bg-destructive/15 text-destructive";
  if (r === "medio") return "bg-primary/10 text-primary";
  return "bg-muted text-muted-foreground";
}

export function NcmClassifier() {
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<"importacao" | "exportacao" | "ambos">("ambos");
  const [natureza, setNatureza] = useState<Natureza>("nao_sei");
  const [atributos, setAtributos] = useState<Atributos>(ATRIBUTOS_INICIAIS);
  const [showAtributos, setShowAtributos] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [confirmedWithoutAttributes, setConfirmedWithoutAttributes] = useState(false);
  const fn = useServerFn(classifyNcm);

  const mutation = useMutation({
    mutationFn: (q: string) => {
      
      return fn({ data: { query: q, operation, natureza, atributos } });
    },
    onSuccess: (data) => {
      console.log("sucesso1111:", data);
    },
    onError: (e: Error) => {
      console.error("erro completo:", e);
      toast.error(e.message ?? "Erro ao consultar");
    },
  });

  const result: NcmResult | undefined = mutation.data;

  const submit = (q: string) => {
    const hasTechnicalAttribute = Object.keys(atributos).some(
      (k) =>
        atributos[k as keyof Atributos] !==
        ATRIBUTOS_INICIAIS[k as keyof Atributos]
    );

    if (!hasTechnicalAttribute && !confirmedWithoutAttributes) {
      setShowModal(true);
      return;
    }
    setConfirmedWithoutAttributes(false);
    setQuery(q);
    mutation.mutate(q);
  };

  const toggleAttr = (k: keyof Atributos) => (v: boolean | string) =>
    setAtributos((p) => ({ ...p, [k]: v as never }));

  return (
    <div className="w-full max-w-5xl mx-auto">
      <Card className="p-6 md:p-8 shadow-[var(--shadow-elegant)] border-border/60">
        <div className="flex flex-col gap-4">
          <Tabs value={operation} onValueChange={(v) => setOperation(v as typeof operation)}>
            <TabsList className="bg-secondary">
              <TabsTrigger value="ambos">Ambos</TabsTrigger>
              <TabsTrigger value="importacao">Importação</TabsTrigger>
              <TabsTrigger value="exportacao">Exportação</TabsTrigger>
            </TabsList>
          </Tabs>

          <div>
            <label className="text-sm font-medium mb-2 block">
              1. Natureza funcional do produto <span className="text-muted-foreground font-normal">(define o capítulo SH antes do NCM)</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {NATUREZAS.map((n) => (
                <button
                  key={n.value}
                  type="button"
                  onClick={() => setNatureza(n.value)}
                  className={`text-left rounded-lg border p-2.5 text-xs transition-colors ${
                    natureza === n.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/40 hover:bg-secondary"
                  }`}
                >
                  <div className="font-medium">{n.label}</div>
                  {n.hint && <div className="text-muted-foreground mt-0.5">{n.hint}</div>}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(query);
            }}
            className="flex flex-col md:flex-row gap-3"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Descreva o produto (ex: fone de ouvido bluetooth, óleo de soja refinado...)"
                className="w-full h-14 pl-11 pr-4 rounded-lg border border-input bg-background text-base focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button type="submit" size="lg" disabled={mutation.isPending || query.length < 2} className="h-14 px-8 text-base">
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Classificando…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Classificar com IA
                </>
              )}
            </Button>

              {showModal && (
                <ModalOverlay
                  isOpen={true}
                  onOpenChange={setShowModal}
                >
                  <Modal>
                    <Dialog>
                      <div className="w-[420px] rounded-xl bg-white p-6 shadow-2xl">
                        <h2 className="text-lg font-semibold text-gray-900">
                          Confirmar envio
                        </h2>

                        <p className="mt-3 text-sm leading-6 text-gray-600">
                          Nenhum atributo técnico foi preenchido para este produto.
                          <br />
                          <br />
                          Deseja continuar apenas com a descrição informada?
                        </p>

                        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
                          <Button
                            variant="outline"
                            className="min-w-28"
                            onClick={() => {
                              setShowModal(false);
                            }}
                          >
                            Cancelar
                          </Button>

                          <Button
                            className="min-w-28"
                            onClick={() => {
                              setShowModal(false);
                              setConfirmedWithoutAttributes(true);
                              submit(query);
                            }}
                          >
                            Confirmar
                          </Button>
                        </div>
                      </div>
                    </Dialog>
                  </Modal>
                </ModalOverlay>
              )}

          </form>

          <button
            type="button"
            onClick={() => setShowAtributos((s) => !s)}
            className="text-sm text-primary hover:underline self-start"
          >
            {showAtributos ? "− Ocultar" : "+ Adicionar"} atributos técnicos (eleva a confiança da classificação)
          </button>

          {showAtributos && (
            <div className="rounded-lg border border-border bg-secondary/30 p-4 grid md:grid-cols-2 gap-3 text-sm">
              <TextAttr label="Finalidade principal" value={atributos.finalidade} onChange={(v) => toggleAttr("finalidade")(v)} placeholder="ex.: medir capacidade pulmonar" />
              <TextAttr label="Princípio funcional" value={atributos.principio_funcional} onChange={(v) => toggleAttr("principio_funcional")(v)} placeholder="ex.: turbina + sensor de fluxo" />
              <TextAttr label="Composição / material" value={atributos.composicao_material} onChange={(v) => toggleAttr("composicao_material")(v)} placeholder="ex.: ABS + eletrônica" />
              <TextAttr label="Marca" value={atributos.marca} onChange={(v) => toggleAttr("marca")(v)} />
              <TextAttr label="Modelo" value={atributos.modelo} onChange={(v) => toggleAttr("modelo")(v)} />
              <TextAttr label="Fabricante" value={atributos.fabricante} onChange={(v) => toggleAttr("fabricante")(v)} />
              <TextAttr label="País de origem" value={atributos.pais_origem} onChange={(v) => toggleAttr("pais_origem")(v)} />
              <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                <BoolAttr label="Possui software" value={atributos.tem_software} onChange={toggleAttr("tem_software")} />
                <BoolAttr label="Possui sensor eletrônico" value={atributos.tem_sensor_eletronico} onChange={toggleAttr("tem_sensor_eletronico")} />
                <BoolAttr label="Gera laudo / exame" value={atributos.gera_laudo_exame} onChange={toggleAttr("gera_laudo_exame")} />
                <BoolAttr label="Uso profissional" value={atributos.uso_profissional} onChange={toggleAttr("uso_profissional")} />
                <BoolAttr label="Tenho ficha técnica" value={atributos.ficha_tecnica_disponivel} onChange={toggleAttr("ficha_tecnica_disponivel")} />
                <BoolAttr label="Tenho manual/catálogo" value={atributos.manual_catalogo_disponivel} onChange={toggleAttr("manual_catalogo_disponivel")} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Exemplos:</span>
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => submit(ex)}
                className="text-primary hover:underline"
                type="button"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {result && (
        <div className="mt-8 space-y-6">
          <Card className="p-5">
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <Stat label="Natureza funcional" value={result.natureza_funcional} />
              <Stat label="Qualidade dos dados" value={result.nivel_dados} />
              <Stat label="Teto de confiança permitido" value={result.confianca_maxima_permitida.replace("_", " ")} />
            </div>
            <div className="mt-4">
              <Row icon={<GitBranch className="h-4 w-4 text-primary" />} title="Análise hierárquica (RGI / NESH)" text={result.analise_rgi} />
            </div>
          </Card>

          {result.perguntas_obrigatorias.length > 0 && (
            <Card className="p-5 border-l-4 border-l-primary bg-primary/5">
              <div className="flex gap-3">
                <HelpCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-2">Responda antes de operar com este NCM</h3>
                  <ul className="space-y-1 text-sm text-foreground/80">
                    {result.perguntas_obrigatorias.map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">Preencha "atributos técnicos" acima e classifique novamente para elevar a confiança.</p>
                </div>
              </div>
            </Card>
          )}

          {result.falsos_cognatos_alertados.length > 0 && (
            <Card className="p-5 border-l-4 border-l-accent bg-accent/5">
              <div className="flex gap-3">
                <Gauge className="h-5 w-5 text-accent-foreground shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-2">Falsos cognatos fiscais detectados</h3>
                  <ul className="space-y-1 text-sm text-foreground/80">
                    {result.falsos_cognatos_alertados.map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {result.alertas.length > 0 && (
            <Card className="p-5 border-l-4 border-l-destructive bg-destructive/5">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-2">Alertas regulatórios</h3>
                  <ul className="space-y-1 text-sm text-foreground/80">
                    {result.alertas.map((a, i) => (
                      <li key={i}>• {a}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <div className="grid gap-4">
            {result.classifications.map((c, i) => (
              <Card key={i} className="p-6 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elegant)] transition-shadow">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
                      <FileBadge2 className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold tracking-tight font-mono">{c.ncm}</div>
                      <div className="text-sm text-muted-foreground">{c.capitulo}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={confidenceColor(c.confianca)}>Confiança: {c.confianca.replace("_", " ")}</Badge>
                    <Badge className={riskColor(c.nivel_risco)}>Risco fiscal: {c.nivel_risco}</Badge>
                  </div>
                </div>

                <p className="text-base mb-4">{c.descricao}</p>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  <Stat label="II (Imposto Importação)" value={c.ii_aliquota} />
                  <Stat label="IPI" value={c.ipi_aliquota} />
                  <Stat label="PIS/COFINS Imp." value={c.pis_cofins} />
                </div>

                <div className="space-y-3 text-sm">
                  <Row icon={<Lightbulb className="h-4 w-4 text-accent" />} title="Justificativa" text={c.justificativa} />
                  <Row icon={<GitBranch className="h-4 w-4 text-primary" />} title="Justificativa auditável (RGI/NESH/COSIT)" text={c.justificativa_auditavel} />
                  <Row icon={<ShieldCheck className="h-4 w-4 text-primary" />} title="Tratamento administrativo (Siscomex)" text={c.tratamento_administrativo} />
                  {c.observacoes && <Row icon={<FileBadge2 className="h-4 w-4 text-muted-foreground" />} title="Observações" text={c.observacoes} />}
                </div>

                <div className="grid md:grid-cols-2 gap-3 mt-5">
                  <DescBlock label="Descrição sugerida — LI (Licença de Importação)" text={c.descricao_li} />
                  <DescBlock label="Descrição sugerida — DUIMP / Catálogo de Produtos" text={c.descricao_duimp} />
                </div>
              </Card>
            ))}
          </div>

          {result.sugestoes_pesquisa.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" /> Refinar pesquisa
              </h3>
              <div className="flex flex-wrap gap-2">
                {result.sugestoes_pesquisa.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="px-3 py-1.5 rounded-full border border-border bg-secondary hover:bg-primary hover:text-primary-foreground text-sm transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Card>
          )}

          <p className="text-xs text-muted-foreground text-center px-4">
            Resultado gerado por IA com base em diretrizes da TEC/Mercosul, Siscomex e legislação brasileira. Confirme sempre a classificação final na consulta oficial da Receita Federal e órgãos anuentes antes de operações reais.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold text-foreground capitalize">{value}</div>
    </div>
  );
}

function TextAttr({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function BoolAttr({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Checkbox checked={value} onCheckedChange={(v) => onChange(Boolean(v))} />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function Row({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground">{text}</div>
      </div>
    </div>
  );
}

function DescBlock({ label, text }: { label: string; text: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Descrição copiada");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <FileText className="h-3.5 w-3.5 text-primary" /> {label}
        </div>
        <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" type="button">
          <Copy className="h-3 w-3" /> Copiar
        </button>
      </div>
      <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}