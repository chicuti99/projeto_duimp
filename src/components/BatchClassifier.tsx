import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { Upload, Loader2, FileSpreadsheet, FileText, Download, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { classifyNcmBatch, type NcmBatchItem } from "@/lib/ncm-batch.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type InputRow = { descricao: string; ncm_informado: string };

// Tamanho máximo aceito por chamada à IA (ncm-batch.functions.ts limita a
// 50 no input validator). Arquivos maiores são divididos em vários lotes
// desse tamanho e processados um atrás do outro — ver runAll().
const MAX_BATCH = 50;
const MAX_DESCRIPTION_CHARS = 1800;

// Mensagens que ncm-batch.functions.ts usa pra erros que valem retry
// automático (sobrecarga/timeout do Gemini — ver classifyNcmBatch). Erros
// de validação/schema não batem aqui e falham na hora, sem retry.
const RETRYABLE_ERROR_HINT = "sobrecarregado ou demorou demais";
const MAX_LOTE_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeRow(row: InputRow): InputRow | null {
  const normalized = row.descricao.replace(/\s+/g, " ").trim();
  const descricao =
    normalized.length > MAX_DESCRIPTION_CHARS
      ? `${normalized.slice(0, MAX_DESCRIPTION_CHARS - 18).trim()}… [texto reduzido]`
      : normalized;
  if (descricao.length < 2) return null;
  return { descricao, ncm_informado: row.ncm_informado.trim() };
}

function normalizeRows(input: InputRow[]) {
  return input.map(normalizeRow).filter((row): row is InputRow => Boolean(row));
}

// Sentinela pro <Select> de NCM — Radix não aceita SelectItem value="".
const NONE_COLUMN = "__nenhuma__";

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const DESCRICAO_HEADER_HINTS = [
  "produto",
  "mercadoria",
  "item",
  "goods",
  "commodity",
  "especificacao",
  "discriminacao",
  "nomeproduto",
  "productname",
];
const NCM_HEADER_HINTS = ["ncm", "nbm", "sh", "hscode", "harmonizedcode"];

function sampleColumnValues(rows: Record<string, unknown>[], key: string, limit = 40): string[] {
  const values: string[] = [];
  for (const row of rows) {
    if (values.length >= limit) break;
    const value = String(row[key] ?? "").trim();
    if (value) values.push(value);
  }
  return values;
}

// Planilhas de clientes não seguem um formato fixo — nome de cabeçalho
// sozinho engana fácil (ex.: coluna "Item" com só o número da linha
// vencia "Description" só por estar na lista de sinônimos). Por isso o
// conteúdo pesa mais que o nome: penaliza colunas majoritariamente
// numéricas (índice, quantidade, código) e premia texto mais longo e
// variado, que é como descrição de produto normalmente se parece.
function scoreDescricaoColumn(key: string, values: string[]): number {
  if (!values.length) return -Infinity;

  const header = normalizeHeader(key);
  let score = 0;
  if (header.includes("descr")) score += 4;
  else if (DESCRICAO_HEADER_HINTS.some((hint) => header.includes(hint))) score += 2;

  const numericRatio = values.filter((v) => /^-?\d+([.,]\d+)?$/.test(v)).length / values.length;
  score -= numericRatio * 6;

  const avgLength = values.reduce((sum, v) => sum + v.length, 0) / values.length;
  score += Math.min(avgLength / 8, 4);

  const uniqueRatio = new Set(values.map((v) => v.toLowerCase())).size / values.length;
  score += uniqueRatio * 1.5;

  return score;
}

// Mesma lógica pro NCM: o conteúdo batendo o padrão XXXX.XX.XX pesa bem
// mais que o nome da coluna — assim uma coluna "Cód. Fiscal" com NCMs de
// verdade vence uma "NCM" vazia ou com outra coisa dentro.
function scoreNcmColumn(key: string, values: string[]): number {
  if (!values.length) return -Infinity;

  const header = normalizeHeader(key);
  let score = 0;
  if (NCM_HEADER_HINTS.some((hint) => header === hint || header.includes(hint))) score += 2;

  const ncmLikeRatio =
    values.filter((v) => /^\d{4}\.?\d{2}\.?\d{2}$/.test(v.replace(/\s/g, ""))).length / values.length;
  score += ncmLikeRatio * 6;

  return score;
}

// Só o palpite inicial — o usuário confere/troca as colunas na UI antes
// de classificar (ver <Select> de mapeamento em BatchClassifier).
function guessColumns(rows: Record<string, unknown>[]): { descKey: string; ncmKey: string } {
  const keys = Object.keys(rows[0] ?? {});
  if (!keys.length) return { descKey: "", ncmKey: NONE_COLUMN };

  let descKey = keys[0];
  let bestDescScore = -Infinity;
  let ncmKey = NONE_COLUMN;
  let bestNcmScore = 0; // exige sinal mínimo de conteúdo/nome pra sugerir alguma coluna

  for (const key of keys) {
    const values = sampleColumnValues(rows, key);

    const descScore = scoreDescricaoColumn(key, values);
    if (descScore > bestDescScore) {
      bestDescScore = descScore;
      descKey = key;
    }

    const ncmScore = scoreNcmColumn(key, values);
    if (ncmScore > bestNcmScore) {
      bestNcmScore = ncmScore;
      ncmKey = key;
    }
  }

  return { descKey, ncmKey };
}

function mapRawRows(rows: Record<string, unknown>[], descKey: string, ncmKey: string): InputRow[] {
  if (!descKey) return [];
  return rows.map((r) => ({
    descricao: String(r[descKey] ?? "").trim(),
    ncm_informado: ncmKey && ncmKey !== NONE_COLUMN ? String(r[ncmKey] ?? "").trim() : "",
  }));
}

async function parsePdf(file: File): Promise<string> {
  // dynamic import to keep initial bundle light
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let txt = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    txt += content.items.map((it: any) => it.str).join(" ") + "\n";
  }
  return txt;
}

