import { Fragment, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import {
  Upload,
  Loader2,
  FileSpreadsheet,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Pencil,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  classifyNcmBatch,
  extractNcmRowsFromPdfImages,
  saveNcmBatchResults,
  type NcmBatchItem,
} from "@/lib/ncm-batch.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type InputRow = { descricao: string; ncm_informado: string };
type Operacao = "importacao" | "exportacao" | "ambos";
type PdfTextToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type PdfTextLine = { y: number; height: number; tokens: PdfTextToken[] };
type PdfOcrImage = {
  page: number;
  mimeType: "image/jpeg";
  data: string;
  kind: string;
};
type SpreadsheetSheetCandidate = {
  sheetName: string;
  rawRows: Record<string, unknown>[];
  mappedRows: InputRow[];
  descKey: string;
  ncmKey: string;
  score: number;
  rowIds: Set<string>;
};
type SpreadsheetParseResult = {
  rawRows: Record<string, unknown>[];
  columns: string[];
  rows: InputRow[];
  descKey: string;
  ncmKey: string;
  includedSheets: string[];
  skippedSheets: string[];
};

// O server aceita até 50, mas o retorno agora inclui descrição LI/DUIMP e
// justificativa por item. Lotes menores evitam resposta gigante/timeout.
const MAX_BATCH = 15;
const MAX_DESCRIPTION_CHARS = 1800;

// Mensagens que ncm-batch.functions.ts usa pra erros que valem retry
// automático (sobrecarga/timeout do Gemini — ver classifyNcmBatch). Erros
// de validação/schema não batem aqui e falham na hora, sem retry.
const RETRYABLE_ERROR_HINT = "sobrecarregado ou demorou demais";
const MAX_LOTE_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const NCM_PATTERN = /\b(?:\d{4}\.\d{2}\.\d{2}|\d{8})\b/g;
const SHEET_COLUMN = "Aba";
const DETECTED_DESC_COLUMN = "Descrição detectada";
const DETECTED_NCM_COLUMN = "NCM detectado";
const PDF_OCR_MAX_PAGES = 25;
const PDF_OCR_TARGET_WIDTH = 2600;
const PDF_OCR_MIN_SCALE = 2.2;
const PDF_OCR_MAX_SCALE = 4.6;
const PDF_OCR_IMAGE_QUALITY = 0.94;
const PDF_OCR_MAX_IMAGES_PER_CALL = 40;
const MAX_PDF_OCR_RETRIES = 2;

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

function formatNcm(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
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
  "codigo",
  "codigoproduto",
  "code",
  "sku",
  "partnumber",
  "modelo",
  "model",
  "referencia",
  "reference",
];
const NCM_HEADER_HINTS = ["ncm", "nbm", "sh", "hscode", "harmonizedcode"];
const PRODUCT_LIST_HEADER_HINTS = DESCRICAO_HEADER_HINTS.filter(
  (hint) => hint !== "item",
);
const ROW_ID_HEADER_HINTS = [
  "codigo",
  "code",
  "sku",
  "partnumber",
  "modelo",
  "model",
  "referencia",
  "reference",
];
const QUANTITY_PRICE_HEADER_HINTS = [
  "quantidade",
  "quantity",
  "qty",
  "preco",
  "price",
  "subtotal",
  "total",
];

function sampleColumnValues(
  rows: Record<string, unknown>[],
  key: string,
  limit = 40,
): string[] {
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
  else if (DESCRICAO_HEADER_HINTS.some((hint) => header.includes(hint)))
    score += 2;

  const numericRatio =
    values.filter((v) => /^-?\d+([.,]\d+)?$/.test(v)).length / values.length;
  score -= numericRatio * 6;

  const avgLength =
    values.reduce((sum, v) => sum + v.length, 0) / values.length;
  score += Math.min(avgLength / 8, 4);

  const uniqueRatio =
    new Set(values.map((v) => v.toLowerCase())).size / values.length;
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
  if (NCM_HEADER_HINTS.some((hint) => header === hint || header.includes(hint)))
    score += 2;

  const ncmLikeRatio =
    values.filter((v) => /^\d{4}\.?\d{2}\.?\d{2}$/.test(v.replace(/\s/g, "")))
      .length / values.length;
  score += ncmLikeRatio * 6;

  return score;
}

// Só o palpite inicial — o usuário confere/troca as colunas na UI antes
// de classificar (ver <Select> de mapeamento em BatchClassifier).
function guessColumns(rows: Record<string, unknown>[]): {
  descKey: string;
  ncmKey: string;
} {
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

function mapRawRows(
  rows: Record<string, unknown>[],
  descKey: string,
  ncmKey: string,
): InputRow[] {
  if (!descKey) return [];
  return rows.map((r) => ({
    descricao: String(r[descKey] ?? "").trim(),
    ncm_informado:
      ncmKey && ncmKey !== NONE_COLUMN ? String(r[ncmKey] ?? "").trim() : "",
  }));
}

function cellToText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function makeUniqueHeader(rawHeader: unknown[], width: number) {
  const seen = new Map<string, number>();

  return Array.from({ length: width }, (_, index) => {
    const base =
      cellToText(rawHeader[index]) || `Coluna ${XLSX.utils.encode_col(index)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base} ${count + 1}` : base;
  });
}

function makeGenericHeaders(width: number) {
  return Array.from(
    { length: width },
    (_, index) => `Coluna ${XLSX.utils.encode_col(index)}`,
  );
}

function hasHeaderIntent(row: unknown[]) {
  const headers = row
    .map((cell) => normalizeHeader(cellToText(cell)))
    .filter(Boolean);

  return headers.some(
    (header) =>
      PRODUCT_LIST_HEADER_HINTS.some((hint) => header.includes(hint)) ||
      NCM_HEADER_HINTS.some((hint) => header.includes(hint)) ||
      QUANTITY_PRICE_HEADER_HINTS.some((hint) => header.includes(hint)),
  );
}

function scoreHeaderRow(row: unknown[], followingRows: unknown[][]) {
  const headers = row
    .map((cell) => normalizeHeader(cellToText(cell)))
    .filter(Boolean);
  if (headers.length < 2) return -Infinity;

  let score = headers.length;
  score +=
    headers.filter((header) =>
      PRODUCT_LIST_HEADER_HINTS.some((hint) => header.includes(hint)),
    ).length * 5;
  score +=
    headers.filter((header) =>
      NCM_HEADER_HINTS.some((hint) => header.includes(hint)),
    ).length * 4;
  score += headers.filter((header) =>
    QUANTITY_PRICE_HEADER_HINTS.some((hint) => header.includes(hint)),
  ).length;
  score +=
    followingRows.filter((nextRow) => nextRow.some((cell) => cellToText(cell)))
      .length * 0.25;

  return score;
}

function sheetToRows(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (!matrix.length) return [];

  const width = Math.max(...matrix.map((row) => row.length));
  let headerIndex = 0;
  let bestScore = -Infinity;
  const searchLimit = Math.min(matrix.length, 25);

  for (let index = 0; index < searchLimit; index++) {
    const score = scoreHeaderRow(
      matrix[index] ?? [],
      matrix.slice(index + 1, index + 6),
    );
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  }

  const hasDetectedHeader = hasHeaderIntent(matrix[headerIndex] ?? []);
  const headers = hasDetectedHeader
    ? makeUniqueHeader(matrix[headerIndex] ?? [], width)
    : makeGenericHeaders(width);
  return matrix
    .slice(hasDetectedHeader ? headerIndex + 1 : 0)
    .map((row) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    })
    .filter((row) => Object.values(row).some((value) => cellToText(value)));
}

function hasProductColumnIntent(keys: string[]) {
  return keys.some((key) => {
    const header = normalizeHeader(key);
    return PRODUCT_LIST_HEADER_HINTS.some((hint) => header.includes(hint));
  });
}

function looksLikeProductCode(value: string) {
  const text = value.trim();
  if (text.length < 4 || text.length > 120) return false;
  if (/^-?\d+([.,]\d+)?$/.test(text)) return false;
  if (/^\d{4}\.?\d{2}\.?\d{2}$/.test(text.replace(/\s/g, ""))) return false;

  return /[A-Za-z]/.test(text) && /\d/.test(text);
}

function scoreProductCodeColumn(values: string[]): number {
  if (values.length < 2) return -Infinity;

  const codeRatio =
    values.filter((value) => looksLikeProductCode(value)).length /
    values.length;
  const uniqueRatio =
    new Set(values.map((value) => value.toLowerCase())).size / values.length;
  const avgLength =
    values.reduce((sum, value) => sum + value.length, 0) / values.length;

  return codeRatio * 8 + uniqueRatio * 1.5 + Math.min(avgLength / 12, 2);
}

function hasProductContentIntent(rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {});
  return keys.some(
    (key) => scoreProductCodeColumn(sampleColumnValues(rows, key)) >= 6,
  );
}

