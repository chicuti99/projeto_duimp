import { useRef, useState } from "react";
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
} from "lucide-react";
import {
  classifyNcmBatch,
  extractNcmRowsFromPdfImages,
  type NcmBatchItem,
} from "@/lib/ncm-batch.functions";
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
    ["quantidade", "quantity", "qty", "preco", "price", "subtotal"].some(
      (hint) => header.includes(hint),
    ),
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

  const headers = makeUniqueHeader(matrix[headerIndex] ?? [], width);
  return matrix
    .slice(headerIndex + 1)
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
  if (!keys.length || !hasProductColumnIntent(keys)) return null;

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
    ["item", "description", "descricao", "ncm", "hscode"].includes(normalized)
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
    .replace(/^\s*(?:item|it\.?|no\.?|n[ºo])?\s*\d{1,6}\s*[-.)|:]?\s+/i, "")
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
    setResults(null);
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
        setResults(null);
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
        setResults(null);
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
            data: { itens: lotes[i], operacao: "importacao" },
          });
          acumulado.push(...resultado.resultados);
          setResults([...acumulado]);
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
    toast.success(
      `${acumulado.length} itens classificados${lotes.length > 1 ? ` em ${lotes.length} lotes` : ""}`,
    );
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
    XLSX.writeFile(
      wb,
      `classificacao-ncm-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" /> Classificação em lote
          (planilha ou PDF)
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Envie .xlsx, .csv ou .pdf com sua lista de produtos. A IA sugere NCM e
          alíquotas e marca divergências em relação ao NCM que você já tem.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 text-center">
          <Upload className="h-7 w-7 text-muted-foreground" />
          <div className="text-sm font-medium">Anexar arquivo</div>
          <div className="text-xs text-muted-foreground">
            .xlsx, .xls, .csv ou .pdf — colunas sugeridas: Descrição e NCM
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
            size="sm"
            variant="outline"
            onClick={loadPasted}
            disabled={!pasted.trim()}
          >
            Carregar lista
          </Button>
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
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {results.filter((r) => r.divergencia).length} divergência(s)
              detectada(s)
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
                  <tr
                    key={i}
                    className={`border-t ${r.divergencia ? "bg-destructive/5" : ""}`}
                  >
                    <td className="p-2 max-w-[220px]">
                      {r.descricao_original}
                    </td>
                    <td className="p-2 font-mono">{r.ncm_informado || "—"}</td>
                    <td className="p-2 font-mono font-semibold">
                      {r.ncm_sugerido}
                      {r.divergencia ? (
                        <Badge
                          variant="destructive"
                          className="ml-1 text-[10px]"
                        >
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
                    <td className="p-2 max-w-[160px]">
                      {r.tratamento_administrativo}
                    </td>
                    <td className="p-2 max-w-[220px] text-muted-foreground">
                      {r.observacao}
                    </td>
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