function textToRows(text: string): InputRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2)
    .map((line) => {
      // detect NCM pattern in the line
      const m = line.match(/(\d{4}\.?\d{2}\.?\d{2})/);
      const ncm = m ? m[1] : "";
      const desc = ncm ? line.replace(m![0], "").replace(/[-–|;,]+/g, " ").trim() : line;
      return { descricao: desc, ncm_informado: ncm };
    })
    .map(normalizeRow)
    .filter((row): row is InputRow => Boolean(row));
}

export function BatchClassifier() {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [results, setResults] = useState<NcmBatchItem[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ loteAtual: number; totalLotes: number; itensFeitos: number } | null>(
    null,
  );
  // Linhas cruas da planilha/CSV + mapeamento de colunas escolhido (por
  // padrão, o palpite de guessColumns). Fica null pra fontes sem coluna
  // (PDF, texto colado) — nesses casos `rows` é preenchido direto.
  const [rawRows, setRawRows] = useState<Record<string, unknown>[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [descKey, setDescKey] = useState("");
  const [ncmKey, setNcmKey] = useState(NONE_COLUMN);
  const fileRef = useRef<HTMLInputElement>(null);
  const runFn = useServerFn(classifyNcmBatch);

  function resetColumnMapping() {
    setRawRows(null);
    setColumns([]);
    setDescKey("");
    setNcmKey(NONE_COLUMN);
  }

  // Chamado tanto pelo palpite inicial (handleFile) quanto pelos <Select>
  // de mapeamento, quando o usuário troca a coluna detectada.
  function applyColumnMapping(sourceRows: Record<string, unknown>[], nextDescKey: string, nextNcmKey: string) {
    setDescKey(nextDescKey);
    setNcmKey(nextNcmKey);
    setRows(normalizeRows(mapRawRows(sourceRows, nextDescKey, nextNcmKey)));
    setResults(null);
  }

  async function handleFile(file: File) {
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (!json.length) {
          toast.error("Nenhuma linha encontrada no arquivo");
          return;
        }
        const cols = Object.keys(json[0]);
        const guess = guessColumns(json);
        setRawRows(json);
        setColumns(cols);
        applyColumnMapping(json, guess.descKey, guess.ncmKey);
        toast.success(`${json.length} linhas lidas do arquivo`, {
          description: `Detectamos "${guess.descKey}" como coluna de descrição — confira/troque abaixo se não for essa.`,
        });
        return;
      }
      if (name.endsWith(".pdf")) {
        const text = await parsePdf(file);
        const parsed = textToRows(text);
        if (!parsed.length) {
          toast.error("Nenhuma descrição válida encontrada no arquivo");
          return;
        }
        resetColumnMapping();
        setRows(parsed);
        setResults(null);
        toast.success(`${parsed.length} itens lidos do arquivo`);
        return;
      }
      toast.error("Formato não suportado. Use .xlsx, .csv ou .pdf");
    } catch (e) {
      toast.error("Falha ao ler o arquivo");
      console.error(e);
    }
  }

  function loadPasted() {
    const parsed = textToRows(pasted);
    if (!parsed.length) return toast.error("Nada para importar");
    resetColumnMapping();
    setRows(parsed);
    setResults(null);
    toast.success(`${parsed.length} itens carregados`);
  }

  async function runAll() {
    if (!rows.length || isRunning) return;

    const lotes = chunk(normalizeRows(rows), MAX_BATCH);
    setResults([]);
    setIsRunning(true);
    setProgress({ loteAtual: 0, totalLotes: lotes.length, itensFeitos: 0 });

    const acumulado: NcmBatchItem[] = [];

    for (let i = 0; i < lotes.length; i++) {
      setProgress({ loteAtual: i + 1, totalLotes: lotes.length, itensFeitos: acumulado.length });

      let lastMessage = "Erro desconhecido";
      let sucesso = false;

      // Sobrecarga/timeout do Gemini (504 etc.) costuma ser transitório —
      // tenta o mesmo lote de novo antes de desistir e abandonar o
      // progresso já feito nos lotes anteriores.
      for (let tentativa = 0; tentativa <= MAX_LOTE_RETRIES; tentativa++) {
        try {
          const resultado = await runFn({ data: { itens: lotes[i], operacao: "importacao" } });
          acumulado.push(...resultado.resultados);
          setResults([...acumulado]);
          sucesso = true;
          break;
        } catch (error) {
          lastMessage = error instanceof Error ? error.message : "Erro desconhecido";
          const podeTentarDeNovo =
            tentativa < MAX_LOTE_RETRIES && lastMessage.includes(RETRYABLE_ERROR_HINT);
          if (!podeTentarDeNovo) break;
          await sleep(RETRY_DELAY_MS);
        }
      }

      if (!sucesso) {
        toast.error(
          lotes.length > 1
            ? `Falha no lote ${i + 1} de ${lotes.length} — ${acumulado.length} itens já classificados foram mantidos.`
            : "Não foi possível classificar.",
          { description: lastMessage },
        );
        setIsRunning(false);
        setProgress(null);
        return;
      }
    }

    setIsRunning(false);
    setProgress(null);
    toast.success(`${acumulado.length} itens classificados${lotes.length > 1 ? ` em ${lotes.length} lotes` : ""}`);
  }

  function exportXlsx() {
    if (!results) return;
    const data = results.map((r) => ({
      Descrição: r.descricao_original,
      "NCM informado": r.ncm_informado,
      "NCM sugerido": r.ncm_sugerido,
      "Descrição NCM": r.descricao_ncm,
      Confiança: r.confianca,
      Divergência: r.divergencia ? "SIM" : "não",
      II: r.ii,
      IPI: r.ipi,
      "PIS/COFINS": r.pis_cofins,
      "Tratamento administrativo": r.tratamento_administrativo,
      Observação: r.observacao,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Classificação");
    XLSX.writeFile(wb, `classificacao-ncm-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" /> Classificação em lote (planilha ou PDF)
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Envie .xlsx, .csv ou .pdf com sua lista de produtos. A IA sugere NCM e alíquotas e marca divergências em relação ao NCM que você já tem.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 text-center">
          <Upload className="h-7 w-7 text-muted-foreground" />
          <div className="text-sm font-medium">Anexar arquivo</div>
          <div className="text-xs text-muted-foreground">.xlsx, .xls, .csv ou .pdf — colunas sugeridas: Descrição e NCM</div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            Selecionar arquivo
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" /> Ou cole uma lista (uma linha por item)
          </label>
          <Textarea
            rows={5}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Ex.:\nChocolate ao leite barra 100g\nMouse óptico USB - 8471.60.53\nCafé torrado em grãos 1kg"}
          />
          <Button size="sm" variant="outline" onClick={loadPasted} disabled={!pasted.trim()}>
            Carregar lista
          </Button>
        </div>
      </div>

      {rawRows && columns.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3 border rounded-md p-3 bg-muted/20">
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Detectamos as colunas abaixo automaticamente pelo conteúdo da planilha — como o formato varia de arquivo
            pra arquivo, confira e troque se não bater com a sua.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Coluna de descrição do produto</label>
            <Select value={descKey} onValueChange={(value) => applyColumnMapping(rawRows, value, ncmKey)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((col) => (
                  <SelectItem key={col} value={col}>
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Coluna de NCM já informado (opcional)</label>
            <Select value={ncmKey} onValueChange={(value) => applyColumnMapping(rawRows, descKey, value)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_COLUMN}>Nenhuma</SelectItem>
                {columns.map((col) => (
                  <SelectItem key={col} value={col}>
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between border rounded-md p-3 bg-secondary/30">
          <div className="text-sm">
            <span className="font-medium">{rows.length}</span> itens prontos para classificar
            {rows.length > MAX_BATCH && (
              <span className="text-muted-foreground ml-2">
                (processado em {Math.ceil(rows.length / MAX_BATCH)} lotes de até {MAX_BATCH})
              </span>
            )}
            {progress && (
              <div className="text-xs text-muted-foreground mt-1">
                Lote {progress.loteAtual} de {progress.totalLotes} — {progress.itensFeitos} de {rows.length} itens
                classificados
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRows([]);
                setResults(null);
                resetColumnMapping();
              }}
              disabled={isRunning}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Limpar
            </Button>
            <Button size="sm" onClick={runAll} disabled={isRunning}>
              {isRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Classificar {rows.length}
            </Button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {results.filter((r) => r.divergencia).length} divergência(s) detectada(s)
            </div>
            <Button size="sm" variant="outline" onClick={exportXlsx}>
              <Download className="h-4 w-4 mr-1" /> Exportar XLSX
            </Button>
          </div>
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 text-left">
                <tr>
                  <th className="p-2">Descrição</th>
                  <th className="p-2">NCM informado</th>
                  <th className="p-2">NCM sugerido</th>
                  <th className="p-2">Conf.</th>
                  <th className="p-2">II</th>
                  <th className="p-2">IPI</th>
                  <th className="p-2">PIS/COFINS</th>
                  <th className="p-2">Anuência</th>
                  <th className="p-2">Obs.</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className={`border-t ${r.divergencia ? "bg-destructive/5" : ""}`}>
                    <td className="p-2 max-w-[220px]">{r.descricao_original}</td>
                    <td className="p-2 font-mono">{r.ncm_informado || "—"}</td>
                    <td className="p-2 font-mono font-semibold">
                      {r.ncm_sugerido}
                      {r.divergencia ? (
                        <Badge variant="destructive" className="ml-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-0.5" /> diverge
                        </Badge>
                      ) : r.ncm_informado ? (
                        <Badge variant="secondary" className="ml-1 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" /> ok
                        </Badge>
                      ) : null}
                    </td>
                    <td className="p-2">{r.confianca}</td>
                    <td className="p-2">{r.ii}</td>
                    <td className="p-2">{r.ipi}</td>
                    <td className="p-2">{r.pis_cofins}</td>
                    <td className="p-2 max-w-[160px]">{r.tratamento_administrativo}</td>
                    <td className="p-2 max-w-[220px] text-muted-foreground">{r.observacao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}