function selectRowIdKey(keys: string[]) {
  return (
    keys.find((key) => {
      const header = normalizeHeader(key);
      return ROW_ID_HEADER_HINTS.some((hint) => header.includes(hint));
    }) ??
    keys.find((key) => normalizeHeader(key) === "item") ??
    ""
  );
}

function getCandidateRowIds(rows: Record<string, unknown>[]) {
  const keys = Object.keys(rows[0] ?? {});
  const idKey = selectRowIdKey(keys);
  const values = new Set<string>();
  if (!idKey) return values;

  for (const row of rows) {
    const value = normalizeHeader(cellToText(row[idKey]));
    if (value) values.add(value);
  }

  return values;
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (!smaller.size) return 0;

  let overlap = 0;
  for (const value of smaller) {
    if (larger.has(value)) overlap += 1;
  }
  return overlap / smaller.size;
}

function buildSheetCandidate(
  sheetName: string,
  rawRows: Record<string, unknown>[],
): SpreadsheetSheetCandidate | null {
  const keys = Object.keys(rawRows[0] ?? {});
  const hasHeaderProductIntent = hasProductColumnIntent(keys);
  const hasContentProductIntent = hasProductContentIntent(rawRows);
  if (!keys.length || (!hasHeaderProductIntent && !hasContentProductIntent))
    return null;

  const guess = guessColumns(rawRows);
  const mappedRows = normalizeRows(
    mapRawRows(rawRows, guess.descKey, guess.ncmKey),
  );
  if (mappedRows.length < 2) return null;

  const descValues = sampleColumnValues(rawRows, guess.descKey);
  const descScore = scoreDescricaoColumn(guess.descKey, descValues);
  const descHeader = normalizeHeader(guess.descKey);
  const hasStrongDescriptionHeader =
    descHeader.includes("descr") ||
    ["produto", "mercadoria", "productname"].some((hint) =>
      descHeader.includes(hint),
    );
  const hasCodeOnlyHeader = ROW_ID_HEADER_HINTS.some((hint) =>
    descHeader.includes(hint),
  );

  let score = Math.min(mappedRows.length, 80) * 0.25 + Math.max(0, descScore);
  if (hasStrongDescriptionHeader) score += 8;
  else if (hasCodeOnlyHeader) score += 2;
  if (hasContentProductIntent) score += 3;
  if (guess.ncmKey !== NONE_COLUMN) score += 4;

  return {
    sheetName,
    rawRows,
    mappedRows,
    descKey: guess.descKey,
    ncmKey: guess.ncmKey,
    score,
    rowIds: getCandidateRowIds(rawRows),
  };
}

function parseSpreadsheetWorkbook(wb: XLSX.WorkBook): SpreadsheetParseResult {
  const candidates = wb.SheetNames.map((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    return sheet ? buildSheetCandidate(sheetName, sheetToRows(sheet)) : null;
  }).filter((candidate): candidate is SpreadsheetSheetCandidate =>
    Boolean(candidate),
  );

  const selected: SpreadsheetSheetCandidate[] = [];
  const skippedSheets: string[] = [];

  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const duplicateOfBetterSheet = selected.some(
      (selectedCandidate) =>
        overlapRatio(candidate.rowIds, selectedCandidate.rowIds) >= 0.75,
    );

    if (duplicateOfBetterSheet) {
      skippedSheets.push(candidate.sheetName);
    } else {
      selected.push(candidate);
    }
  }

  const combinedRawRows = selected.flatMap((candidate) =>
    candidate.rawRows.flatMap((row) => {
      const detectedDescription = cellToText(row[candidate.descKey]);
      const detectedNcm =
        candidate.ncmKey && candidate.ncmKey !== NONE_COLUMN
          ? cellToText(row[candidate.ncmKey])
          : "";
      if (
        !normalizeRow({
          descricao: detectedDescription,
          ncm_informado: detectedNcm,
        })
      )
        return [];

      return [
        {
          [DETECTED_DESC_COLUMN]: detectedDescription,
          [DETECTED_NCM_COLUMN]: detectedNcm,
          [SHEET_COLUMN]: candidate.sheetName,
          ...row,
        },
      ];
    }),
  );
  const originalColumns = Array.from(
    new Set(combinedRawRows.flatMap((row) => Object.keys(row))),
  );
  const columns = [
    DETECTED_DESC_COLUMN,
    DETECTED_NCM_COLUMN,
    SHEET_COLUMN,
    ...originalColumns.filter(
      (column) =>
        ![DETECTED_DESC_COLUMN, DETECTED_NCM_COLUMN, SHEET_COLUMN].includes(
          column,
        ),
    ),
  ];
  const rows = normalizeRows(
    mapRawRows(combinedRawRows, DETECTED_DESC_COLUMN, DETECTED_NCM_COLUMN),
  );

  return {
    rawRows: combinedRawRows,
    columns,
    rows,
    descKey: DETECTED_DESC_COLUMN,
    ncmKey: rows.some((row) => row.ncm_informado)
      ? DETECTED_NCM_COLUMN
      : NONE_COLUMN,
    includedSheets: selected.map((candidate) => candidate.sheetName),
    skippedSheets,
  };
}

