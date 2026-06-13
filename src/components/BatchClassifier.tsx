import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Upload, Loader2, FileSpreadsheet, FileText, Download, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { classifyNcmBatch, type NcmBatchItem } from "@/lib/ncm-batch.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type InputRow = { descricao: string; ncm_informado: string };

const MAX_BATCH = 50;
const MAX_DESCRIPTION_CHARS = 1800;

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

function pickDescAndNcm(rows: Record<string, unknown>[]): InputRow[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const descKey =
    keys.find((k) => ["descricao", "descrição", "produto", "item", "mercadoria"].includes(norm(k))) ||
    keys.find((k) => norm(k).includes("descr")) ||
    keys[0];
  const ncmKey = keys.find((k) => norm(k) === "ncm") || keys.find((k) => norm(k).includes("ncm"));
  return rows
    .map((r) => ({
      descricao: String(r[descKey] ?? "").trim(),
      ncm_informado: ncmKey ? String(r[ncmKey] ?? "").trim() : "",
    }))
    .map(normalizeRow)
    .filter((row): row is InputRow => Boolean(row));
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
  const fileRef = useRef<HTMLInputElement>(null);
  const runFn = useServerFn(classifyNcmBatch);

  const mutation = useMutation({
    mutationFn: async (itens: InputRow[]) => runFn({ data: { itens, operacao: "importacao" } }),
    onSuccess: (d) => {
      setResults(d.resultados);
      toast.success(`${d.resultados.length} itens classificados`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleFile(file: File) {
    try {
      const name = file.name.toLowerCase();
      let parsed: InputRow[] = [];
      if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        parsed = pickDescAndNcm(json);
      } else if (name.endsWith(".pdf")) {
        const text = await parsePdf(file);
        parsed = textToRows(text);
      } else {
        toast.error("Formato não suportado. Use .xlsx, .csv ou .pdf");
        return;
      }
      if (!parsed.length) {
        toast.error("Nenhuma descrição válida encontrada no arquivo");
        return;
      }
      setRows(parsed);
      setResults(null);
      toast.success(`${parsed.length} itens lidos do arquivo`);
    } catch (e) {
      toast.error("Falha ao ler o arquivo");
      console.error(e);
    }
  }

  function loadPasted() {
    const parsed = textToRows(pasted);
    if (!parsed.length) return toast.error("Nada para importar");
    setRows(parsed);
    setResults(null);
    toast.success(`${parsed.length} itens carregados`);
  }

  async function runAll() {
    if (!rows.length) return;
    if (rows.length > MAX_BATCH) {
      toast.error(`Máximo ${MAX_BATCH} itens por lote. Divida o arquivo.`);
      return;
    }
    mutation.mutate(normalizeRows(rows));
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

      {rows.length > 0 && (
        <div className="flex items-center justify-between border rounded-md p-3 bg-secondary/30">
          <div className="text-sm">
            <span className="font-medium">{rows.length}</span> itens prontos para classificar
            {rows.length > MAX_BATCH && (
              <span className="text-destructive ml-2">(máx. {MAX_BATCH} por lote)</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setRows([]); setResults(null); }}>
              <Trash2 className="h-4 w-4 mr-1" /> Limpar
            </Button>
            <Button size="sm" onClick={runAll} disabled={mutation.isPending || rows.length > MAX_BATCH}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
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