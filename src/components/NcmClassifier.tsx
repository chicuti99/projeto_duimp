import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  AlertTriangle,
  Lightbulb,
  FileBadge2,
  ShieldCheck,
  Sparkles,
  Copy,
  FileText,
  HelpCircle,
  GitBranch,
  Gauge,
  Upload,
  X,
} from "lucide-react";
import { classifyNcm, type NcmResult } from "@/lib/ncm.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Modal,
  ModalOverlay,
  Dialog,
} from "@/components/application/modals/modal";

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
  {
    value: "medicao_analise",
    label: "Medição / análise",
    hint: "Ex.: espirômetro, oxímetro, balança",
  },
  {
    value: "terapia",
    label: "Terapia / tratamento",
    hint: "Ex.: ventilador, CPAP",
  },
  {
    value: "reabilitacao",
    label: "Reabilitação",
    hint: "Ex.: incentivador respiratório",
  },
  {
    value: "monitoramento",
    label: "Monitoramento",
    hint: "Sensores, transdutores",
  },
  {
    value: "consumo_descartavel",
    label: "Consumo / descartável",
    hint: "Bocal, filtro, seringa",
  },
  {
    value: "acessorio",
    label: "Acessório / parte",
    hint: "Sensor avulso, peça",
  },
  {
    value: "alimento_bebida",
    label: "Alimento / bebida",
    hint: "Cap. 04 a 22",
  },
  {
    value: "vestuario_textil",
    label: "Vestuário / têxtil",
    hint: "Cap. 50 a 63",
  },
  {
    value: "eletronico_consumo",
    label: "Eletrônico de consumo",
    hint: "Cap. 84/85",
  },
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