function tokenFromPdfItem(item: any): PdfTextToken | null {
  const text = String(item?.str ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const transform = Array.isArray(item?.transform) ? item.transform : [];
  const x = Number(transform[4]);
  const y = Number(transform[5]);
  if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = Number(item?.width) || Math.max(text.length * 5, 1);
  const height =
    Number(item?.height) ||
    Math.abs(Number(transform[3])) ||
    Math.abs(Number(transform[0])) ||
    10;
  return { text, x, y, width, height };
}

function buildPdfTextLines(tokens: PdfTextToken[]): string[] {
  const lines: PdfTextLine[] = [];
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);

  for (const token of sorted) {
    const tolerance = Math.max(2.5, Math.min(7, token.height * 0.55));
    const line = lines.find(
      (candidate) => Math.abs(candidate.y - token.y) <= tolerance,
    );

    if (line) {
      const count = line.tokens.length;
      line.y = (line.y * count + token.y) / (count + 1);
      line.height = Math.max(line.height, token.height);
      line.tokens.push(token);
    } else {
      lines.push({ y: token.y, height: token.height, tokens: [token] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const ordered = line.tokens.sort((a, b) => a.x - b.x);
      const charWidths = ordered
        .map((token) => token.width / Math.max(token.text.length, 1))
        .filter((value) => Number.isFinite(value) && value > 0);
      const avgCharWidth = charWidths.length
        ? charWidths.reduce((sum, value) => sum + value, 0) / charWidths.length
        : 5;

      let text = "";
      let lastRight: number | null = null;

      for (const token of ordered) {
        if (lastRight !== null) {
          const gap = token.x - lastRight;
          if (gap > Math.max(2, avgCharWidth * 0.6) && !text.endsWith(" "))
            text += " ";
        }
        text += token.text;
        lastRight = Math.max(lastRight ?? token.x, token.x + token.width);
      }

      return text.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
  return pdfjs;
}

async function parsePdf(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const tokens = content.items
      .map(tokenFromPdfItem)
      .filter((token): token is PdfTextToken => Boolean(token));
    pages.push(buildPdfTextLines(tokens).join("\n"));
  }
  return pages.join("\n");
}

async function openPdfForOcr(file: File) {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  return pdfjs.getDocument({ data: buf }).promise;
}

function canvasToOcrImage(
  canvas: HTMLCanvasElement,
  pageNumber: number,
  kind: string,
): PdfOcrImage {
  return {
    page: pageNumber,
    kind,
    mimeType: "image/jpeg",
    data:
      canvas.toDataURL("image/jpeg", PDF_OCR_IMAGE_QUALITY).split(",")[1] ?? "",
  };
}

function cropCanvas(
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Não foi possível preparar OCR do PDF.");

  canvas.width = Math.ceil(crop.width);
  canvas.height = Math.ceil(crop.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

function clampCrop(
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
) {
  const x = Math.max(0, Math.min(source.width - 1, crop.x));
  const y = Math.max(0, Math.min(source.height - 1, crop.y));
  const width = Math.max(1, Math.min(source.width - x, crop.width));
  const height = Math.max(1, Math.min(source.height - y, crop.height));
  return { x, y, width, height };
}

async function renderPdfPageForOcr(
  doc: any,
  pageNumber: number,
): Promise<PdfOcrImage[]> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    PDF_OCR_MAX_SCALE,
    Math.max(PDF_OCR_MIN_SCALE, PDF_OCR_TARGET_WIDTH / baseViewport.width),
  );
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Não foi possível preparar OCR do PDF.");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const crops = [
    {
      kind: "pagina-inteira",
      canvas,
    },
    {
      kind: "miolo-amplo",
      canvas: cropCanvas(
        canvas,
        clampCrop(canvas, {
          x: canvas.width * 0.03,
          y: canvas.height * 0.15,
          width: canvas.width * 0.94,
          height: canvas.height * 0.78,
        }),
      ),
    },
    {
      kind: "tabela-produtos-provavel",
      canvas: cropCanvas(
        canvas,
        clampCrop(canvas, {
          x: canvas.width * 0.05,
          y: canvas.height * 0.28,
          width: canvas.width * 0.9,
          height: canvas.height * 0.58,
        }),
      ),
    },
    {
      kind: "cabecalho-e-primeiras-linhas",
      canvas: cropCanvas(
        canvas,
        clampCrop(canvas, {
          x: canvas.width * 0.02,
          y: canvas.height * 0.02,
          width: canvas.width * 0.96,
          height: canvas.height * 0.36,
        }),
      ),
    },
    {
      kind: "rodape-e-continuacao",
      canvas: cropCanvas(
        canvas,
        clampCrop(canvas, {
          x: canvas.width * 0.03,
          y: canvas.height * 0.58,
          width: canvas.width * 0.94,
          height: canvas.height * 0.38,
        }),
      ),
    },
  ];

  return crops.map(({ kind, canvas: crop }) =>
    canvasToOcrImage(crop, pageNumber, kind),
  );
}

function cleanupPdfLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([|,;:])/g, "$1")
    .trim();
}

function isPdfNoiseLine(line: string) {
  const normalized = normalizeHeader(line);
  if (!normalized) return true;
  if (
    [
      "item",
      "description",
      "descricao",
      "ncm",
      "hscode",
      "from",
      "to",
      "date",
      "invoiceno",
      "orderno",
      "shipping",
      "total",
      "paymentto",
    ].includes(normalized)
  )
    return true;

  return [
    "commercialinvoice",
    "comercialinvoice",
    "proformainvoice",
    "packinglist",
    "address",
    "telephone",
    "zipcode",
    "cnpj",
    "vat",
    "notify",
    "consignee",
    "importer",
    "buyer",
    "totalqty",
    "remark",
    "countryoforigin",
    "incoterms",
    "paymentconditions",
    "priceterm",
    "payment",
    "beneficiary",
    "bank",
    "swift",
    "accountno",
    "leadtime",
    "validity",
    "thankyou",
    "eoe",
  ].some((hint) => normalized.includes(hint));
}

function isProductLikeDescription(value: string) {
  const text = value.trim();
  if (text.length < 2 || isPdfNoiseLine(text)) return false;
  if (/^\d{1,6}$/.test(text)) return false;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return false;
  return /[A-Za-zÀ-ÿ]/.test(text);
}

function findNcmInLine(line: string) {
  const matches = [...line.matchAll(NCM_PATTERN)]
    .map((match) => ({
      raw: match[0],
      ncm: formatNcm(match[0]),
      index: match.index ?? 0,
    }))
    .filter((match) => match.ncm);

  if (!matches.length) return null;

  const lineEnd = line.trimEnd().length;
  const labeled = /\b(ncm|hscode|hs\s*code|nbm)\b/i.test(line);
  const trailing = matches.filter(
    (match) => match.index + match.raw.length >= lineEnd - 8,
  );
  const dotted = matches.filter((match) => match.raw.includes("."));

  if (trailing.length) return trailing[trailing.length - 1];
  if (labeled) return matches[matches.length - 1];
  if (dotted.length) return dotted[dotted.length - 1];
  return null;
}

