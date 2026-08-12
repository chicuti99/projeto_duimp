import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Coins,
  Edit3,
  FileDown,
  Landmark,
  Loader2,
  Menu,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Table2,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  lookupNcmTributos,
  type NcmTributoLookup,
} from "@/lib/ncm-tributos.functions";
import {
  createSimulacaoCustoItem,
  updateSimulacaoCustoItem,
} from "@/lib/simulacao-custos.functions";
import { lookupIcmsInterestadual } from "@/lib/icms-interestadual.functions";
import { fetchCambio } from "@/lib/cambio.functions";
import { exportSimulacaoIpiXlsx } from "@/lib/simulacao-ipi-export.functions";
import { suggestNcmByProductName } from "@/lib/ncm-suggest.functions";

type SimNao = "sim" | "nao";

type ApuracaoFiscal = "lucro_real" | "lucro_presumido";
type DestinadoA = "revenda" | "ativo_fixo" | "industrializacao";
type FreteInternoPorConta = "emitente" | "destinatario";
type UnidadeMedida = "unidade" | "peso" | "metro" | "caixa" | "m2" | "m3";
type Incoterm =
  | "FOB"
  | "CIF"
  | "CFR"
  | "EXW"
  | "FCA"
  | "CPT"
  | "CIP"
  | "DAP"
  | "DDP";

type SimulacaoHeader = {
  identificacao: string;
  processo: string;
  destinoCliente: string;
  ufDestino: string;
  di: string;
  incoterm: Incoterm;
  operacaoBeneficiada: SimNao;
  destinoUf: string;
  contribuinteIcms: SimNao;
  contribuinteIpi: SimNao;
  apuracaoFiscal: ApuracaoFiscal;
  possuiSubstituicaoTributaria: SimNao;
  destinadoA: DestinadoA;
  portoAeroporto: string;
  beneficio: string;
  quantidade: string;
  freteInternoPorConta: FreteInternoPorConta;
  unidadeMedida: UnidadeMedida;
  qtdeContainer: string;
};

type CostItem = {
  id: string;
  // id da linha em simulacao_custos_itens no Supabase, quando o item já foi
  // persistido — undefined pra itens que só existem localmente ainda.
  dbId?: string;
  nomeProduto: string;
  contribuinteIcms: SimNao;
  contribuinteIpi: SimNao;
  ncm: string;
  ii: string;
  ipi: string;
  pis: string;
  cofins: string;
  icms: string;
  antidumping: string;
  peso: string;
  quantidade: string;
  fobUnit: string;
  frete: string;
  seguro: string;
  expanded: boolean;
};

type DespesaLine = {
  id: string;
  label: string;
  value: string;
  isPercentual?: boolean;
  fixed?: boolean;
};

const STORAGE_KEY = "fc-simulacao-custos-items";
const HEADER_STORAGE_KEY = "fc-simulacao-custos-header";
const DEFAULT_PIS = "2,10";
const DEFAULT_COFINS = "9,65";

const UFS = [
  { value: "AC", label: "AC — Acre" },
  { value: "AL", label: "AL — Alagoas" },
  { value: "AP", label: "AP — Amapá" },
  { value: "AM", label: "AM — Amazonas" },
  { value: "BA", label: "BA — Bahia" },
  { value: "CE", label: "CE — Ceará" },
  { value: "DF", label: "DF — Distrito Federal" },
  { value: "ES", label: "ES — Espírito Santo" },
  { value: "GO", label: "GO — Goiás" },
  { value: "MA", label: "MA — Maranhão" },
  { value: "MT", label: "MT — Mato Grosso" },
  { value: "MS", label: "MS — Mato Grosso do Sul" },
  { value: "MG", label: "MG — Minas Gerais" },
  { value: "PA", label: "PA — Pará" },
  { value: "PB", label: "PB — Paraíba" },
  { value: "PR", label: "PR — Paraná" },
  { value: "PE", label: "PE — Pernambuco" },
  { value: "PI", label: "PI — Piauí" },
  { value: "RJ", label: "RJ — Rio de Janeiro" },
  { value: "RN", label: "RN — Rio Grande do Norte" },
  { value: "RS", label: "RS — Rio Grande do Sul" },
  { value: "RO", label: "RO — Rondônia" },
  { value: "RR", label: "RR — Roraima" },
  { value: "SC", label: "SC — Santa Catarina" },
  { value: "SP", label: "SP — São Paulo" },
  { value: "SE", label: "SE — Sergipe" },
  { value: "TO", label: "TO — Tocantins" },
] as const;

const DEFAULT_HEADER: SimulacaoHeader = {
  identificacao: "",
  processo: "",
  destinoCliente: "",
  ufDestino: "",
  di: "",
  incoterm: "FOB",
  operacaoBeneficiada: "nao",
  destinoUf: "",
  contribuinteIcms: "sim",
  contribuinteIpi: "sim",
  apuracaoFiscal: "lucro_real",
  possuiSubstituicaoTributaria: "nao",
  destinadoA: "revenda",
  portoAeroporto: "",
  beneficio: "invest",
  quantidade: "",
  freteInternoPorConta: "emitente",
  unidadeMedida: "unidade",
  qtdeContainer: "",
};

// Linhas de despesa da aba "Demonstrativo Importação" (H41:H69 do
// modelo). A lista abaixo é fixa (rótulo e existência não são editáveis
// pelo usuário) — só o valor de cada linha é preenchível. O botão
// "Adicionar despesa" ainda permite incluir linhas extras, que aí sim
// ficam com rótulo editável e removível. A soma vira o "Despesas de
// nacionalização" usado na Rateio Produto e na IPI (equivalente a H70
// do original).
const DEFAULT_DESPESA_LINES: Omit<DespesaLine, "id">[] = [
  { label: "Taxa Scanner Porto", value: "296,27", fixed: true },
  { label: "Taxa Siscomex", value: "154,23", fixed: true },
  { label: "AFRMM", value: "8,00", isPercentual: true, fixed: true },
  { label: "Taxa segregação Porto", value: "542,85", fixed: true },
  { label: "Despachante Aduaneiro", value: "1621,00", fixed: true },
  { label: "S.D.A", value: "662,00", fixed: true },
  { label: "Armazenagem GDL", value: "1112,27", fixed: true },
  { label: "Movimentação Handling In/OU", value: "285,00", fixed: true },
  { label: "ISS 5%", value: "166,58", fixed: true },
  { label: "TRANSPORTE NACIONAL DTC", value: "1600,00", fixed: true },
  { label: "Taxas Armador na origem", value: "2600,00", fixed: true },
  { label: "Taxas Armador no destino", value: "2625,00", fixed: true },
  { label: "Licença de importação", value: "70,00", fixed: true },
  { label: "Desova paletizada", value: "1190,00", fixed: true },
  { label: "Handling Destination", value: "0,00", fixed: true },
  { label: "ISPS", value: "0,00", fixed: true },
  { label: "Taxa administrativa", value: "9000,00", fixed: true },
  { label: "TRS", value: "0,00", fixed: true },
  { label: "THC", value: "0,00", fixed: true },
];

const EMPTY_ITEM: Omit<CostItem, "id" | "expanded"> = {
  nomeProduto: "",
  contribuinteIcms: "sim",
  contribuinteIpi: "sim",
  ncm: "",
  ii: "",
  ipi: "",
  pis: DEFAULT_PIS,
  cofins: DEFAULT_COFINS,
  icms: "",
  antidumping: "",
  peso: "",
  quantidade: "",
  fobUnit: "",
  frete: "",
  seguro: "",
};

export const Route = createFileRoute("/simulacao-custos")({
  component: SimulacaoCustosPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Simulação de Custos" },
      {
        name: "description",
        content: "Simulação de custos de importação por produto.",
      },
    ],
  }),
});

function toNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);

  return Number.isFinite(number) ? number : 0;
}

// Mantém só dígitos, ponto e vírgula nos campos numéricos (formato
// "1.234,56" usado por toNumber) — bloqueia letras e demais símbolos
// direto na digitação.
function sanitizeDecimalInput(value: string) {
  return value.replace(/[^0-9.,]/g, "");
}