type NcmAttachment = {
  name: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  data: string;
  size: number;
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

const MAX_ATTACHMENTS = 2;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ATTRIBUTE_LIMITS: Partial<Record<keyof Atributos, number>> = {
  finalidade: 300,
  principio_funcional: 300,
  composicao_material: 300,
  marca: 120,
  modelo: 120,
  fabricante: 160,
  pais_origem: 80,
} satisfies Partial<Record<keyof Atributos, number>>;
const SUPPORTED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function isSupportedAttachmentType(
  type: string,
): type is NcmAttachment["mimeType"] {
  return SUPPORTED_ATTACHMENT_TYPES.includes(type as NcmAttachment["mimeType"]);
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Arquivo sem conteúdo legível."));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

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

function normalizeAtributos(atributos: Atributos): Atributos {
  return {
    ...atributos,
    finalidade: atributos.finalidade
      .trim()
      .slice(0, ATTRIBUTE_LIMITS.finalidade),
    principio_funcional: atributos.principio_funcional
      .trim()
      .slice(0, ATTRIBUTE_LIMITS.principio_funcional),
    composicao_material: atributos.composicao_material
      .trim()
      .slice(0, ATTRIBUTE_LIMITS.composicao_material),
    marca: atributos.marca.trim().slice(0, ATTRIBUTE_LIMITS.marca),
    modelo: atributos.modelo.trim().slice(0, ATTRIBUTE_LIMITS.modelo),
    fabricante: atributos.fabricante
      .trim()
      .slice(0, ATTRIBUTE_LIMITS.fabricante),
    pais_origem: atributos.pais_origem
      .trim()
      .slice(0, ATTRIBUTE_LIMITS.pais_origem),
  };
}

export function NcmClassifier() {
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<
    "importacao" | "exportacao" | "ambos"
  >("ambos");
  const [natureza, setNatureza] = useState<Natureza>("nao_sei");
  const [atributos, setAtributos] = useState<Atributos>(ATRIBUTOS_INICIAIS);
  const [showAtributos, setShowAtributos] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [confirmedWithoutAttributes, setConfirmedWithoutAttributes] =
    useState(false);
  const [attachments, setAttachments] = useState<NcmAttachment[]>([]);
  const [isReadingAttachment, setIsReadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const fn = useServerFn(classifyNcm);

  const mutation = useMutation({
    mutationFn: (q: string) => {
      return fn({
        data: {
          query: q,
          operation,
          natureza,
          atributos: normalizeAtributos(atributos),
          anexos: attachments.map(({ name, mimeType, data }) => ({
            name,
            mimeType,
            data,
          })),
        },
      });
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

  const handleAttachmentFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const availableSlots = MAX_ATTACHMENTS - attachments.length;
    if (availableSlots <= 0) {
      toast.error("Você pode anexar no máximo 2 arquivos.");
      return;
    }

    const selectedFiles = Array.from(files).slice(0, availableSlots);
    if (files.length > availableSlots) {
      toast.warning(`Apenas ${availableSlots} arquivo(s) foram adicionados.`);
    }

    setIsReadingAttachment(true);
    try {
      const nextAttachments: NcmAttachment[] = [];

      for (const file of selectedFiles) {
        if (!isSupportedAttachmentType(file.type)) {
          toast.error(`Formato não suportado: ${file.name}`, {
            description: "Use PDF, JPG, PNG ou WEBP.",
          });
          continue;
        }

        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error(`Arquivo muito grande: ${file.name}`, {
            description: `Limite de ${formatFileSize(MAX_ATTACHMENT_BYTES)} por arquivo.`,
          });
          continue;
        }

        nextAttachments.push({
          name: file.name,
          mimeType: file.type,
          data: await readFileAsBase64(file),
          size: file.size,
        });
      }

      if (nextAttachments.length) {
        setAttachments((current) => [...current, ...nextAttachments]);
        toast.success(`${nextAttachments.length} anexo(s) adicionado(s)`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao ler anexo",
      );
    } finally {
      setIsReadingAttachment(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, i) => i !== index));
  };

  const submit = (q: string, forceWithoutContext = false) => {
    const hasTechnicalAttribute = Object.keys(atributos).some(
      (k) =>
        atributos[k as keyof Atributos] !==
        ATRIBUTOS_INICIAIS[k as keyof Atributos],
    );

    const hasAdditionalContext =
      hasTechnicalAttribute || attachments.length > 0;

    if (
      !hasAdditionalContext &&
      !confirmedWithoutAttributes &&
      !forceWithoutContext
    ) {
      setShowModal(true);
      return;
    }
    setConfirmedWithoutAttributes(false);
    setQuery(q);
    mutation.mutate(q);
  };

  const toggleAttr = (k: keyof Atributos) => (v: boolean | string) =>
    setAtributos((p) => ({
      ...p,
      [k]:
        typeof v === "string" && ATTRIBUTE_LIMITS[k]
          ? v.slice(0, ATTRIBUTE_LIMITS[k])
          : (v as never),
    }));

  return (
    <div className="w-full max-w-5xl mx-auto">
      <Card className="p-6 md:p-8 shadow-[var(--shadow-elegant)] border-border/60">
        <div className="flex flex-col gap-4">
          <Tabs
            value={operation}
            onValueChange={(v) => setOperation(v as typeof operation)}
          >
            <TabsList className="bg-secondary">
              <TabsTrigger value="ambos">Ambos</TabsTrigger>
              <TabsTrigger value="importacao">Importação</TabsTrigger>
              <TabsTrigger value="exportacao">Exportação</TabsTrigger>
            </TabsList>
          </Tabs>

          <div>
            <label className="text-sm font-medium mb-2 block">
              1. Natureza funcional do produto{" "}
              <span className="text-muted-foreground font-normal">
                (define o capítulo SH antes do NCM)
              </span>
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
                  {n.hint && (
                    <div className="text-muted-foreground mt-0.5">{n.hint}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(query);
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Descreva o produto (ex: fone de ouvido bluetooth, óleo de soja refinado...)"
                  className="w-full h-14 pl-11 pr-4 rounded-lg border border-input bg-background text-base focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={
                  mutation.isPending || isReadingAttachment || query.length < 2
                }
                className="h-14 px-8 text-base"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                    Classificando…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Classificar com IA
                  </>
                )}
              </Button>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <Upload className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      Anexos de contexto
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Até 2 arquivos PDF ou imagem para a IA ler ficha técnica,
                      rótulo, catálogo ou foto do produto.
                    </div>
                  </div>
                </div>

                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleAttachmentFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    mutation.isPending ||
                    isReadingAttachment ||
                    attachments.length >= MAX_ATTACHMENTS
                  }
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  {isReadingAttachment ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Anexar arquivo
                </Button>
              </div>

              {attachments.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {attachments.map((attachment, index) => (
                    <div
                      key={`${attachment.name}-${index}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {attachment.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {attachment.mimeType} ·{" "}
                          {formatFileSize(attachment.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        onClick={() => removeAttachment(index)}
                        disabled={mutation.isPending}
                        aria-label={`Remover ${attachment.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showModal && (
              <ModalOverlay isOpen={true} onOpenChange={setShowModal}>
                <Modal>
                  <Dialog>
                    <div className="w-[420px] rounded-xl bg-white p-6 shadow-2xl">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Confirmar envio
                      </h2>

                      <p className="mt-3 text-sm leading-6 text-gray-600">
                        Nenhum atributo técnico foi preenchido para este
                        produto.
                        <br />
                        <br />
                        Deseja continuar apenas com a descrição informada?
                      </p>

                      <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-w-28"
                          onClick={() => {
                            setShowModal(false);
                          }}
                        >
                          Cancelar
                        </Button>

                        <Button
                          type="button"
                          className="min-w-28"
                          onClick={() => {
                            setShowModal(false);
                            setConfirmedWithoutAttributes(true);
                            submit(query, true);
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
            {showAtributos ? "− Ocultar" : "+ Adicionar"} atributos técnicos
            (eleva a confiança da classificação)
          </button>

          {showAtributos && (
            <div className="rounded-lg border border-border bg-secondary/30 p-4 grid md:grid-cols-2 gap-3 text-sm">
              <TextAttr
                label="Finalidade principal"
                value={atributos.finalidade}
                onChange={(v) => toggleAttr("finalidade")(v)}
                maxLength={ATTRIBUTE_LIMITS.finalidade}
                placeholder="ex.: medir capacidade pulmonar"
              />
              <TextAttr
                label="Princípio funcional"
                value={atributos.principio_funcional}
                onChange={(v) => toggleAttr("principio_funcional")(v)}
                maxLength={ATTRIBUTE_LIMITS.principio_funcional}
                placeholder="ex.: turbina + sensor de fluxo"
              />
              <TextAttr
                label="Composição / material"
                value={atributos.composicao_material}
                onChange={(v) => toggleAttr("composicao_material")(v)}
                maxLength={ATTRIBUTE_LIMITS.composicao_material}
                placeholder="ex.: ABS + eletrônica"
              />
              <TextAttr
                label="Marca"
                value={atributos.marca}
                onChange={(v) => toggleAttr("marca")(v)}
                maxLength={ATTRIBUTE_LIMITS.marca}
              />
              <TextAttr
                label="Modelo"
                value={atributos.modelo}
                onChange={(v) => toggleAttr("modelo")(v)}
                maxLength={ATTRIBUTE_LIMITS.modelo}
              />
              <TextAttr
                label="Fabricante"
                value={atributos.fabricante}
                onChange={(v) => toggleAttr("fabricante")(v)}
                maxLength={ATTRIBUTE_LIMITS.fabricante}
              />
              <TextAttr
                label="País de origem"
                value={atributos.pais_origem}
                onChange={(v) => toggleAttr("pais_origem")(v)}
                maxLength={ATTRIBUTE_LIMITS.pais_origem}
              />
              <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                <BoolAttr
                  label="Possui software"
                  value={atributos.tem_software}
                  onChange={toggleAttr("tem_software")}
                />
                <BoolAttr
                  label="Possui sensor eletrônico"
                  value={atributos.tem_sensor_eletronico}
                  onChange={toggleAttr("tem_sensor_eletronico")}
                />
                <BoolAttr
                  label="Gera laudo / exame"
                  value={atributos.gera_laudo_exame}
                  onChange={toggleAttr("gera_laudo_exame")}
                />
                <BoolAttr
                  label="Uso profissional"
                  value={atributos.uso_profissional}
                  onChange={toggleAttr("uso_profissional")}
                />
                <BoolAttr
                  label="Tenho ficha técnica"
                  value={atributos.ficha_tecnica_disponivel}
                  onChange={toggleAttr("ficha_tecnica_disponivel")}
                />
                <BoolAttr
                  label="Tenho manual/catálogo"
                  value={atributos.manual_catalogo_disponivel}
                  onChange={toggleAttr("manual_catalogo_disponivel")}
                />
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
              <Stat
                label="Natureza funcional"
                value={result.natureza_funcional}
              />
              <Stat label="Qualidade dos dados" value={result.nivel_dados} />
              <Stat
                label="Teto de confiança permitido"
                value={result.confianca_maxima_permitida.replace("_", " ")}
              />
            </div>
            <div className="mt-4">
              <Row
                icon={<GitBranch className="h-4 w-4 text-primary" />}
                title="Análise hierárquica (RGI / NESH)"
                text={result.analise_rgi}
              />
            </div>
          </Card>

          {result.perguntas_obrigatorias.length > 0 && (
            <Card className="p-5 border-l-4 border-l-primary bg-primary/5">
              <div className="flex gap-3">
                <HelpCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-2">
                    Responda antes de operar com este NCM
                  </h3>
                  <ul className="space-y-1 text-sm text-foreground/80">
                    {result.perguntas_obrigatorias.map((p, i) => (
                      <li key={i}>• {p}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">
                    Preencha "atributos técnicos" acima e classifique novamente
                    para elevar a confiança.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {result.falsos_cognatos_alertados.length > 0 && (
            <Card className="p-5 border-l-4 border-l-accent bg-accent/5">
              <div className="flex gap-3">
                <Gauge className="h-5 w-5 text-accent-foreground shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-2">
                    Falsos cognatos fiscais detectados
                  </h3>
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
              <Card
                key={i}
                className="p-6 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elegant)] transition-shadow"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
                      <FileBadge2 className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold tracking-tight font-mono">
                        {c.ncm}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {c.capitulo}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={confidenceColor(c.confianca)}>
                      Confiança: {c.confianca.replace("_", " ")}
                    </Badge>
                    <Badge className={riskColor(c.nivel_risco)}>
                      Risco fiscal: {c.nivel_risco}
                    </Badge>
                  </div>
                </div>

                <p className="text-base mb-4">{c.descricao}</p>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  <Stat label="II (Imposto Importação)" value={c.ii_aliquota} />
                  <Stat label="IPI" value={c.ipi_aliquota} />
                  <Stat label="PIS/COFINS Imp." value={c.pis_cofins} />
                </div>

                <div className="space-y-3 text-sm">
                  <Row
                    icon={<Lightbulb className="h-4 w-4 text-accent" />}
                    title="Justificativa"
                    text={c.justificativa}
                  />
                  <Row
                    icon={<GitBranch className="h-4 w-4 text-primary" />}
                    title="Justificativa auditável (RGI/NESH/COSIT)"
                    text={c.justificativa_auditavel}
                  />
                  <Row
                    icon={<ShieldCheck className="h-4 w-4 text-primary" />}
                    title="Tratamento administrativo (Siscomex)"
                    text={c.tratamento_administrativo}
                  />
                  {c.observacoes && (
                    <Row
                      icon={
                        <FileBadge2 className="h-4 w-4 text-muted-foreground" />
                      }
                      title="Observações"
                      text={c.observacoes}
                    />
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-3 mt-5">
                  <DescBlock
                    label="Descrição sugerida — LI (Licença de Importação)"
                    text={c.descricao_li}
                  />
                  <DescBlock
                    label="Descrição sugerida — DUIMP / Catálogo de Produtos"
                    text={c.descricao_duimp}
                  />
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
            Resultado gerado por IA com base em diretrizes da TEC/Mercosul,
            Siscomex e legislação brasileira. Confirme sempre a classificação
            final na consulta oficial da Receita Federal e órgãos anuentes antes
            de operações reais.
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

function TextAttr({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const shouldShowCount = Boolean(maxLength && value.length > maxLength * 0.8);

  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        {shouldShowCount && (
          <span>
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function BoolAttr({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Checkbox checked={value} onCheckedChange={(v) => onChange(Boolean(v))} />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function Row({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
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
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          type="button"
        >
          <Copy className="h-3 w-3" /> Copiar
        </button>
      </div>
      <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {text}
      </p>
    </div>
  );
}