function stripTableRowPrefix(value: string) {
  return value
    .replace(/^\s*(?:item|it\.?|n[ºo])\s*\d{1,6}\s*[-.)|:]\s+/i, "")
    .replace(/^\s*\d{1,6}\s*[-.)|:]\s+/i, "")
    .replace(/^\s*\d{1,6}\s+/i, "")
    .replace(
      /^\s*(?:description|descricao|product|produto|mercadoria)\s*[:|-]?\s*/i,
      "",
    )
    .replace(/\s*(?:ncm|hs\s*code|hscode)\s*[:|-]?\s*$/i, "")
    .replace(/^[\s\-–—|;,.:]+|[\s\-–—|;,.:]+$/g, "")
    .trim();
}

function dedupeRows(input: InputRow[]) {
  const seen = new Set<string>();
  const rows: InputRow[] = [];

  for (const row of input) {
    const key = `${row.descricao.toLowerCase()}::${row.ncm_informado}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return rows;
}

function isInvoiceProductTableHeader(line: string) {
  const normalized = normalizeHeader(line);
  const hasProductHeader = [
    "product",
    "nameoftheproduct",
    "description",
    "descricao",
    "mercadoria",
    "goods",
  ].some((hint) => normalized.includes(hint));
  const hasCommercialColumn = [
    "amount",
    "total",
    "qty",
    "quantity",
    "unit",
    "price",
    "usd",
  ].some((hint) => normalized.includes(hint));

  return hasProductHeader && hasCommercialColumn;
}

function isInvoiceProductTableTerminator(line: string) {
  const normalized = normalizeHeader(line);
  if (
    [
      "total",
      "subtotal",
      "paymentto",
      "remark",
      "remarks",
      "note",
      "notes",
    ].includes(normalized)
  )
    return true;

  return [
    "shippingfee",
    "freight",
    "insurance",
    "paymentto",
    "priceterm",
    "payment",
    "beneficiary",
    "bank",
    "swift",
    "accountno",
    "leadtime",
    "validity",
  ].some((hint) => normalized.includes(hint));
}

function splitInvoiceAmountRow(line: string) {
  const numericValue = String.raw`(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?`;
  const match = line.match(
    new RegExp(
      String.raw`^(?<descricao>.+?)\s+(?<values>${numericValue}(?:\s+${numericValue}){1,5})$`,
      "i",
    ),
  );
  const descricao = stripTableRowPrefix(match?.groups?.descricao ?? "");
  if (!isProductLikeDescription(descricao)) return null;

  return descricao;
}

function extractInvoiceAmountRows(lines: string[]) {
  const headerIndex = lines.findIndex(isInvoiceProductTableHeader);
  if (headerIndex < 0) return [];

  const rows: InputRow[] = [];
  let pendingDescription = "";

  for (const line of lines.slice(headerIndex + 1)) {
    if (isInvoiceProductTableHeader(line)) continue;
    if (isInvoiceProductTableTerminator(line)) break;
    if (isPdfNoiseLine(line)) continue;

    const descricao = splitInvoiceAmountRow(line);
    if (descricao) {
      rows.push({
        descricao: pendingDescription
          ? `${pendingDescription} ${descricao}`.trim()
          : descricao,
        ncm_informado: findNcmInLine(line)?.ncm ?? "",
      });
      pendingDescription = "";
      continue;
    }

    const continuation = stripTableRowPrefix(line);
    if (isProductLikeDescription(continuation)) {
      pendingDescription = pendingDescription
        ? `${pendingDescription} ${continuation}`.trim()
        : continuation;
    }
  }

  return normalizeRows(rows);
}

function extractInlineTableRows(lines: string[]) {
  const rows: InputRow[] = [];
  let pending: InputRow | null = null;

  for (const line of lines) {
    if (isPdfNoiseLine(line)) continue;

    const ncmMatch = findNcmInLine(line);
    if (ncmMatch) {
      const before = stripTableRowPrefix(
        line.slice(0, ncmMatch.index).replace(/[-–—|;,]+/g, " "),
      );
      const after = stripTableRowPrefix(
        line
          .slice(ncmMatch.index + ncmMatch.raw.length)
          .replace(/[-–—|;,]+/g, " "),
      );
      const ncmNearStart =
        ncmMatch.index < 24 ||
        /\b(ncm|hscode|hs\s*code|nbm)\b/i.test(line.slice(0, ncmMatch.index));
      const desc =
        ncmNearStart && isProductLikeDescription(after) ? after : before;

      if (isProductLikeDescription(desc)) {
        rows.push({ descricao: desc, ncm_informado: ncmMatch.ncm });
        pending = null;
      } else if (pending && !pending.ncm_informado) {
        rows.push({ ...pending, ncm_informado: ncmMatch.ncm });
        pending = null;
      }
      continue;
    }

    const desc = stripTableRowPrefix(line);
    if (!isProductLikeDescription(desc)) continue;

    if (/^\s*\d{1,6}\s+/.test(line)) {
      if (pending) rows.push(pending);
      pending = { descricao: desc, ncm_informado: "" };
    } else if (
      pending &&
      pending.descricao.length < MAX_DESCRIPTION_CHARS * 0.8
    ) {
      pending = {
        descricao: `${pending.descricao} ${desc}`,
        ncm_informado: pending.ncm_informado,
      };
    }
  }

  if (pending) rows.push(pending);
  return normalizeRows(rows);
}

function extractStackedColumnRows(lines: string[]) {
  const firstNcmIndex = lines.findIndex((line) => {
    const ncmMatch = findNcmInLine(line);
    return (
      Boolean(ncmMatch) && line.replace(NCM_PATTERN, "").trim().length === 0
    );
  });
  if (firstNcmIndex < 0) return [];

  const descHeaderIndex = lines
    .slice(0, firstNcmIndex)
    .map((line, index) => ({ line, index }))
    .reverse()
    .find(({ line }) =>
      ["description", "descricao", "produto", "mercadoria"].includes(
        normalizeHeader(line),
      ),
    )?.index;
  if (descHeaderIndex === undefined) return [];

  const descriptions = lines
    .slice(descHeaderIndex + 1, firstNcmIndex)
    .map(stripTableRowPrefix)
    .filter(isProductLikeDescription);
  const ncms = lines
    .slice(firstNcmIndex)
    .map((line) => findNcmInLine(line)?.ncm ?? "")
    .filter(Boolean);

  if (descriptions.length < 2 || ncms.length < 2) return [];

  return normalizeRows(
    descriptions.slice(0, ncms.length).map((descricao, index) => ({
      descricao,
      ncm_informado: ncms[index] ?? "",
    })),
  );
}

function textToRows(text: string): InputRow[] {
  const lines = text
    .split(/\r?\n/)
    .map(cleanupPdfLine)
    .filter((line) => line.length >= 2);

  const inlineRows = extractInlineTableRows(lines);
  if (inlineRows.length) return dedupeRows(inlineRows);

  const stackedRows = extractStackedColumnRows(lines);
  if (stackedRows.length) return dedupeRows(stackedRows);

  const invoiceAmountRows = extractInvoiceAmountRows(lines);
  if (invoiceAmountRows.length) return dedupeRows(invoiceAmountRows);

  return dedupeRows(
    normalizeRows(
      lines.filter(isProductLikeDescription).map((line) => ({
        descricao: stripTableRowPrefix(line),
        ncm_informado: findNcmInLine(line)?.ncm ?? "",
      })),
    ),
  );
}

export function BatchClassifier() {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [results, setResults] = useState<NcmBatchItem[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [contexto, setContexto] = useState("");
  const [operacao, setOperacao] = useState<Operacao>("importacao");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{
    loteAtual: number;
    totalLotes: number;
    itensFeitos: number;
  } | null>(null);
  // Linhas cruas da planilha/CSV + mapeamento de colunas escolhido (por
  // padrão, o palpite de guessColumns). Fica null pra fontes sem coluna
  // (PDF, texto colado) — nesses casos `rows` é preenchido direto.
  const [rawRows, setRawRows] = useState<Record<string, unknown>[] | null>(
    null,
  );
  const [columns, setColumns] = useState<string[]>([]);
  const [descKey, setDescKey] = useState("");
  const [ncmKey, setNcmKey] = useState(NONE_COLUMN);
  const fileRef = useRef<HTMLInputElement>(null);
  const runFn = useServerFn(classifyNcmBatch);
  const extractPdfFn = useServerFn(extractNcmRowsFromPdfImages);
  const saveBatchFn = useServerFn(saveNcmBatchResults);
  const [resultPage, setResultPage] = useState(1);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<NcmBatchItem | null>(null);
  const [isSavingHistory, setIsSavingHistory] = useState(false);
  const [historySaved, setHistorySaved] = useState(false);

  async function extractPdfImagesWithRetries(
    images: PdfOcrImage[],
    mode: "page" | "document",
  ) {
    let lastMessage = "Erro desconhecido";

    for (let tentativa = 0; tentativa <= MAX_PDF_OCR_RETRIES; tentativa++) {
      try {
        return await extractPdfFn({
          data: { images: images.slice(0, PDF_OCR_MAX_IMAGES_PER_CALL), mode },
        });
      } catch (error) {
        lastMessage =
          error instanceof Error ? error.message : "Erro desconhecido";
        const podeTentarDeNovo =
          tentativa < MAX_PDF_OCR_RETRIES &&
          lastMessage.includes(RETRYABLE_ERROR_HINT);
        if (!podeTentarDeNovo) break;
        await sleep(RETRY_DELAY_MS);
      }
    }

    throw new Error(lastMessage);
  }

  function resetColumnMapping() {
    setRawRows(null);
    setColumns([]);
    setDescKey("");
    setNcmKey(NONE_COLUMN);
  }

  function resetBatchResults() {
    setResults(null);
    setResultPage(1);
    setEditingIndex(null);
    setEditDraft(null);
    setHistorySaved(false);
  }

  // Chamado tanto pelo palpite inicial (handleFile) quanto pelos <Select>
  // de mapeamento, quando o usuário troca a coluna detectada.
  function applyColumnMapping(
    sourceRows: Record<string, unknown>[],
    nextDescKey: string,
    nextNcmKey: string,
  ) {
    setDescKey(nextDescKey);
    setNcmKey(nextNcmKey);
    setRows(normalizeRows(mapRawRows(sourceRows, nextDescKey, nextNcmKey)));
    resetBatchResults();
  }

  async function handleFile(file: File) {
    try {
      const name = file.name.toLowerCase();
      if (
        name.endsWith(".xlsx") ||
        name.endsWith(".xls") ||
        name.endsWith(".csv")
      ) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parsed = parseSpreadsheetWorkbook(wb);
        if (!parsed.rawRows.length || !parsed.rows.length) {
          toast.error(
            "Nenhuma aba com lista de produtos foi encontrada no arquivo",
          );
          return;
        }
        setRawRows(parsed.rawRows);
        setColumns(parsed.columns);
        setDescKey(parsed.descKey);
        setNcmKey(parsed.ncmKey);
        setRows(parsed.rows);
        resetBatchResults();
        toast.success(
          `${parsed.rows.length} itens lidos de ${parsed.includedSheets.length} aba(s)`,
          {
            description: `Abas usadas: ${parsed.includedSheets.join(", ")}${
              parsed.skippedSheets.length
                ? ` · Abas duplicadas ignoradas: ${parsed.skippedSheets.join(", ")}`
                : ""
            }`,
          },
        );
        return;
      }
      if (name.endsWith(".pdf")) {
        const text = await parsePdf(file);
        let parsed = textToRows(text);
        let usedOcr = false;

        if (!parsed.length) {
          const toastId = toast.loading(
            "PDF sem texto detectado. Aplicando OCR nas páginas...",
          );
          try {
            const doc = await openPdfForOcr(file);
            const pageCount = Math.min(doc.numPages, PDF_OCR_MAX_PAGES);
            const extractedRows: InputRow[] = [];
            const renderedImages: PdfOcrImage[] = [];

            for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
              toast.loading(
                `Preparando OCR da página ${pageNumber} de ${pageCount}...`,
                { id: toastId },
              );
              const images = await renderPdfPageForOcr(doc, pageNumber);
              renderedImages.push(...images);

              toast.loading(
                `Extraindo itens da página ${pageNumber} de ${pageCount}...`,
                { id: toastId },
              );
              const extracted = await extractPdfImagesWithRetries(
                images,
                "page",
              );
              extractedRows.push(...normalizeRows(extracted.itens));

              toast.loading(
                `${extractedRows.length} item(ns) encontrados até agora...`,
                { id: toastId },
              );
            }

            if (!extractedRows.length && renderedImages.length > 1) {
              toast.loading("Tentando OCR com o documento completo...", {
                id: toastId,
              });
              const extracted = await extractPdfImagesWithRetries(
                renderedImages,
                "document",
              );
              extractedRows.push(...normalizeRows(extracted.itens));
            }

            parsed = dedupeRows(extractedRows);
            usedOcr = true;
            toast.dismiss(toastId);

            if (doc.numPages > PDF_OCR_MAX_PAGES) {
              toast.warning(
                `OCR aplicado nas primeiras ${PDF_OCR_MAX_PAGES} páginas`,
                {
                  description: `O PDF tem ${doc.numPages} páginas. Divida o arquivo se houver itens nas páginas restantes.`,
                },
              );
            }
          } catch (error) {
            toast.dismiss(toastId);
            throw error;
          }
        }

        if (!parsed.length) {
          toast.error("Nenhuma descrição válida encontrada no arquivo");
          return;
        }
        resetColumnMapping();
        setRows(parsed);
        resetBatchResults();
        toast.success(
          `${parsed.length} itens lidos do arquivo${usedOcr ? " via OCR" : ""}`,
        );
        return;
      }
      toast.error("Formato não suportado. Use .xlsx, .csv ou .pdf");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro desconhecido";
      toast.error("Falha ao ler o arquivo", { description: message });
      console.error(e);
    }
  }

  function loadPasted() {
    const parsed = textToRows(pasted);
    if (!parsed.length) return toast.error("Nada para importar");
    resetColumnMapping();
    setRows(parsed);
    resetBatchResults();
    toast.success(`${parsed.length} itens carregados`);
  }

  async function runAll() {
    if (!rows.length || isRunning) return;

    const lotes = chunk(normalizeRows(rows), MAX_BATCH);
    setResults([]);
    setResultPage(1);
    setEditingIndex(null);
    setEditDraft(null);
    setHistorySaved(false);
    setIsRunning(true);
    setProgress({ loteAtual: 0, totalLotes: lotes.length, itensFeitos: 0 });

    const acumulado: NcmBatchItem[] = [];

    for (let i = 0; i < lotes.length; i++) {
      setProgress({
        loteAtual: i + 1,
        totalLotes: lotes.length,
        itensFeitos: acumulado.length,
      });

      let lastMessage = "Erro desconhecido";
      let sucesso = false;

      // Sobrecarga/timeout do Gemini (504 etc.) costuma ser transitório —
      // tenta o mesmo lote de novo antes de desistir e abandonar o
      // progresso já feito nos lotes anteriores.
      for (let tentativa = 0; tentativa <= MAX_LOTE_RETRIES; tentativa++) {
        try {
          const resultado = await runFn({
            data: {
              itens: lotes[i],
              operacao,
              contexto,
            },
          });
          acumulado.push(...resultado.resultados);
          setResults([...acumulado]);
          setResultPage(i + 1);
          sucesso = true;
          break;
        } catch (error) {
          lastMessage =
            error instanceof Error ? error.message : "Erro desconhecido";
          const podeTentarDeNovo =
            tentativa < MAX_LOTE_RETRIES &&
            lastMessage.includes(RETRYABLE_ERROR_HINT);
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
    const rejeitados = acumulado.filter((item) => !item.classificavel).length;
    toast.success(
      `${acumulado.length - rejeitados} itens classificados${rejeitados ? `; ${rejeitados} ignorado(s)` : ""}${lotes.length > 1 ? ` em ${lotes.length} lotes` : ""}`,
    );
  }

  function formatResultList(items: string[]) {
    return items.filter(Boolean).join("\n");
  }

  function listToEditableText(items: string[]) {
    return items.join("\n");
  }

  function editableTextToList(value: string) {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function updateEditDraft<K extends keyof NcmBatchItem>(
    key: K,
    value: NcmBatchItem[K],
  ) {
    setEditDraft((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }

  function startEditingResult(index: number) {
    const result = results?.[index];
    if (!result) return;
    setEditingIndex(index);
    setEditDraft({ ...result });
  }

  function cancelEditingResult() {
    setEditingIndex(null);
    setEditDraft(null);
  }

  function saveEditingResult() {
    if (editingIndex === null || !editDraft) return;
    setResults((current) =>
      current
        ? current.map((item, index) =>
            index === editingIndex ? editDraft : item,
          )
        : current,
    );
    setHistorySaved(false);
    cancelEditingResult();
  }

  async function saveResultsToHistory() {
    if (!results?.length || isSavingHistory) return;
    if (editingIndex !== null) {
      toast.error("Conclua ou cancele a edição antes de salvar.");
      return;
    }

    setIsSavingHistory(true);
    try {
      const response = await saveBatchFn({
        data: {
          resultados: results,
          operacao,
          contexto,
          total_itens_lote: results.length,
        },
      });

      const saved = Number(response?.saved ?? 0);
      const ignored = Number(response?.ignored ?? 0);
      const failed = Number(response?.failed ?? 0);

      if (failed > 0) {
        toast.warning(`${saved} item(ns) salvos; ${failed} falharam.`, {
          description:
            ignored > 0 ? `${ignored} entrada(s) ignorada(s).` : undefined,
        });
        return;
      }

      if (saved === 0) {
        toast.warning("Nenhum produto classificável para salvar.", {
          description:
            ignored > 0 ? `${ignored} entrada(s) ignorada(s).` : undefined,
        });
        return;
      }

      setHistorySaved(true);
      toast.success(`${saved} item(ns) salvos no histórico`, {
        description:
          ignored > 0 ? `${ignored} entrada(s) ignorada(s).` : undefined,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro desconhecido";
      toast.error("Não foi possível salvar no histórico.", {
        description: message,
      });
    } finally {
      setIsSavingHistory(false);
    }
  }

  function exportXlsx() {
    if (!results) return;
    const data = results.map((r) => ({
      Descrição: r.descricao_original,
      "Produto classificável": r.classificavel ? "SIM" : "não",
      "Motivo da não classificação": r.motivo_nao_classificacao,
      "Natureza funcional": r.natureza_funcional,
      "Qualidade dos dados": r.nivel_dados,
      "Teto de confiança": r.confianca_maxima_permitida,
      "NCM informado": r.ncm_informado,
      "NCM sugerido": r.ncm_sugerido,
      "Descrição NCM": r.descricao_ncm,
      Capítulo: r.capitulo,
      Confiança: r.confianca,
      "Risco fiscal": r.nivel_risco,
      Divergência: r.divergencia ? "SIM" : "não",
      II: r.ii,
      IPI: r.ipi,
      "PIS/COFINS": r.pis_cofins,
      "Tratamento administrativo": r.tratamento_administrativo,
      Observação: r.observacao,
      "Análise RGI": r.analise_rgi,
      Justificativa: r.justificativa,
      "Justificativa auditável": r.justificativa_auditavel,
      "Descrição sugerida LI": r.descricao_li,
      "Descrição sugerida DUIMP": r.descricao_duimp,
      "Perguntas obrigatórias": formatResultList(r.perguntas_obrigatorias),
      "Falsos cognatos": formatResultList(r.falsos_cognatos_alertados),
      Alertas: formatResultList(r.alertas),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Classificação");
    XLSX.writeFile(
      wb,
      `classificacao-ncm-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  const resultPageCount = Math.max(
    1,
    Math.ceil((results?.length ?? 0) / MAX_BATCH),
  );
  const currentResultPage = Math.min(Math.max(resultPage, 1), resultPageCount);
  const resultPageStart = (currentResultPage - 1) * MAX_BATCH;
  const visibleResults =
    results?.slice(resultPageStart, resultPageStart + MAX_BATCH) ?? [];
  const resultPageEnd = Math.min(
    resultPageStart + MAX_BATCH,
    results?.length ?? 0,
  );

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" /> Classificação em lote de
          produtos
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Envie .xlsx, .csv ou .pdf quando o arquivo tiver uma lista com vários
          produtos. Manual, ficha técnica ou foto de um único item devem ser
          anexados na classificação individual.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 text-center">
          <Upload className="h-7 w-7 text-muted-foreground" />
          <div className="text-sm font-medium">Anexar arquivo</div>
          <div className="text-xs text-muted-foreground">
            Lista em .xlsx, .xls, .csv ou .pdf — colunas sugeridas: Descrição e
            NCM
          </div>
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            Selecionar arquivo
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" /> Ou cole uma lista (uma linha por
            item)
          </label>
          <Textarea
            rows={5}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={
              "Ex.:\nChocolate ao leite barra 100g\nMouse óptico USB - 8471.60.53\nCafé torrado em grãos 1kg"
            }
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={loadPasted}
            disabled={!pasted.trim()}
          >
            Carregar lista
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start">
        <div className="space-y-2">
          <label className="text-sm font-medium">Operação</label>
          <Tabs
            value={operacao}
            onValueChange={(value) => setOperacao(value as Operacao)}
          >
            <TabsList className="bg-secondary">
              <TabsTrigger value="importacao" disabled={isRunning}>
                Importação
              </TabsTrigger>
              <TabsTrigger value="exportacao" disabled={isRunning}>
                Exportação
              </TabsTrigger>
              <TabsTrigger value="ambos" disabled={isRunning}>
                Ambos
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Contexto geral da classificação
          </label>
          <Textarea
            rows={3}
            value={contexto}
            onChange={(e) => setContexto(e.target.value)}
            placeholder="Ex.: produtos para revenda hospitalar; uso industrial; componentes elétricos para painéis de comando; origem China; tensão 220V; material predominante plástico e metal."
            disabled={isRunning}
          />
        </div>
      </div>

      {rawRows && columns.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3 border rounded-md p-3 bg-muted/20">
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Detectamos as colunas abaixo automaticamente pelo conteúdo da
            planilha — como o formato varia de arquivo pra arquivo, confira e
            troque se não bater com a sua.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Coluna de descrição do produto
            </label>
            <Select
              value={descKey}
              onValueChange={(value) =>
                applyColumnMapping(rawRows, value, ncmKey)
              }
            >
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
            <label className="text-xs font-medium">
              Coluna de NCM já informado (opcional)
            </label>
            <Select
              value={ncmKey}
              onValueChange={(value) =>
                applyColumnMapping(rawRows, descKey, value)
              }
            >
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
            <span className="font-medium">{rows.length}</span> itens prontos
            para classificar
            {rows.length > MAX_BATCH && (
              <span className="text-muted-foreground ml-2">
                (processado em {Math.ceil(rows.length / MAX_BATCH)} lotes de até{" "}
                {MAX_BATCH})
              </span>
            )}
            {progress && (
              <div className="text-xs text-muted-foreground mt-1">
                Lote {progress.loteAtual} de {progress.totalLotes} —{" "}
                {progress.itensFeitos} de {rows.length} itens classificados
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setRows([]);
                resetBatchResults();
                resetColumnMapping();
              }}
              disabled={isRunning}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Limpar lote
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={runAll}
              disabled={isRunning}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Classificar {rows.length}
            </Button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1 text-sm text-muted-foreground">
              <div>
                {results.filter((r) => r.divergencia && r.classificavel).length}{" "}
                divergência(s) detectada(s)
                {results.some((r) => !r.classificavel)
                  ? ` · ${results.filter((r) => !r.classificavel).length} entrada(s) ignorada(s)`
                  : ""}
              </div>
              <div>
                Lote {currentResultPage} de {resultPageCount} · itens{" "}
                {results.length ? resultPageStart + 1 : 0}-{resultPageEnd} de{" "}
                {results.length}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setResultPage((page) => Math.max(1, page - 1))}
                disabled={currentResultPage <= 1 || editingIndex !== null}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setResultPage((page) => Math.min(resultPageCount, page + 1))
                }
                disabled={
                  currentResultPage >= resultPageCount || editingIndex !== null
                }
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={exportXlsx}
              >
                <Download className="h-4 w-4 mr-1" /> Exportar XLSX
              </Button>
            </div>
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
                  <th className="p-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleResults.map((r, localIndex) => {
                  const i = resultPageStart + localIndex;
                  return (
                    <Fragment key={i}>
                      <tr
                        className={`border-t ${!r.classificavel ? "bg-muted/30" : r.divergencia ? "bg-destructive/5" : ""}`}
                      >
                        <td className="p-2 max-w-[220px]">
                          {r.descricao_original}
                          {!r.classificavel ? (
                            <Badge
                              variant="secondary"
                              className="mt-1 text-[10px]"
                            >
                              não é produto
                            </Badge>
                          ) : null}
                        </td>
                        <td className="p-2 font-mono">
                          {r.ncm_informado || "—"}
                        </td>
                        <td className="p-2 font-mono font-semibold">
                          {r.ncm_sugerido}
                          {!r.classificavel ? (
                            <Badge
                              variant="secondary"
                              className="ml-1 text-[10px]"
                            >
                              ignorado
                            </Badge>
                          ) : r.divergencia ? (
                            <Badge
                              variant="destructive"
                              className="ml-1 text-[10px]"
                            >
                              <AlertTriangle className="h-3 w-3 mr-0.5" />{" "}
                              diverge
                            </Badge>
                          ) : r.ncm_informado ? (
                            <Badge
                              variant="secondary"
                              className="ml-1 text-[10px]"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> ok
                            </Badge>
                          ) : null}
                          <div className="mt-1 text-[10px] font-normal text-muted-foreground">
                            {r.capitulo}
                          </div>
                        </td>
                        <td className="p-2">
                          <div>{r.confianca}</div>
                          <div className="text-[10px] text-muted-foreground">
                            dados: {r.nivel_dados}
                          </div>
                        </td>
                        <td className="p-2">{r.ii}</td>
                        <td className="p-2">{r.ipi}</td>
                        <td className="p-2">{r.pis_cofins}</td>
                        <td className="p-2 max-w-[160px]">
                          {r.tratamento_administrativo}
                        </td>
                        <td className="p-2 max-w-[220px] text-muted-foreground">
                          {r.classificavel
                            ? r.observacao
                            : r.motivo_nao_classificacao || r.observacao}
                        </td>
                        <td className="p-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditingResult(i)}
                            disabled={isRunning || isSavingHistory}
                            title="Editar resultado"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                      <tr className="border-t bg-muted/10">
                        <td colSpan={10} className="p-3">
                          {editingIndex === i && editDraft ? (
                            <BatchResultEditor
                              draft={editDraft}
                              onChange={updateEditDraft}
                              listToEditableText={listToEditableText}
                              editableTextToList={editableTextToList}
                              onCancel={cancelEditingResult}
                              onSave={saveEditingResult}
                            />
                          ) : (
                            <>
                              <div className="grid gap-3 md:grid-cols-2">
                                <BatchDetailBlock
                                  title="Descrição sugerida — LI"
                                  text={r.descricao_li}
                                />
                                <BatchDetailBlock
                                  title="Descrição sugerida — DUIMP / Catálogo"
                                  text={r.descricao_duimp}
                                />
                                <BatchDetailBlock
                                  title="Justificativa"
                                  text={r.justificativa}
                                />
                                <BatchDetailBlock
                                  title="Justificativa auditável / RGI"
                                  text={`${r.justificativa_auditavel}\n\n${r.analise_rgi}`}
                                />
                              </div>

                              {(r.perguntas_obrigatorias.length > 0 ||
                                r.falsos_cognatos_alertados.length > 0 ||
                                r.alertas.length > 0) && (
                                <div className="mt-3 grid gap-2 md:grid-cols-3">
                                  {r.perguntas_obrigatorias.length > 0 && (
                                    <BatchListBlock
                                      title="Perguntas obrigatórias"
                                      items={r.perguntas_obrigatorias}
                                    />
                                  )}
                                  {r.falsos_cognatos_alertados.length > 0 && (
                                    <BatchListBlock
                                      title="Falsos cognatos"
                                      items={r.falsos_cognatos_alertados}
                                    />
                                  )}
                                  {r.alertas.length > 0 && (
                                    <BatchListBlock
                                      title="Alertas"
                                      items={r.alertas}
                                    />
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t pt-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-muted-foreground">
              Revise e edite os resultados antes de salvar no histórico.
            </div>
            <Button
              type="button"
              size="sm"
              onClick={saveResultsToHistory}
              disabled={
                !results.length ||
                isRunning ||
                isSavingHistory ||
                historySaved ||
                editingIndex !== null
              }
            >
              {isSavingHistory ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              {historySaved ? "Salvo no histórico" : "Salvar no histórico"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function BatchResultEditor({
  draft,
  onChange,
  listToEditableText,
  editableTextToList,
  onCancel,
  onSave,
}: {
  draft: NcmBatchItem;
  onChange: <K extends keyof NcmBatchItem>(
    key: K,
    value: NcmBatchItem[K],
  ) => void;
  listToEditableText: (items: string[]) => string;
  editableTextToList: (value: string) => string[];
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold">Editar resultado</div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={onSave}>
            <Save className="h-4 w-4 mr-1" />
            Aplicar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <EditableSelect
          label="Produto classificável"
          value={draft.classificavel ? "true" : "false"}
          options={[
            ["true", "Sim"],
            ["false", "Não"],
          ]}
          onChange={(value) => onChange("classificavel", value === "true")}
        />
        <EditableTextField
          label="NCM informado"
          value={draft.ncm_informado}
          onChange={(value) => onChange("ncm_informado", value)}
        />
        <EditableTextField
          label="NCM sugerido"
          value={draft.ncm_sugerido}
          onChange={(value) => onChange("ncm_sugerido", value)}
        />
        <EditableSelect
          label="Confiança"
          value={draft.confianca}
          options={[
            ["muito_alta", "muito_alta"],
            ["alta", "alta"],
            ["media", "media"],
            ["baixa", "baixa"],
          ]}
          onChange={(value) =>
            onChange("confianca", value as NcmBatchItem["confianca"])
          }
        />
        <EditableSelect
          label="Qualidade dos dados"
          value={draft.nivel_dados}
          options={[
            ["insuficiente", "insuficiente"],
            ["basico", "basico"],
            ["razoavel", "razoavel"],
            ["completo", "completo"],
          ]}
          onChange={(value) =>
            onChange("nivel_dados", value as NcmBatchItem["nivel_dados"])
          }
        />
        <EditableSelect
          label="Risco fiscal"
          value={draft.nivel_risco}
          options={[
            ["baixo", "baixo"],
            ["medio", "medio"],
            ["alto", "alto"],
          ]}
          onChange={(value) =>
            onChange("nivel_risco", value as NcmBatchItem["nivel_risco"])
          }
        />
        <EditableSelect
          label="Teto de confiança"
          value={draft.confianca_maxima_permitida}
          options={[
            ["baixa", "baixa"],
            ["media", "media"],
            ["alta", "alta"],
            ["muito_alta", "muito_alta"],
          ]}
          onChange={(value) =>
            onChange(
              "confianca_maxima_permitida",
              value as NcmBatchItem["confianca_maxima_permitida"],
            )
          }
        />
        <EditableTextField
          label="II"
          value={draft.ii}
          onChange={(value) => onChange("ii", value)}
        />
        <EditableTextField
          label="IPI"
          value={draft.ipi}
          onChange={(value) => onChange("ipi", value)}
        />
        <EditableTextField
          label="PIS/COFINS"
          value={draft.pis_cofins}
          onChange={(value) => onChange("pis_cofins", value)}
        />
        <EditableTextField
          label="Capítulo"
          value={draft.capitulo}
          onChange={(value) => onChange("capitulo", value)}
        />
        <EditableTextField
          label="Anuência"
          value={draft.tratamento_administrativo}
          onChange={(value) => onChange("tratamento_administrativo", value)}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <EditableTextArea
          label="Descrição original"
          value={draft.descricao_original}
          onChange={(value) => onChange("descricao_original", value)}
        />
        <EditableTextArea
          label="Descrição NCM"
          value={draft.descricao_ncm}
          onChange={(value) => onChange("descricao_ncm", value)}
        />
        <EditableTextArea
          label="Motivo da não classificação"
          value={draft.motivo_nao_classificacao}
          onChange={(value) => onChange("motivo_nao_classificacao", value)}
        />
        <EditableTextArea
          label="Observação"
          value={draft.observacao}
          onChange={(value) => onChange("observacao", value)}
        />
        <EditableTextArea
          label="Justificativa"
          value={draft.justificativa}
          onChange={(value) => onChange("justificativa", value)}
        />
        <EditableTextArea
          label="Justificativa auditável"
          value={draft.justificativa_auditavel}
          onChange={(value) => onChange("justificativa_auditavel", value)}
        />
        <EditableTextArea
          label="Análise RGI"
          value={draft.analise_rgi}
          onChange={(value) => onChange("analise_rgi", value)}
        />
        <EditableTextArea
          label="Natureza funcional"
          value={draft.natureza_funcional}
          onChange={(value) => onChange("natureza_funcional", value)}
        />
        <EditableTextArea
          label="Descrição LI"
          value={draft.descricao_li}
          onChange={(value) => onChange("descricao_li", value)}
        />
        <EditableTextArea
          label="Descrição DUIMP"
          value={draft.descricao_duimp}
          onChange={(value) => onChange("descricao_duimp", value)}
        />
        <EditableTextArea
          label="Perguntas obrigatórias"
          value={listToEditableText(draft.perguntas_obrigatorias)}
          onChange={(value) =>
            onChange("perguntas_obrigatorias", editableTextToList(value))
          }
        />
        <EditableTextArea
          label="Falsos cognatos"
          value={listToEditableText(draft.falsos_cognatos_alertados)}
          onChange={(value) =>
            onChange("falsos_cognatos_alertados", editableTextToList(value))
          }
        />
        <EditableTextArea
          label="Alertas"
          value={listToEditableText(draft.alertas)}
          onChange={(value) => onChange("alertas", editableTextToList(value))}
        />
      </div>
    </div>
  );
}

function EditableTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}</span>
      <Input
        className="h-8 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function EditableTextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}</span>
      <Textarea
        className="min-h-20 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function EditableSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, label]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function BatchDetailBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background p-3">
      <div className="mb-1 text-xs font-semibold">{title}</div>
      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
        {text || "—"}
      </p>
    </div>
  );
}

function BatchListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border/70 bg-background p-3">
      <div className="mb-1 text-xs font-semibold">{title}</div>
      <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