function normalizeNcm(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatAliquota(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTaxaConversao(value: number) {
  if (!Number.isFinite(value)) return "";

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatMoeda(value: number, moeda: "USD" | "EUR") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: moeda,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCurrencyOrBlank(value: number | null) {
  return value === null ? "—" : formatCurrency(value);
}

function calculateItem(item: CostItem, conversionRate = 1) {
  const quantidade = toNumber(item.quantidade);
  const peso = toNumber(item.peso);
  const fobUnit = toNumber(item.fobUnit);
  const frete = toNumber(item.frete);
  const seguro = toNumber(item.seguro);
  const iiRate = toNumber(item.ii) / 100;
  const ipiRate = toNumber(item.ipi) / 100;
  const pisRate = toNumber(item.pis) / 100;
  const cofinsRate = toNumber(item.cofins) / 100;
  const icmsRate = toNumber(item.icms) / 100;
  const antidumping = toNumber(item.antidumping);
  // FOB unit/quantidade são digitados na moeda estrangeira (USD/EUR); o
  // restante do cálculo (CIF, impostos etc.) precisa do valor em reais,
  // por isso o FOB total é convertido aqui pela taxa de câmbio da aba
  // "Câmbio" antes de seguir no cálculo — frete e seguro já são em R$.
  const fobTotalMoeda = quantidade * fobUnit;
  const fobTotal = fobTotalMoeda * conversionRate;
  const cif = fobTotal + frete + seguro;
  const ii = cif * iiRate;
  const ipi = (cif + ii) * ipiRate;
  const pis = cif * pisRate;
  const cofins = cif * cofinsRate;
  const icmsBase = cif + ii + ipi + pis + cofins + antidumping;
  const icms =
    icmsRate > 0 && icmsRate < 1 ? (icmsBase / (1 - icmsRate)) * icmsRate : 0;
  const impostos = ii + ipi + pis + cofins + icms + antidumping;
  const custoTotal = cif + impostos;
  const custoUnitario = quantidade > 0 ? custoTotal / quantidade : 0;

  return {
    quantidade,
    peso,
    fobTotalMoeda,
    fobTotal,
    cif,
    ii,
    ipi,
    pis,
    cofins,
    icms,
    antidumping,
    impostos,
    custoTotal,
    custoUnitario,
  };
}

// Replica a aba "IPI" da planilha modelo: cada linha vem da lista de
// produtos (equivalente à aba "Rateio Produto"), colunas C:N (peso até
// total de impostos) são calculadas direto; O:U dependem dos totais
// "Despesa" e "margem" que na planilha vêm de 'Demonstrativo Importação'!H70
// e !H95 — aqui são inseridos manualmente, então ficam em branco até
// serem preenchidos.
function calculateIpiRowBase(item: CostItem, conversionRate = 1) {
  const calculated = calculateItem(item, conversionRate);
  const peso = toNumber(item.peso);
  const quantidade = toNumber(item.quantidade);
  const pesoTotal = quantidade * peso;
  const total = calculated.cif + calculated.ii + calculated.ipi + calculated.pis + calculated.cofins;
  const aliquotaIpiSaida = toNumber(item.ipi) / 100;

  return {
    peso,
    quantidade,
    pesoTotal,
    valorTotal: calculated.fobTotal,
    seguro: toNumber(item.seguro),
    frete: toNumber(item.frete),
    cif: calculated.cif,
    ii: calculated.ii,
    ipi: calculated.ipi,
    pis: calculated.pis,
    cofins: calculated.cofins,
    total,
    aliquotaIpiSaida,
  };
}

const IPI_COLUMNS = [
  { key: "produto", label: "PRODUTO" },
  { key: "ncm", label: "NCM" },
  { key: "peso", label: "PESO" },
  { key: "quant", label: "QUANT." },
  { key: "pesoTotal", label: "PESO TOTAL" },
  { key: "valorTotal", label: "Valor total" },
  { key: "seguro", label: "Seguro" },
  { key: "frete", label: "Frete" },
  { key: "cif", label: "CIF" },
  { key: "ii", label: "II" },
  { key: "ipi", label: "IPI" },
  { key: "pis", label: "PIS" },
  { key: "cofins", label: "COFINS" },
  { key: "total", label: "Total" },
  { key: "porcentagem", label: "Porcetagem" },
  { key: "despesa", label: "Despesa" },
  { key: "totalNotaEntrada", label: "Total nota de entrada" },
  { key: "margem", label: "margem" },
  { key: "aliquotaIpi", label: "Aliquota IPI" },
  { key: "ipiSaida", label: "IPI na saida" },
  { key: "valorFinal", label: "Valor final" },
] as const;

// Replica a aba "Rateio Produto" (colunas de custo de importação por
// produto). Sem o rateio proporcional de frete/adicional entre produtos
// do embarque (mantido como no restante do app: frete/seguro por item).
// "Despesas de nacionalização" (AA) é rateada pela participação de cada
// produto no FOB total do embarque — base diferente da "Porcetagem" da
// aba IPI, que usa a participação no Total (CIF+impostos).
function calculateRateioRowBase(
  item: CostItem,
  totalFob: number,
  despesaTotal: number,
  conversionRate = 1,
) {
  const calculated = calculateItem(item, conversionRate);
  const despesaShare = totalFob > 0 ? calculated.fobTotal / totalFob : 0;
  const despesaRateada = despesaShare * despesaTotal;
  const icmsRate = toNumber(item.icms) / 100;
  const despesaBaseIcms =
    icmsRate < 1
      ? ((calculated.cif +
          calculated.ii +
          calculated.ipi +
          calculated.pis +
          calculated.cofins +
          calculated.antidumping +
          despesaRateada) /
          (1 - icmsRate)) *
        icmsRate
      : 0;
  const custoTotalImportacao =
    calculated.cif +
    calculated.ii +
    despesaRateada +
    calculated.antidumping +
    despesaBaseIcms;
  const custoUnitImportacao =
    calculated.quantidade > 0 ? custoTotalImportacao / calculated.quantidade : null;
  const representatividade =
    calculated.quantidade > 0 ? calculated.cif / calculated.quantidade : null;
  const repSobreFob =
    representatividade !== null && custoUnitImportacao
      ? representatividade / custoUnitImportacao
      : null;

  return {
    fobUnit: toNumber(item.fobUnit),
    fobTotal: calculated.fobTotal,
    frete: toNumber(item.frete),
    seguro: toNumber(item.seguro),
    cif: calculated.cif,
    ii: calculated.ii,
    ipi: calculated.ipi,
    pis: calculated.pis,
    cofins: calculated.cofins,
    antidumping: calculated.antidumping,
    icmsRate,
    despesaRateada,
    despesaBaseIcms,
    custoTotalImportacao,
    custoUnitImportacao,
    representatividade,
    repSobreFob,
  };
}

const RATEIO_COLUMNS = [
  { key: "produto", label: "PRODUTO" },
  { key: "ncm", label: "NCM" },
  { key: "peso", label: "PESO" },
  { key: "quant", label: "QUANT" },
  { key: "fobUnit", label: "FOB UNIT." },
  { key: "fobTotal", label: "FOB TOTAL" },
  { key: "frete", label: "FRETE INT'L" },
  { key: "seguro", label: "SEGURO" },
  { key: "ii", label: "II" },
  { key: "ipi", label: "IPI" },
  { key: "pis", label: "PIS" },
  { key: "cofins", label: "COFINS" },
  { key: "antidumping", label: "ANTIDUMPING" },
  { key: "icms", label: "ICMS" },
  { key: "despesaNacionalizacao", label: "DESPESAS NACIONALIZAÇÃO" },
  { key: "despesaBaseIcms", label: "DESPESAS NACIONALIZAÇÃO BASE ICMS" },
  { key: "custoUnit", label: "CUSTO UNIT DE IMPORTAÇÃO (DISTRIBUIÇÃO)" },
  { key: "custoTotal", label: "CUSTO TOTAL (DISTRIBUIÇÃO)" },
  { key: "repFobFrete", label: "REP. FOB+FRETE" },
  { key: "repSFob", label: "REP. S/ FOB" },
] as const;

function hydrateStoredItem(item: Partial<CostItem>): CostItem | null {
  if (!item.id || !item.nomeProduto) return null;

  return {
    ...EMPTY_ITEM,
    ...item,
    id: item.id,
    nomeProduto: item.nomeProduto,
    expanded: item.expanded ?? false,
    pis: item.pis || DEFAULT_PIS,
    cofins: item.cofins || DEFAULT_COFINS,
  };
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function SimulacaoCustosPage() {
  const location = useLocation();
  const lookupTributos = useServerFn(lookupNcmTributos);
  const lookupIcms = useServerFn(lookupIcmsInterestadual);
  const createItem = useServerFn(createSimulacaoCustoItem);
  const updateItem = useServerFn(updateSimulacaoCustoItem);
  const exportIpi = useServerFn(exportSimulacaoIpiXlsx);
  const suggestNcm = useServerFn(suggestNcmByProductName);
  const fetchCambioRate = useServerFn(fetchCambio);
  const [items, setItems] = useState<CostItem[]>([]);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [ncmLookupStatus, setNcmLookupStatus] = useState<
    "idle" | "loading" | "found" | "not-found" | "error"
  >("idle");
  const [ncmLookupDescription, setNcmLookupDescription] = useState("");
  const [icmsLookupStatus, setIcmsLookupStatus] = useState<
    "idle" | "loading" | "found" | "not-found" | "error"
  >("idle");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isSuggestingNcm, setIsSuggestingNcm] = useState(false);
  const [adicionalInput, setAdicionalInput] = useState("");
  const [despesaLines, setDespesaLines] = useState<DespesaLine[]>(() =>
    DEFAULT_DESPESA_LINES.map((line) => ({ ...line, id: createId() })),
  );
  const [pisRevendaInput, setPisRevendaInput] = useState("1,65");
  const [cofinsRevendaInput, setCofinsRevendaInput] = useState("7,60");
  const [icmsRevendaInput, setIcmsRevendaInput] = useState("4,00");
  const [margemRateInput, setMargemRateInput] = useState("3,00");
  const [creditoIcmsInput, setCreditoIcmsInput] = useState("0,00");
  const [mvaStInput, setMvaStInput] = useState("58,05");
  const [aliquotaIcmsStInput, setAliquotaIcmsStInput] = useState("18,00");
  const [freteStInput, setFreteStInput] = useState("0,00");
  const [header, setHeader] = useState<SimulacaoHeader>(DEFAULT_HEADER);
  const [headerStorageReady, setHeaderStorageReady] = useState(false);
  const [dataOperacao, setDataOperacao] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [moedaCambio, setMoedaCambio] = useState<"USD" | "EUR">("USD");
  const [taxaConversao, setTaxaConversao] = useState("");
  const [cambioLoading, setCambioLoading] = useState(false);
  const [cambioError, setCambioError] = useState("");
  const [cambioReloadKey, setCambioReloadKey] = useState(0);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setStorageReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<CostItem>[];
      const hydrated = Array.isArray(parsed)
        ? parsed
            .map((item) => hydrateStoredItem(item))
            .filter((item): item is CostItem => Boolean(item))
        : [];
      setItems(hydrated);
    } catch {
      setItems([]);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, storageReady]);

  useEffect(() => {
    const stored = window.localStorage.getItem(HEADER_STORAGE_KEY);

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<SimulacaoHeader>;
        setHeader((current) => ({ ...current, ...parsed }));
      } catch {
        // ignora cabeçalho corrompido e mantém os padrões
      }
    }

    setHeaderStorageReady(true);
  }, []);

  useEffect(() => {
    if (!headerStorageReady) return;

    window.localStorage.setItem(HEADER_STORAGE_KEY, JSON.stringify(header));
  }, [header, headerStorageReady]);

  useEffect(() => {
    let cancelled = false;

    setCambioLoading(true);
    setCambioError("");

    fetchCambioRate({ data: { moeda: moedaCambio } })
      .then((result) => {
        if (!cancelled) {
          // A AwesomeAPI devolve o bid com ponto decimal (ex.: "5.0746");
          // o resto do app usa toNumber(), que assume formato brasileiro
          // (ponto = milhar, vírgula = decimal). Sem essa conversão, o
          // ponto seria lido como separador de milhar e inflaria a taxa.
          setTaxaConversao(formatTaxaConversao(Number(result.bid)));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCambioError(
            error instanceof Error
              ? error.message
              : "Não foi possível buscar a cotação.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCambioLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [moedaCambio, cambioReloadKey, fetchCambioRate]);

  useEffect(() => {
    const ncm = normalizeNcm(form.ncm);

    setNcmLookupDescription("");

    if (ncm.length !== 8) {
      setNcmLookupStatus("idle");
      return;
    }

    let cancelled = false;

    setNcmLookupStatus("loading");

    const timeout = window.setTimeout(async () => {
      let tributo: NcmTributoLookup | null = null;

      try {
        tributo = await lookupTributos({ data: { ncm } });
      } catch {
        if (!cancelled) {
          setNcmLookupStatus("error");
        }
        return;
      }

      if (cancelled) return;

      if (!tributo) {
        setNcmLookupStatus("not-found");
        return;
      }

      setForm((current) => ({
        ...current,
        ncm,
        ii: formatAliquota(tributo.aliquota_ii) || current.ii,
        ipi: formatAliquota(tributo.aliquota_ipi) || current.ipi,
        pis: formatAliquota(tributo.aliquota_pis) || current.pis || DEFAULT_PIS,
        cofins:
          formatAliquota(tributo.aliquota_cofins) ||
          current.cofins ||
          DEFAULT_COFINS,
      }));
      setNcmLookupDescription(tributo.descricao || "");
      setNcmLookupStatus("found");
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [form.ncm, lookupTributos]);

  // "Operação via (UF)" é o estado de entrada da carga (origem) e
  // "Destino (UF)" é o estado do cliente/revenda — assim que os dois
  // estiverem preenchidos, busca a alíquota de ICMS de saída
  // correspondente (tabela icms_interestadual) e preenche o campo
  // "ICMS" da precificação de revenda automaticamente.
  useEffect(() => {
    const ufOrigem = header.destinoUf;
    const ufDestino = header.ufDestino;

    if (!ufOrigem || !ufDestino) {
      setIcmsLookupStatus("idle");
      return;
    }

    let cancelled = false;
    setIcmsLookupStatus("loading");

    lookupIcms({ data: { ufOrigem, ufDestino } })
      .then((result) => {
        if (cancelled) return;

        if (!result) {
          setIcmsLookupStatus("not-found");
          return;
        }

        setIcmsRevendaInput(formatAliquota(result.aliquota) || "0,00");
        setIcmsLookupStatus("found");
      })
      .catch(() => {
        if (!cancelled) setIcmsLookupStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [header.destinoUf, header.ufDestino, lookupIcms]);

  // FOB unit/total dos produtos são digitados na moeda estrangeira
  // selecionada na aba "Câmbio"; essa taxa converte para reais antes de
  // entrar em qualquer cálculo de CIF/impostos. Sem cotação válida
  // (ainda carregando, erro na API), mantém 1:1 em vez de zerar tudo.
  const conversionRate = toNumber(taxaConversao) || 1;

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          const calculated = calculateItem(item, conversionRate);

          acc.peso += calculated.peso;
          acc.quantidade += calculated.quantidade;
          acc.fob += calculated.fobTotal;
          acc.total += calculated.custoTotal;

          return acc;
        },
        { peso: 0, quantidade: 0, fob: 0, total: 0 },
      ),
    [items, conversionRate],
  );

  // Filtra só a lista exibida (nome do produto ou NCM) — não mexe em
  // seleção/cálculos, que continuam olhando pra `items` inteiro.
  const filteredItems = useMemo(() => {
    const query = itemSearchQuery.trim().toLowerCase();
    if (!query) return items;

    return items.filter(
      (item) =>
        item.nomeProduto.toLowerCase().includes(query) ||
        item.ncm.toLowerCase().includes(query),
    );
  }, [items, itemSearchQuery]);

  // Frete internacional total: soma do frete de cada item selecionado,
  // multiplicada pela quantidade de containers (esse frete é por
  // container) — se a quantidade de containers estiver zerada, usa só
  // a soma. Calculado à parte (sem passar por rateioTotals) porque a
  // linha "AFRMM / ATAERO" precisa dele para virar valor monetário, e
  // rateioTotals só fica pronto depois do despesaTotal (que alimenta o
  // rateio de despesas por item).
  const freteInternacionalTotal = useMemo(() => {
    const somaFrete = items
      .filter((item) => selectedIds.has(item.id))
      .reduce((sum, item) => sum + toNumber(item.frete), 0);
    const qtdeContainer = toNumber(header.qtdeContainer);

    return qtdeContainer > 0 ? somaFrete * qtdeContainer : somaFrete;
  }, [items, selectedIds, header.qtdeContainer]);

  // Cadeia de dependências que replica Demonstrativo Importação ->
  // Rateio Produto -> IPI: a "Despesa" some as linhas editáveis abaixo,
  // alimenta o rateio e o custo de aquisição, que por sua vez define o
  // "Total dos produtos" (margem) consumido pela aba IPI. Sem
  // referência circular real (o H95 do modelo original também não é
  // circular — só parecia por causa da ordem das fórmulas).
  const despesaTotal = useMemo(
    () =>
      despesaLines.reduce((sum, line) => {
        const amount = line.isPercentual
          ? (toNumber(line.value) / 100) * freteInternacionalTotal
          : toNumber(line.value);

        return sum + amount;
      }, 0),
    [despesaLines, freteInternacionalTotal],
  );

  const rateioRows = useMemo(() => {
    const selected = items.filter((item) => selectedIds.has(item.id));
    const totalFob = selected.reduce(
      (sum, item) => sum + calculateItem(item, conversionRate).fobTotal,
      0,
    );

    return selected.map((item) => ({
      item,
      ...calculateRateioRowBase(item, totalFob, despesaTotal, conversionRate),
    }));
  }, [items, selectedIds, despesaTotal, conversionRate]);

  const rateioTotals = useMemo(
    () =>
      rateioRows.reduce(
        (acc, row) => {
          acc.fobTotal += row.fobTotal;
          acc.frete += row.frete;
          acc.seguro += row.seguro;
          acc.ii += row.ii;
          acc.ipi += row.ipi;
          acc.pis += row.pis;
          acc.cofins += row.cofins;
          acc.antidumping += row.antidumping;
          acc.despesaRateada += row.despesaRateada;
          acc.despesaBaseIcms += row.despesaBaseIcms;
          acc.custoTotalImportacao += row.custoTotalImportacao;
          return acc;
        },
        {
          fobTotal: 0,
          frete: 0,
          seguro: 0,
          ii: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          antidumping: 0,
          despesaRateada: 0,
          despesaBaseIcms: 0,
          custoTotalImportacao: 0,
        },
      ),
    [rateioRows],
  );

  // Crédito IPI/PIS/COFINS (card "Crédito dos tributos") acompanha
  // automaticamente os totais de "Impostos de Nacionalização" acima —
  // igual à planilha modelo, onde Crédito IPI/PIS/COFINS = -(imposto
  // pago na importação). Só o ICMS continua manual, pois na planilha
  // esse crédito não é automático (ICMS costuma ficar diferido).
  const creditosTotal = useMemo(
    () =>
      rateioTotals.ipi +
      rateioTotals.pis +
      rateioTotals.cofins +
      toNumber(creditoIcmsInput),
    [rateioTotals.ipi, rateioTotals.pis, rateioTotals.cofins, creditoIcmsInput],
  );

  // Réplica do bloco "VALOR DA MERCADORIA" + "IMPOSTOS DE NACIONALIZAÇÃO"
  // + "DESPESAS" + "CRÉDITO DOS TRIBUTOS" da Demonstrativo Importação.
  const demonstrativo = useMemo(() => {
    const adicional = adicionalInput ? toNumber(adicionalInput) : 0;
    const valorMercadoria = rateioTotals.fobTotal;
    const freteInternacional = freteInternacionalTotal;
    const seguro = rateioTotals.seguro;
    const cif = valorMercadoria + adicional + freteInternacional + seguro;
    const totalImpostos =
      rateioTotals.ii + rateioTotals.ipi + rateioTotals.pis + rateioTotals.cofins;
    const totalCifImpostos = cif + totalImpostos - adicional;
    const totalNotaFiscal = totalCifImpostos + despesaTotal;
    const creditoIpi = -rateioTotals.ipi;
    const creditoPis = -rateioTotals.pis;
    const creditoCofins = -rateioTotals.cofins;
    const totalCreditos = creditoIpi + creditoPis + creditoCofins;
    const custoAquisicao = totalCreditos + totalNotaFiscal;

    return {
      adicional,
      valorMercadoria,
      freteInternacional,
      seguro,
      cif,
      totalImpostos,
      totalCifImpostos,
      totalNotaFiscal,
      creditoIpi,
      creditoPis,
      creditoCofins,
      totalCreditos,
      custoAquisicao,
    };
  }, [adicionalInput, rateioTotals, despesaTotal, freteInternacionalTotal]);

  // Réplica do bloco de precificação de revenda (H89:H97). G93 = "1 -
  // SUM(PIS,COFINS,ICMS,margem)"; se as alíquotas somarem >= 100% não dá
  // pra resolver (mesma limitação do original).
  const totalDosProdutos = useMemo(() => {
    const rateSum =
      (toNumber(pisRevendaInput) +
        toNumber(cofinsRevendaInput) +
        toNumber(icmsRevendaInput) +
        toNumber(margemRateInput)) /
      100;
    const porcentagem = 1 - rateSum;

    return porcentagem > 0 ? demonstrativo.custoAquisicao / porcentagem : null;
  }, [demonstrativo.custoAquisicao, pisRevendaInput, cofinsRevendaInput, icmsRevendaInput, margemRateInput]);

  const ipiRows = useMemo(() => {
    const base = items
      .filter((item) => selectedIds.has(item.id))
      .map((item) => ({ item, ...calculateIpiRowBase(item, conversionRate) }));
    const totalN = base.reduce((sum, row) => sum + row.total, 0);

    return base.map((row) => {
      const porcentagem = totalN > 0 ? row.total / totalN : 0;
      const despesa = porcentagem * despesaTotal;
      const totalNotaEntrada = row.total + despesa;
      const margem = totalDosProdutos !== null ? porcentagem * totalDosProdutos : null;
      const ipiSaida = margem !== null ? margem * row.aliquotaIpiSaida : null;
      const valorFinal =
        margem !== null && ipiSaida !== null ? margem + ipiSaida : null;

      return {
        ...row,
        porcentagem,
        despesa,
        totalNotaEntrada,
        margem,
        ipiSaida,
        valorFinal,
      };
    });
  }, [items, selectedIds, despesaTotal, totalDosProdutos, conversionRate]);

  const ipiTotals = useMemo(
    () =>
      ipiRows.reduce(
        (acc, row) => {
          acc.pesoTotal += row.pesoTotal;
          acc.valorTotal += row.valorTotal;
          acc.cif += row.cif;
          acc.ii += row.ii;
          acc.ipi += row.ipi;
          acc.pis += row.pis;
          acc.cofins += row.cofins;
          acc.total += row.total;
          acc.totalNotaEntrada += row.totalNotaEntrada;
          acc.ipiSaida += row.ipiSaida ?? 0;
          acc.valorFinal += row.valorFinal ?? 0;
          return acc;
        },
        {
          pesoTotal: 0,
          valorTotal: 0,
          cif: 0,
          ii: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          total: 0,
          totalNotaEntrada: 0,
          ipiSaida: 0,
          valorFinal: 0,
        },
      ),
    [ipiRows],
  );

  // Réplica do bloco "SUBSTITUIÇÃO TRIBUTÁRIA" da aba Rateio Produto
  // (colunas E:K, linha do produto): BC-ST = (Valor do produto + Frete +
  // IPI) x (1 + MVA); ICMS-ST = BC-ST x alíquota interna - crédito de
  // ICMS já reconhecido na revenda (mesma alíquota de "ICMS" da
  // precificação de revenda, ex.: 4%).
  const substituicaoTributaria = useMemo(() => {
    if (totalDosProdutos === null) return null;

    const valorProduto = totalDosProdutos;
    const frete = toNumber(freteStInput);
    const ipi = ipiTotals.ipiSaida;
    const mva = toNumber(mvaStInput) / 100;
    const aliquotaIcmsSt = toNumber(aliquotaIcmsStInput) / 100;
    const creditoIcms = valorProduto * (toNumber(icmsRevendaInput) / 100);
    const baseSt = (valorProduto + frete + ipi) * (1 + mva);
    const icmsSt = baseSt * aliquotaIcmsSt - creditoIcms;

    return { valorProduto, frete, ipi, mva, aliquotaIcmsSt, creditoIcms, baseSt, icmsSt };
  }, [
    totalDosProdutos,
    freteStInput,
    ipiTotals.ipiSaida,
    mvaStInput,
    aliquotaIcmsStInput,
    icmsRevendaInput,
  ]);

  // Fecha o restante do bloco de revenda (H89:H97), que depende do total
  // de "IPI na saída" apurado linha a linha na aba IPI acima. "Total da
  // NF" soma também o ICMS-ST (quando há substituição tributária), igual
  // à planilha modelo (H99 = H97 + H98, sendo H98 o ICMS-ST da aba
  // Rateio Produto nesse caso).
  const demonstrativoResale = useMemo(() => {
    if (totalDosProdutos === null) return null;

    const icmsRevendaValor = totalDosProdutos * (toNumber(icmsRevendaInput) / 100);
    const pisRevendaValor =
      (totalDosProdutos - icmsRevendaValor) * (toNumber(pisRevendaInput) / 100);
    const cofinsRevendaValor =
      (totalDosProdutos - icmsRevendaValor) * (toNumber(cofinsRevendaInput) / 100);
    const ipiSaidaTotal = ipiTotals.ipiSaida;
    const icmsStTotal = substituicaoTributaria?.icmsSt ?? 0;
    const totalDaNota = totalDosProdutos + ipiSaidaTotal + icmsStTotal;
    const margemLucroValor = totalDaNota * (toNumber(margemRateInput) / 100);

    return {
      icmsRevendaValor,
      pisRevendaValor,
      cofinsRevendaValor,
      ipiSaidaTotal,
      icmsStTotal,
      totalDaNota,
      margemLucroValor,
    };
  }, [
    totalDosProdutos,
    ipiTotals.ipiSaida,
    substituicaoTributaria,
    pisRevendaInput,
    cofinsRevendaInput,
    icmsRevendaInput,
    margemRateInput,
  ]);

  const updateDespesaLine = (id: string, value: string) => {
    setDespesaLines((current) =>
      current.map((line) => (line.id === id ? { ...line, value } : line)),
    );
  };

  const addDespesaLine = () => {
    setDespesaLines((current) => [
      ...current,
      { id: createId(), label: "", value: "0,00" },
    ]);
  };

  const updateDespesaLineLabel = (id: string, label: string) => {
    setDespesaLines((current) =>
      current.map((line) => (line.id === id ? { ...line, label } : line)),
    );
  };

  const removeDespesaLine = (id: string) => {
    setDespesaLines((current) => current.filter((line) => line.id !== id));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  // Campos obrigatórios pra exportação não travar com erro: sem eles, o
  // Excel acaba recebendo linha/planilha incompleta e o gerador quebra.
  // Só valida os itens selecionados (os que realmente entram no
  // Rateio Produto/IPI/Demonstrativo exportados).
  const exportMissingFields = useMemo(() => {
    const missing: string[] = [];

    if (rateioRows.length === 0) {
      missing.push("selecione ao menos um item na tabela");
      return missing;
    }

    if (!header.identificacao.trim()) missing.push("Identificação");
    if (!dataOperacao) missing.push("Data de conversão");
    if (!taxaConversao.trim() || toNumber(taxaConversao) <= 0) {
      missing.push("Taxa de conversão");
    }

    rateioRows.forEach((row) => {
      const nome = row.item.nomeProduto.trim() || "item sem nome";
      if (!row.item.ncm.trim()) missing.push(`NCM (${nome})`);
      if (toNumber(row.item.peso) <= 0) missing.push(`Peso (${nome})`);
      if (toNumber(row.item.quantidade) <= 0) missing.push(`Quantidade (${nome})`);
      if (toNumber(row.item.fobUnit) <= 0) missing.push(`FOB unit (${nome})`);
    });

    return missing;
  }, [rateioRows, header.identificacao, dataOperacao, taxaConversao]);

  const canExportXlsx = exportMissingFields.length === 0;

  const exportIpiXlsx = async () => {
    if (ipiRows.length === 0 || rateioRows.length === 0 || !canExportXlsx) return;

    setIsExporting(true);

    try {
      const result = await exportIpi({
        data: {
          header,
          dataOperacao,
          ipiRows: ipiRows.map((row) => ({
            nomeProduto: row.item.nomeProduto,
            ncm: row.item.ncm,
            peso: row.peso,
            quantidade: row.quantidade,
            valorTotal: row.valorTotal,
            seguro: row.seguro,
            frete: row.frete,
            ii: row.ii,
            ipi: row.ipi,
            pis: row.pis,
            cofins: row.cofins,
            aliquotaIpi: row.aliquotaIpiSaida,
          })),
          rateioRows: rateioRows.map((row) => ({
            nomeProduto: row.item.nomeProduto,
            ncm: row.item.ncm,
            peso: toNumber(row.item.peso),
            quantidade: toNumber(row.item.quantidade),
            fobUnit: row.fobUnit,
            frete: row.frete,
            seguro: row.seguro,
            iiRate: toNumber(row.item.ii) / 100,
            ipiRate: toNumber(row.item.ipi) / 100,
            pisRate: toNumber(row.item.pis) / 100,
            cofinsRate: toNumber(row.item.cofins) / 100,
            antidumping: row.antidumping,
            icmsRate: row.icmsRate,
          })),
          adicional: demonstrativo.adicional,
          freteInternacional: demonstrativo.freteInternacional,
          despesaLines: despesaLines.map((line) => ({
            label: line.label,
            value: line.isPercentual
              ? (toNumber(line.value) / 100) * freteInternacionalTotal
              : toNumber(line.value),
          })),
          pisRevendaRate: toNumber(pisRevendaInput),
          cofinsRevendaRate: toNumber(cofinsRevendaInput),
          icmsRevendaRate: toNumber(icmsRevendaInput),
          margemRate: toNumber(margemRateInput),
          mvaStRate: toNumber(mvaStInput),
          aliquotaIcmsStRate: toNumber(aliquotaIcmsStInput),
          freteSt: toNumber(freteStInput),
          taxaConversao: conversionRate,
          moeda: moedaCambio,
        },
      });

      const byteCharacters = atob(result.base64);
      const bytes = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i += 1) {
        bytes[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error("Não foi possível exportar a planilha.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSuggestNcm = async () => {
    const nomeProduto = form.nomeProduto.trim();
    if (!nomeProduto) return;

    setIsSuggestingNcm(true);

    try {
      const result = await suggestNcm({ data: { nomeProduto } });
      updateForm("ncm", result.ncm);
      toast.success(`IA sugeriu NCM ${result.ncm}`, {
        description: `${result.descricao} — confiança ${result.confianca.replace("_", " ")}. Confirmando na tabela...`,
      });
    } catch (error) {
      toast.error("Não foi possível buscar o NCM com IA.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSuggestingNcm(false);
    }
  };

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateHeader = <K extends keyof SimulacaoHeader>(
    key: K,
    value: SimulacaoHeader[K],
  ) => {
    setHeader((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_ITEM);
    setEditingId(null);
    setNcmLookupStatus("idle");
    setNcmLookupDescription("");
  };

  const toItemPayload = (item: CostItem) => ({
    nomeProduto: item.nomeProduto,
    contribuinteIcms: item.contribuinteIcms === "sim",
    contribuinteIpi: item.contribuinteIpi === "sim",
    ncm: item.ncm || undefined,
    aliquotaIi: item.ii ? toNumber(item.ii) : undefined,
    aliquotaIpi: item.ipi ? toNumber(item.ipi) : undefined,
    aliquotaPis: item.pis ? toNumber(item.pis) : undefined,
    aliquotaCofins: item.cofins ? toNumber(item.cofins) : undefined,
    aliquotaIcms: item.icms ? toNumber(item.icms) : undefined,
    antidumping: toNumber(item.antidumping),
    peso: toNumber(item.peso),
    quantidade: toNumber(item.quantidade),
    fobUnit: toNumber(item.fobUnit),
    frete: toNumber(item.frete),
    seguro: toNumber(item.seguro),
  });

  const persistNewItem = (item: CostItem) => {
    createItem({ data: toItemPayload(item) })
      .then((result) => {
        // Guarda o id gerado pelo Supabase no item local, pra edições
        // seguintes saberem qual linha atualizar em vez de criar outra.
        setItems((current) =>
          current.map((existingItem) =>
            existingItem.id === item.id ? { ...existingItem, dbId: result.id } : existingItem,
          ),
        );
        toast.success("Produto salvo.");
      })
      .catch((error) => {
        toast.error("Não foi possível salvar o produto.", {
          description: error instanceof Error ? error.message : undefined,
        });
      });
  };

  const persistItemUpdate = (item: CostItem) => {
    // Item editado nunca chegou a ser persistido antes (ex.: criado antes
    // desse fix) — trata como criação, já que não existe linha pra atualizar.
    if (!item.dbId) {
      persistNewItem(item);
      return;
    }

    updateItem({ data: { id: item.dbId, ...toItemPayload(item) } })
      .then(() => {
        toast.success("Produto atualizado.");
      })
      .catch((error) => {
        toast.error("Não foi possível atualizar o produto.", {
          description: error instanceof Error ? error.message : undefined,
        });
      });
  };

  const saveItem = () => {
    const trimmedName = form.nomeProduto.trim();

    if (!trimmedName) return;

    if (editingId) {
      let updatedItem: CostItem | undefined;
      setItems((current) =>
        current.map((item) => {
          if (item.id !== editingId) return item;
          updatedItem = { ...item, ...form, nomeProduto: trimmedName };
          return updatedItem;
        }),
      );
      if (updatedItem) persistItemUpdate(updatedItem);
    } else {
      const newItem: CostItem = {
        id: createId(),
        ...form,
        nomeProduto: trimmedName,
        expanded: true,
      };

      setItems((current) => [newItem, ...current]);
      persistNewItem(newItem);
    }

    resetForm();
  };

  const editItem = (item: CostItem) => {
    const { id: _id, expanded: _expanded, ...editableFields } = item;
    setForm(editableFields);
    setEditingId(item.id);
  };

  const deleteItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });

    if (editingId === id) {
      resetForm();
    }
  };

  const toggleItem = (id: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, expanded: !item.expanded } : item,
      ),
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label="Abrir menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Menu</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link
                    to="/classificacao"
                    className={
                      location.pathname === "/classificacao"
                        ? "font-medium"
                        : ""
                    }
                  >
                    Classificar
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    to="/simulacao-custos"
                    className={
                      location.pathname === "/simulacao-custos"
                        ? "font-medium"
                        : ""
                    }
                  >
                    Simulação de custos
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    to="/historico"
                    className={
                      location.pathname === "/historico" ? "font-medium" : ""
                    }
                  >
                    Historico
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div>
              <div className="font-bold leading-tight">
                FC Comércio Exterior
              </div>
              <div className="text-xs leading-tight text-muted-foreground">
                Simulação de custos
              </div>
            </div>
          </div>
          <Link
            to="/"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            sair
          </Link>
        </div>
      </header>

      <main className="px-4 py-10">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[380px_1fr]">
          <Card className="h-fit border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PackagePlus className="h-5 w-5 text-primary" />
                {editingId ? "Editar produto" : "Novo produto"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nomeProduto">Nome do produto</Label>
                <Input
                  id="nomeProduto"
                  value={form.nomeProduto}
                  onChange={(event) =>
                    updateForm("nomeProduto", event.target.value)
                  }
                  placeholder="Ex.: Álcool 99 USP"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Contribuinte ICMS</Label>
                  <Select
                    value={form.contribuinteIcms}
                    onValueChange={(value) =>
                      updateForm("contribuinteIcms", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sim">Sim</SelectItem>
                      <SelectItem value="nao">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Contribuinte IPI</Label>
                  <Select
                    value={form.contribuinteIpi}
                    onValueChange={(value) =>
                      updateForm("contribuinteIpi", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sim">Sim</SelectItem>
                      <SelectItem value="nao">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ncm">NCM</Label>
                  <div className="relative">
                    <Input
                      id="ncm"
                      value={form.ncm}
                      onChange={(event) => updateForm("ncm", event.target.value)}
                      placeholder="2207.10.10"
                      className="pr-9"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                      onClick={handleSuggestNcm}
                      disabled={!form.nomeProduto.trim() || isSuggestingNcm}
                      aria-label="Buscar NCM com IA"
                      title="Buscar NCM com IA a partir do nome do produto"
                    >
                      {isSuggestingNcm ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {ncmLookupStatus !== "idle" && (
                    <div className="min-h-4 text-xs text-muted-foreground">
                      {ncmLookupStatus === "loading" && "Buscando tributos..."}
                      {ncmLookupStatus === "found" &&
                        (ncmLookupDescription || "Tributos preenchidos.")}
                      {ncmLookupStatus === "not-found" &&
                        "NCM não encontrado na tabela."}
                      {ncmLookupStatus === "error" &&
                        "Não foi possível buscar o NCM."}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="peso">Peso</Label>
                  <Input
                    id="peso"
                    inputMode="decimal"
                    value={form.peso}
                    onChange={(event) =>
                      updateForm("peso", sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="16000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="quantidade">Quantidade</Label>
                  <Input
                    id="quantidade"
                    inputMode="decimal"
                    value={form.quantidade}
                    onChange={(event) =>
                      updateForm("quantidade", sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="20000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fobUnit">FOB Unit</Label>
                  <Input
                    id="fobUnit"
                    inputMode="decimal"
                    value={form.fobUnit}
                    onChange={(event) =>
                      updateForm("fobUnit", sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="1,10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="frete">Frete</Label>
                  <Input
                    id="frete"
                    inputMode="decimal"
                    value={form.frete}
                    onChange={(event) =>
                      updateForm("frete", sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="2000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seguro">Seguro</Label>
                  <Input
                    id="seguro"
                    inputMode="decimal"
                    value={form.seguro}
                    onChange={(event) =>
                      updateForm("seguro", sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="200"
                  />
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <AliquotaInput
                  id="ii"
                  label="II"
                  value={form.ii}
                  onChange={(value) => updateForm("ii", value)}
                />
                <AliquotaInput
                  id="ipi"
                  label="IPI"
                  value={form.ipi}
                  onChange={(value) => updateForm("ipi", value)}
                />
                <AliquotaInput
                  id="pis"
                  label="PIS"
                  value={form.pis}
                  onChange={(value) => updateForm("pis", value)}
                />
                <AliquotaInput
                  id="cofins"
                  label="COFINS"
                  value={form.cofins}
                  onChange={(value) => updateForm("cofins", value)}
                />
                <AliquotaInput
                  id="icms"
                  label="ICMS"
                  value={form.icms}
                  onChange={(value) => updateForm("icms", value)}
                />
                <div className="space-y-2">
                  <Label htmlFor="antidumping">ANTIDUMPING</Label>
                  <Input
                    id="antidumping"
                    inputMode="decimal"
                    value={form.antidumping}
                    onChange={(event) =>
                      updateForm("antidumping", sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  onClick={saveItem}
                  disabled={!form.nomeProduto.trim()}
                  className="flex-1"
                >
                  {editingId ? (
                    <Save className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {editingId ? "Salvar" : "Adicionar"}
                </Button>
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    <X className="h-4 w-4" />
                    Cancelar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            {items.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={itemSearchQuery}
                  onChange={(event) => setItemSearchQuery(event.target.value)}
                  placeholder="Buscar por nome do produto ou NCM..."
                  className="pl-9"
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryBox label="Itens" value={String(items.length)} />
              <SummaryBox
                label="Peso total"
                value={formatNumber(totals.peso)}
              />
              <SummaryBox
                label="Quantidade"
                value={formatNumber(totals.quantidade)}
              />
              <SummaryBox
                label="Custo total"
                value={formatCurrency(totals.total - creditosTotal)}
              />
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              {filteredItems.length === 0 ? (
                <Card className="border-dashed border-border/80 bg-muted/20 shadow-none">
                  <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <Coins className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <div className="font-medium">
                        {items.length === 0
                          ? "Nenhum produto na simulação."
                          : "Nenhum produto encontrado."}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {items.length === 0
                          ? "Preencha os campos ao lado para começar a lista."
                          : "Tente outro nome de produto ou NCM."}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                filteredItems.map((item, index) => {
                  const calculated = calculateItem(item, conversionRate);

                  return (
                    <Collapsible
                      key={item.id}
                      open={item.expanded}
                      onOpenChange={() => toggleItem(item.id)}
                    >
                      <Card className="overflow-hidden border-border/60 shadow-sm">
                        <div className="flex items-start justify-between gap-3 p-4">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={() => toggleSelected(item.id)}
                              onClick={(event) => event.stopPropagation()}
                              aria-label={`Selecionar ${item.nomeProduto} para a tabela IPI`}
                              className="mt-2 shrink-0"
                            />
                            <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none"
                            >
                              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">
                                  {item.nomeProduto}
                                </span>
                                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline">
                                    NCM {item.ncm || "não informado"}
                                  </Badge>
                                  <span>
                                    Qtd. {formatNumber(calculated.quantidade)}
                                  </span>
                                  <span>
                                    Total{" "}
                                    {formatCurrency(calculated.custoTotal)}
                                  </span>
                                </span>
                              </span>
                            </button>
                            </CollapsibleTrigger>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => editItem(item)}
                              aria-label="Editar produto"
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteItem(item.id)}
                              aria-label="Excluir produto"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleItem(item.id)}
                              aria-label={
                                item.expanded
                                  ? "Colapsar produto"
                                  : "Expandir produto"
                              }
                            >
                              {item.expanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        <CollapsibleContent>
                          <Separator />
                          <div className="grid gap-4 p-4 md:grid-cols-3">
                            <Detail
                              label="Contribuinte ICMS"
                              value={item.contribuinteIcms}
                            />
                            <Detail
                              label="Contribuinte IPI"
                              value={item.contribuinteIpi}
                            />
                            <Detail
                              label="Peso"
                              value={formatNumber(calculated.peso)}
                            />
                            <Detail
                              label="FOB unit"
                              value={formatCurrency(toNumber(item.fobUnit))}
                            />
                            <Detail
                              label={`FOB total ${moedaCambio}`}
                              value={formatMoeda(
                                calculated.fobTotalMoeda,
                                moedaCambio,
                              )}
                            />
                            <Detail
                              label="FOB total"
                              value={formatCurrency(calculated.fobTotal)}
                            />
                            <Detail
                              label="Frete"
                              value={formatCurrency(toNumber(item.frete))}
                            />
                            <Detail
                              label="Seguro"
                              value={formatCurrency(toNumber(item.seguro))}
                            />
                            <Detail
                              label="II"
                              value={`${item.ii || "0"}% | ${formatCurrency(calculated.ii)}`}
                            />
                            <Detail
                              label="IPI"
                              value={`${item.ipi || "0"}% | ${formatCurrency(calculated.ipi)}`}
                            />
                            <Detail
                              label="PIS"
                              value={`${item.pis || "0"}% | ${formatCurrency(calculated.pis)}`}
                            />
                            <Detail
                              label="COFINS"
                              value={`${item.cofins || "0"}% | ${formatCurrency(calculated.cofins)}`}
                            />
                            <Detail
                              label="ICMS"
                              value={`${item.icms || "0"}% | ${formatCurrency(calculated.icms)}`}
                            />
                            <Detail
                              label="ANTIDUMPING"
                              value={formatCurrency(calculated.antidumping)}
                            />
                            <Detail
                              label="Impostos"
                              value={formatCurrency(calculated.impostos)}
                            />
                            <Detail
                              label="Custo total"
                              value={formatCurrency(calculated.custoTotal)}
                            />
                            <Detail
                              label="Custo unitário"
                              value={formatCurrency(calculated.custoUnitario)}
                            />
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-6 max-w-6xl">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ClipboardList className="h-5 w-5 text-primary" />
                Dados da operação
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="identificacao">Identificação</Label>
                <Input
                  id="identificacao"
                  value={header.identificacao}
                  onChange={(event) =>
                    updateHeader("identificacao", event.target.value)
                  }
                  placeholder="Ex.: Álcool 99 USP"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="processo">Processo</Label>
                <Input
                  id="processo"
                  value={header.processo}
                  onChange={(event) =>
                    updateHeader("processo", event.target.value)
                  }
                  placeholder="Número do processo"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="destinoCliente">Cliente</Label>
                <Input
                  id="destinoCliente"
                  value={header.destinoCliente}
                  onChange={(event) =>
                    updateHeader("destinoCliente", event.target.value)
                  }
                  placeholder="Nome do cliente"
                />
              </div>

              <div className="space-y-2">
                <Label>Destino (UF)</Label>
                <Select
                  value={header.ufDestino}
                  onValueChange={(value) => updateHeader("ufDestino", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a UF" />
                  </SelectTrigger>
                  <SelectContent>
                    {UFS.map((uf) => (
                      <SelectItem key={uf.value} value={uf.value}>
                        {uf.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {icmsLookupStatus !== "idle" && (
                  <p className="text-xs text-muted-foreground">
                    {icmsLookupStatus === "loading" &&
                      "Buscando alíquota de ICMS de saída..."}
                    {icmsLookupStatus === "found" &&
                      `ICMS de saída (${header.destinoUf} → ${header.ufDestino}) preenchido automaticamente.`}
                    {icmsLookupStatus === "not-found" &&
                      "Não encontrei alíquota cadastrada para esse par de UF."}
                    {icmsLookupStatus === "error" &&
                      "Não foi possível buscar a alíquota de ICMS."}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="di">DI</Label>
                <Input
                  id="di"
                  value={header.di}
                  onChange={(event) => updateHeader("di", event.target.value)}
                  placeholder="Número da DI"
                />
              </div>

              <div className="space-y-2">
                <Label>Incoterm</Label>
                <Select
                  value={header.incoterm}
                  onValueChange={(value) =>
                    updateHeader("incoterm", value as Incoterm)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FOB">FOB</SelectItem>
                    <SelectItem value="CIF">CIF</SelectItem>
                    <SelectItem value="CFR">CFR</SelectItem>
                    <SelectItem value="EXW">EXW</SelectItem>
                    <SelectItem value="FCA">FCA</SelectItem>
                    <SelectItem value="CPT">CPT</SelectItem>
                    <SelectItem value="CIP">CIP</SelectItem>
                    <SelectItem value="DAP">DAP</SelectItem>
                    <SelectItem value="DDP">DDP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Operação beneficiada</Label>
                <Select
                  value={header.operacaoBeneficiada}
                  onValueChange={(value) =>
                    updateHeader("operacaoBeneficiada", value as SimNao)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Operação via (UF)</Label>
                <Select
                  value={header.destinoUf}
                  onValueChange={(value) => updateHeader("destinoUf", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a UF" />
                  </SelectTrigger>
                  <SelectContent>
                    {UFS.map((uf) => (
                      <SelectItem key={uf.value} value={uf.value}>
                        {uf.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Contribuinte - ICMS</Label>
                <Select
                  value={header.contribuinteIcms}
                  onValueChange={(value) =>
                    updateHeader("contribuinteIcms", value as SimNao)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Contribuinte - IPI</Label>
                <Select
                  value={header.contribuinteIpi}
                  onValueChange={(value) =>
                    updateHeader("contribuinteIpi", value as SimNao)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Apuração fiscal</Label>
                <Select
                  value={header.apuracaoFiscal}
                  onValueChange={(value) =>
                    updateHeader("apuracaoFiscal", value as ApuracaoFiscal)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lucro_real">Lucro Real</SelectItem>
                    <SelectItem value="lucro_presumido">
                      Lucro Presumido
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Possui substituição tributária</Label>
                <Select
                  value={header.possuiSubstituicaoTributaria}
                  onValueChange={(value) =>
                    updateHeader(
                      "possuiSubstituicaoTributaria",
                      value as SimNao,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Destinado a</Label>
                <Select
                  value={header.destinadoA}
                  onValueChange={(value) =>
                    updateHeader("destinadoA", value as DestinadoA)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenda">Revenda</SelectItem>
                    <SelectItem value="ativo_fixo">Ativo fixo</SelectItem>
                    <SelectItem value="industrializacao">
                      Industrialização
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="portoAeroporto">Porto / Aeroporto</Label>
                <Input
                  id="portoAeroporto"
                  value={header.portoAeroporto}
                  onChange={(event) =>
                    updateHeader("portoAeroporto", event.target.value)
                  }
                  placeholder="Ex.: Porto de Santos"
                />
              </div>

              <div className="space-y-2">
                <Label>Benefício</Label>
                <Select
                  value={header.beneficio}
                  onValueChange={(value) => updateHeader("beneficio", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invest">INVEST</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="headerQuantidade">Quantidade</Label>
                <Input
                  id="headerQuantidade"
                  inputMode="decimal"
                  value={header.quantidade}
                  onChange={(event) =>
                    updateHeader("quantidade", sanitizeDecimalInput(event.target.value))
                  }
                  placeholder="0"
                />
              </div>

              <div className="space-y-2">
                <Label>Frete interno por conta</Label>
                <Select
                  value={header.freteInternoPorConta}
                  onValueChange={(value) =>
                    updateHeader(
                      "freteInternoPorConta",
                      value as FreteInternoPorConta,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="emitente">Emitente</SelectItem>
                    <SelectItem value="destinatario">Destinatário</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Unidade / Medida</Label>
                <Select
                  value={header.unidadeMedida}
                  onValueChange={(value) =>
                    updateHeader("unidadeMedida", value as UnidadeMedida)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unidade">Unidade</SelectItem>
                    <SelectItem value="peso">Peso</SelectItem>
                    <SelectItem value="metro">Metro</SelectItem>
                    <SelectItem value="caixa">Caixa</SelectItem>
                    <SelectItem value="m2">M²</SelectItem>
                    <SelectItem value="m3">M³</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="qtdeContainer">Qtde de container</Label>
                <Input
                  id="qtdeContainer"
                  inputMode="decimal"
                  value={header.qtdeContainer}
                  onChange={(event) =>
                    updateHeader("qtdeContainer", sanitizeDecimalInput(event.target.value))
                  }
                  placeholder="0"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mx-auto mt-6 max-w-6xl">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Coins className="h-5 w-5 text-primary" />
                Câmbio
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="dataOperacao">Data</Label>
                <Input
                  id="dataOperacao"
                  type="date"
                  value={dataOperacao}
                  onChange={(event) => setDataOperacao(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Taxa de conversão</Label>
                <Select
                  value={moedaCambio}
                  onValueChange={(value) =>
                    setMoedaCambio(value as "USD" | "EUR")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxaConversaoValor">
                  {cambioLoading ? "Buscando cotação..." : "Valor"}
                </Label>
                <div className="relative">
                  <Input
                    id="taxaConversaoValor"
                    inputMode="decimal"
                    value={taxaConversao}
                    onChange={(event) =>
                      setTaxaConversao(sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="0,0000"
                    className="pr-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                    onClick={() => setCambioReloadKey((key) => key + 1)}
                    disabled={cambioLoading}
                    aria-label="Atualizar cotação"
                    title="Buscar cotação atual"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${cambioLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </div>
                {cambioError && (
                  <div className="text-xs text-destructive">{cambioError}</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mx-auto mt-6 max-w-6xl">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Wallet className="h-5 w-5 text-primary" />
                Crédito dos tributos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Crédito IPI" value={formatCurrency(rateioTotals.ipi)} />
                <Detail label="Crédito PIS" value={formatCurrency(rateioTotals.pis)} />
                <Detail
                  label="Crédito COFINS"
                  value={formatCurrency(rateioTotals.cofins)}
                />
                <div className="space-y-2">
                  <Label htmlFor="creditoIcms">Crédito ICMS</Label>
                  <Input
                    id="creditoIcms"
                    inputMode="decimal"
                    value={creditoIcmsInput}
                    onChange={(event) =>
                      setCreditoIcmsInput(sanitizeDecimalInput(event.target.value))
                    }
                    placeholder="0,00"
                  />
                </div>
              </div>
              <Detail
                label="Total de créditos (abate do Custo total)"
                value={formatCurrency(creditosTotal)}
              />
            </CardContent>
          </Card>
        </div>

        {selectedIds.size > 0 && (
          <div className="mx-auto mt-6 max-w-6xl">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Table2 className="h-5 w-5 text-primary" />
                  Demonstrativo Importação
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Valor da mercadoria
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Detail
                      label="Valor"
                      value={formatCurrency(demonstrativo.valorMercadoria)}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="adicional">Adicional</Label>
                      <Input
                        id="adicional"
                        inputMode="decimal"
                        value={adicionalInput}
                        onChange={(event) =>
                          setAdicionalInput(sanitizeDecimalInput(event.target.value))
                        }
                        placeholder="0,00"
                      />
                    </div>
                    <Detail
                      label="Frete Internacional"
                      value={formatCurrency(demonstrativo.freteInternacional)}
                    />
                    <Detail
                      label="Seguro"
                      value={formatCurrency(demonstrativo.seguro)}
                    />
                  </div>
                  <Detail
                    label="VALOR CIF"
                    value={formatCurrency(demonstrativo.cif)}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Impostos de nacionalização
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Detail
                      label="Imposto de Importação"
                      value={formatCurrency(rateioTotals.ii)}
                    />
                    <Detail label="IPI" value={formatCurrency(rateioTotals.ipi)} />
                    <Detail label="PIS" value={formatCurrency(rateioTotals.pis)} />
                    <Detail
                      label="COFINS"
                      value={formatCurrency(rateioTotals.cofins)}
                    />
                    <Detail
                      label="Direitos Antidumping"
                      value={formatCurrency(rateioTotals.antidumping)}
                    />
                    <Detail
                      label="TOTAL"
                      value={formatCurrency(demonstrativo.totalImpostos)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground">
                      Despesas com nacionalização
                    </h3>
                    <Button type="button" variant="outline" size="sm" onClick={addDespesaLine}>
                      <Plus className="h-4 w-4" />
                      Adicionar despesa
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {despesaLines.map((line) => {
                      const labelWidthClass = line.isPercentual
                        ? "w-40 shrink-0"
                        : "flex-1";
                      const labelField = line.fixed ? (
                        <div
                          className={`flex h-9 items-center truncate rounded-md border border-transparent px-3 text-sm ${labelWidthClass}`}
                          title={line.label}
                        >
                          {line.label}
                        </div>
                      ) : (
                        <Input
                          value={line.label}
                          onChange={(event) =>
                            updateDespesaLineLabel(line.id, event.target.value)
                          }
                          placeholder="Descrição da despesa"
                          className={labelWidthClass}
                        />
                      );

                      return (
                        <div key={line.id} className="flex items-center gap-2">
                          {labelField}
                          {line.isPercentual ? (
                            <>
                              <div className="relative w-24 shrink-0">
                                <Input
                                  inputMode="decimal"
                                  value={line.value}
                                  onChange={(event) =>
                                    updateDespesaLine(
                                      line.id,
                                      sanitizeDecimalInput(event.target.value),
                                    )
                                  }
                                  placeholder="0,00"
                                  className="pr-6"
                                />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                  %
                                </span>
                              </div>
                              <Input
                                readOnly
                                disabled
                                tabIndex={-1}
                                value={formatCurrency(
                                  (toNumber(line.value) / 100) *
                                    freteInternacionalTotal,
                                )}
                                className="w-32 flex-1 bg-muted/40 text-muted-foreground"
                              />
                            </>
                          ) : (
                            <Input
                              inputMode="decimal"
                              value={line.value}
                              onChange={(event) =>
                                updateDespesaLine(
                                  line.id,
                                  sanitizeDecimalInput(event.target.value),
                                )
                              }
                              placeholder="0,00"
                              className="w-32"
                            />
                          )}
                          {line.fixed ? (
                            <div className="h-9 w-9 shrink-0" />
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeDespesaLine(line.id)}
                              aria-label="Remover despesa"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Detail
                    label="TOTAL despesas de nacionalização"
                    value={formatCurrency(despesaTotal)}
                  />
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-3">
                  <Detail
                    label="Total da nota fiscal de nacionalização"
                    value={formatCurrency(demonstrativo.totalNotaFiscal)}
                  />
                  <Detail
                    label="Crédito dos tributos (IPI+PIS+COFINS)"
                    value={formatCurrency(demonstrativo.totalCreditos)}
                  />
                  <Detail
                    label="Custo de aquisição da mercadoria importada"
                    value={formatCurrency(demonstrativo.custoAquisicao)}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Precificação de revenda
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <AliquotaInput
                      id="pisRevenda"
                      label="PIS"
                      value={pisRevendaInput}
                      onChange={setPisRevendaInput}
                    />
                    <AliquotaInput
                      id="cofinsRevenda"
                      label="COFINS"
                      value={cofinsRevendaInput}
                      onChange={setCofinsRevendaInput}
                    />
                    <AliquotaInput
                      id="icmsRevenda"
                      label="ICMS"
                      value={icmsRevendaInput}
                      onChange={setIcmsRevendaInput}
                    />
                    <AliquotaInput
                      id="margemRate"
                      label="Margem de lucro"
                      value={margemRateInput}
                      onChange={setMargemRateInput}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Detail
                      label="Total dos produtos"
                      value={
                        totalDosProdutos !== null
                          ? formatCurrency(totalDosProdutos)
                          : "Alíquotas somam 100% ou mais"
                      }
                    />
                    <Detail
                      label="IPI Saída"
                      value={
                        demonstrativoResale
                          ? formatCurrency(demonstrativoResale.ipiSaidaTotal)
                          : "—"
                      }
                    />
                    <Detail
                      label="ICMS-ST"
                      value={
                        demonstrativoResale
                          ? formatCurrency(demonstrativoResale.icmsStTotal)
                          : "—"
                      }
                    />
                    <Detail
                      label="Total da NF"
                      value={
                        demonstrativoResale
                          ? formatCurrency(demonstrativoResale.totalDaNota)
                          : "—"
                      }
                    />
                    <Detail
                      label="Margem de lucro (valor)"
                      value={
                        demonstrativoResale
                          ? formatCurrency(demonstrativoResale.margemLucroValor)
                          : "—"
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="mx-auto mt-6 max-w-6xl">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Landmark className="h-5 w-5 text-primary" />
                  Substituição Tributária (ICMS-ST)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <AliquotaInput
                    id="mvaSt"
                    label="MVA"
                    value={mvaStInput}
                    onChange={setMvaStInput}
                  />
                  <AliquotaInput
                    id="aliquotaIcmsSt"
                    label="Alíquota ICMS-ST"
                    value={aliquotaIcmsStInput}
                    onChange={setAliquotaIcmsStInput}
                  />
                  <div className="space-y-2">
                    <Label htmlFor="freteSt">Frete (base ST)</Label>
                    <Input
                      id="freteSt"
                      inputMode="decimal"
                      value={freteStInput}
                      onChange={(event) =>
                        setFreteStInput(sanitizeDecimalInput(event.target.value))
                      }
                      placeholder="0,00"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Detail
                    label="Valor do produto"
                    value={
                      substituicaoTributaria
                        ? formatCurrency(substituicaoTributaria.valorProduto)
                        : "—"
                    }
                  />
                  <Detail
                    label="IPI"
                    value={
                      substituicaoTributaria
                        ? formatCurrency(substituicaoTributaria.ipi)
                        : "—"
                    }
                  />
                  <Detail
                    label="Base de cálculo (BC-ST)"
                    value={
                      substituicaoTributaria
                        ? formatCurrency(substituicaoTributaria.baseSt)
                        : "—"
                    }
                  />
                  <Detail
                    label="Crédito ICMS"
                    value={
                      substituicaoTributaria
                        ? formatCurrency(substituicaoTributaria.creditoIcms)
                        : "—"
                    }
                  />
                </div>
                <Detail
                  label="ICMS-ST"
                  value={
                    substituicaoTributaria
                      ? formatCurrency(substituicaoTributaria.icmsSt)
                      : "—"
                  }
                />
              </CardContent>
            </Card>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="mx-auto mt-6 max-w-6xl">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Table2 className="h-5 w-5 text-primary" />
                  Rateio Produto
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-md space-y-1 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    Despesas de nacionalização (Demonstrativo Importação)
                  </div>
                  <div className="text-sm font-semibold">
                    {formatCurrency(despesaTotal)}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-md border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {RATEIO_COLUMNS.map((column) => (
                          <TableHead
                            key={column.key}
                            className="whitespace-nowrap bg-[#003870] font-bold text-white"
                          >
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateioRows.map((row) => (
                        <TableRow key={row.item.id}>
                          <TableCell className="font-medium">
                            {row.item.nomeProduto}
                          </TableCell>
                          <TableCell>{row.item.ncm || "—"}</TableCell>
                          <TableCell>{formatNumber(toNumber(row.item.peso))}</TableCell>
                          <TableCell>
                            {formatNumber(toNumber(row.item.quantidade))}
                          </TableCell>
                          <TableCell>{formatCurrency(row.fobUnit)}</TableCell>
                          <TableCell>{formatCurrency(row.fobTotal)}</TableCell>
                          <TableCell>{formatCurrency(row.frete)}</TableCell>
                          <TableCell>{formatCurrency(row.seguro)}</TableCell>
                          <TableCell>{formatCurrency(row.ii)}</TableCell>
                          <TableCell>{formatCurrency(row.ipi)}</TableCell>
                          <TableCell>{formatCurrency(row.pis)}</TableCell>
                          <TableCell>{formatCurrency(row.cofins)}</TableCell>
                          <TableCell>{formatCurrency(row.antidumping)}</TableCell>
                          <TableCell>{formatPercent(row.icmsRate)}</TableCell>
                          <TableCell>
                            {formatCurrency(row.despesaRateada)}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(row.despesaBaseIcms)}
                          </TableCell>
                          <TableCell className="font-semibold">
                            {row.custoUnitImportacao !== null
                              ? formatCurrency(row.custoUnitImportacao)
                              : "—"}
                          </TableCell>
                          <TableCell className="font-semibold">
                            {formatCurrency(row.custoTotalImportacao)}
                          </TableCell>
                          <TableCell>
                            {row.representatividade !== null
                              ? formatCurrency(row.representatividade)
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {row.repSobreFob !== null
                              ? formatPercent(row.repSobreFob)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className="font-bold">
                          TOTAL
                        </TableCell>
                        <TableCell />
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.fobTotal)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.frete)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.seguro)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.ii)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.ipi)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.pis)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.cofins)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.antidumping)}
                        </TableCell>
                        <TableCell />
                        <TableCell className="font-bold">
                          {formatCurrency(despesaTotal)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.despesaBaseIcms)}
                        </TableCell>
                        <TableCell />
                        <TableCell className="font-bold">
                          {formatCurrency(rateioTotals.custoTotalImportacao)}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="mx-auto mt-6 max-w-6xl">
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Table2 className="h-5 w-5 text-primary" />
                  IPI
                </CardTitle>
                <div className="flex flex-col items-end gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={exportIpiXlsx}
                    disabled={isExporting || !canExportXlsx}
                    title={
                      canExportXlsx
                        ? undefined
                        : exportMissingFields.join(", ")
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    {isExporting ? "Exportando..." : "Exportar planilha"}
                  </Button>
                  {!canExportXlsx && (
                    <span className="text-xs text-destructive">
                      Preencha os campos obrigatórios antes de exportar.
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
                  <div className="space-y-1 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      Despesa (Demonstrativo Importação)
                    </div>
                    <div className="text-sm font-semibold">
                      {formatCurrency(despesaTotal)}
                    </div>
                  </div>
                  <div className="space-y-1 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      margem (Demonstrativo Importação)
                    </div>
                    <div className="text-sm font-semibold">
                      {totalDosProdutos !== null
                        ? formatCurrency(totalDosProdutos)
                        : "—"}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-md border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {IPI_COLUMNS.map((column) => (
                          <TableHead
                            key={column.key}
                            className="whitespace-nowrap bg-[#D7E4BD] text-foreground"
                          >
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ipiRows.map((row) => (
                        <TableRow key={row.item.id}>
                          <TableCell className="font-medium">
                            {row.item.nomeProduto}
                          </TableCell>
                          <TableCell>{row.item.ncm || "—"}</TableCell>
                          <TableCell>{formatNumber(row.peso)}</TableCell>
                          <TableCell>{formatNumber(row.quantidade)}</TableCell>
                          <TableCell>{formatNumber(row.pesoTotal)}</TableCell>
                          <TableCell>
                            {formatCurrency(row.valorTotal)}
                          </TableCell>
                          <TableCell>{formatCurrency(row.seguro)}</TableCell>
                          <TableCell>{formatCurrency(row.frete)}</TableCell>
                          <TableCell>{formatCurrency(row.cif)}</TableCell>
                          <TableCell>{formatCurrency(row.ii)}</TableCell>
                          <TableCell>{formatCurrency(row.ipi)}</TableCell>
                          <TableCell>{formatCurrency(row.pis)}</TableCell>
                          <TableCell>{formatCurrency(row.cofins)}</TableCell>
                          <TableCell className="font-semibold">
                            {formatCurrency(row.total)}
                          </TableCell>
                          <TableCell>
                            {formatPercent(row.porcentagem)}
                          </TableCell>
                          <TableCell>
                            {formatCurrencyOrBlank(row.despesa)}
                          </TableCell>
                          <TableCell>
                            {formatCurrencyOrBlank(row.totalNotaEntrada)}
                          </TableCell>
                          <TableCell>
                            {formatCurrencyOrBlank(row.margem)}
                          </TableCell>
                          <TableCell>
                            {formatPercent(row.aliquotaIpiSaida)}
                          </TableCell>
                          <TableCell>
                            {formatCurrencyOrBlank(row.ipiSaida)}
                          </TableCell>
                          <TableCell className="font-semibold">
                            {formatCurrencyOrBlank(row.valorFinal)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className="font-bold">
                          TOTAL
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatNumber(ipiTotals.pesoTotal)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.valorTotal)}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.cif)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.ii)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.ipi)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.pis)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.cofins)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.total)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {ipiRows.length > 0 ? "100,00%" : "—"}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(despesaTotal)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatCurrency(ipiTotals.totalNotaEntrada)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {totalDosProdutos !== null
                            ? formatCurrency(totalDosProdutos)
                            : "—"}
                        </TableCell>
                        <TableCell />
                        <TableCell className="font-bold">
                          {totalDosProdutos !== null
                            ? formatCurrency(ipiTotals.ipiSaida)
                            : "—"}
                        </TableCell>
                        <TableCell className="font-bold">
                          {totalDosProdutos !== null
                            ? formatCurrency(ipiTotals.valorFinal)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function AliquotaInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(sanitizeDecimalInput(event.target.value))}
          placeholder="0,00"
          className="pr-8"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold">{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/35 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold capitalize">
        {value}
      </div>
    </div>
  );
}
