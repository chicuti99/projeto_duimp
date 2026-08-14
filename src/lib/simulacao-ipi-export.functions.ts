import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerFn } from "@tanstack/react-start";
import ExcelJS from "exceljs";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Réplica 1:1 das 3 abas visíveis da planilha modelo (mesmas colunas,
// mesmas linhas/mescla de cabeçalho, mesma cor (#003870 na Rateio
// Produto, #D7E4BD na IPI), mesmo formato de moeda contábil, logo da
// empresa, e as mesmas fórmulas — inclusive entre abas (IPI lê direto
// da Rateio Produto por referência de célula, igual ao original; Rateio
// Produto e IPI leem "Despesa"/"margem" da Demonstrativo Importação).
// Não replicado: o quadro solto de anotações manuais de um embarque
// específico (linhas K40:O53 do arquivo original — "VALOR BL INSERIDO
// POR FERNANDA" etc.), que não tem estrutura de template, só rascunho.
const IpiRowInputSchema = z.object({
  nomeProduto: z.string(),
  ncm: z.string(),
  peso: z.number(),
  quantidade: z.number(),
  valorTotal: z.number(),
  seguro: z.number(),
  frete: z.number(),
  ii: z.number(),
  ipi: z.number(),
  pis: z.number(),
  cofins: z.number(),
  aliquotaIpi: z.number(),
});

const RateioRowInputSchema = z.object({
  nomeProduto: z.string(),
  ncm: z.string(),
  peso: z.number(),
  quantidade: z.number(),
  fobUnit: z.number(),
  frete: z.number(),
  seguro: z.number(),
  iiRate: z.number(),
  ipiRate: z.number(),
  pisRate: z.number(),
  cofinsRate: z.number(),
  antidumping: z.number(),
  icmsRate: z.number(),
});

const DespesaLineInputSchema = z.object({
  label: z.string(),
  value: z.number(),
});

const HeaderInputSchema = z.object({
  identificacao: z.string(),
  processo: z.string(),
  destinoCliente: z.string(),
  ufDestino: z.string(),
  di: z.string(),
  incoterm: z.string(),
  operacaoBeneficiada: z.enum(["sim", "nao"]),
  destinoUf: z.string(),
  contribuinteIcms: z.enum(["sim", "nao"]),
  contribuinteIpi: z.enum(["sim", "nao"]),
  apuracaoFiscal: z.enum(["lucro_real", "lucro_presumido"]),
  possuiSubstituicaoTributaria: z.enum(["sim", "nao"]),
  destinadoA: z.enum(["revenda", "ativo_fixo", "industrializacao"]),
  portoAeroporto: z.string(),
  beneficio: z.string(),
  quantidade: z.string(),
  freteInternoPorConta: z.enum(["emitente", "destinatario"]),
  unidadeMedida: z.enum(["unidade", "peso", "metro", "caixa", "m2", "m3"]),
  qtdeContainer: z.string(),
});

const ExportInputSchema = z.object({
  header: HeaderInputSchema,
  dataOperacao: z.string(),
  ipiRows: z.array(IpiRowInputSchema).min(1),
  rateioRows: z.array(RateioRowInputSchema).min(1),
  adicional: z.number(),
  freteInternacional: z.number(),
  despesaLines: z.array(DespesaLineInputSchema),
  pisRevendaRate: z.number(),
  cofinsRevendaRate: z.number(),
  icmsRevendaRate: z.number(),
  margemRate: z.number(),
  mvaStRate: z.number(),
  aliquotaIcmsStRate: z.number(),
  freteSt: z.number(),
  taxaConversao: z.number(),
  moeda: z.enum(["USD", "EUR"]),
});

const HEADER_FILL_IPI = "FFD7E4BD";
const HEADER_FILL_RATEIO = "FF003870";
const CURRENCY_FORMAT =
  '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-';
const DEMONSTRATIVO_SHEET_NAME = "Demonstrativo Importação";
const RATEIO_SHEET_NAME = "Rateio Produto";
const DEMONSTRATIVO_FRAME_FILL = "FFEF863F";
const DEMONSTRATIVO_BANNER_FILL = "FF003870";
const DEMONSTRATIVO_VALUE_FILL = "FFF2F2F2";
const DEMONSTRATIVO_PANEL_FILL = "FFEAF1FB";
const DEMONSTRATIVO_FIRST_COL = "C";
const DEMONSTRATIVO_LAST_COL = "H";
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, "../assets/dmx-trading-logo.jpeg");

function whiteBold(size = 10) {
  return { name: "Tahoma", size, bold: true, color: { argb: "FFFFFFFF" } };
}

function rateioFill(): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_RATEIO } };
}

// ---------------------------------------------------------------------
// Rateio Produto: mesmas 33 colunas (C:AF) e cabeçalho de 3 linhas
// mescladas do arquivo original.
// ---------------------------------------------------------------------
const RATEIO_COLUMN_WIDTHS: Record<string, number> = {
  C: 52.86,
  D: 25.29,
  E: 18.43,
  F: 18,
  G: 13.86,
  H: 13.86,
  I: 15.57,
  J: 13.43,
  K: 14.43,
  L: 12.29,
  M: 13.29,
  N: 18.29,
  O: 18.29,
  P: 14,
  Q: 11.43,
  R: 13.71,
  S: 7.14,
  T: 13.71,
  U: 10.29,
  V: 17.86,
  W: 16.86,
  X: 9.71,
  Y: 14.57,
  Z: 21.29,
  AA: 13,
  AB: 19.86,
  AC: 13,
  AE: 16.57,
  AF: 14.86,
};

function buildRateioSheet(
  workbook: ExcelJS.Workbook,
  rows: z.infer<typeof RateioRowInputSchema>[],
  despesaRef: string,
  taxaConversao: number,
  moeda: "USD" | "EUR",
) {
  const sheet = workbook.addWorksheet(RATEIO_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 7 }],
  });

  Object.entries(RATEIO_COLUMN_WIDTHS).forEach(([col, width]) => {
    sheet.getColumn(col).width = width;
  });

  sheet.mergeCells("C3:AF3");
  sheet.getCell("C3").value = "PREVISÃO DE CUSTO POR PRODUTO";
  sheet.getCell("C3").font = { name: "Tahoma", size: 18, bold: true };
  sheet.getRow(3).height = 40;

  const headerCells: { range: string; text: string }[] = [
    { range: "C5:C7", text: "PRODUTO" },
    { range: "D5:D7", text: "NCM" },
    { range: "E5:E7", text: "PESO" },
    { range: "F5:F7", text: "QUANT" },
    { range: "G5:L5", text: "VALOR DA MERCADORIA" },
    { range: "M5:Y5", text: "IMPOSTOS DE NACIONALIZAÇÃO" },
    { range: "Z5:Z7", text: "DESPESAS NACIONALIZAÇÃO BASE ICMS" },
    { range: "AA5:AA7", text: "DESPESAS NACIONALIZAÇÃO" },
    { range: "AB5:AB7", text: "CUSTO UNIT DE IMPORTAÇÃO (DISTRIBUIÇÃO)" },
    { range: "AC5:AC7", text: "CUSTO TOTAL (DISTRIBUIÇÃO)" },
    { range: "AE5:AF6", text: "REPRESENTATIVIDADE SOBRE PREÇO CUSTO" },
    { range: "G6:G6", text: "FOB UNIT." },
    { range: "H6:H6", text: "FOB TOTAL" },
    { range: "I6:I6", text: "FOB TOTAL" },
    { range: "J6:J7", text: "ADICIONAL" },
    { range: "K6:K7", text: "FRETE INT'L" },
    { range: "L6:L7", text: "SEGURO" },
    { range: "M6:N7", text: "II" },
    { range: "O6:P7", text: "IPI" },
    { range: "Q6:R7", text: "PIS" },
    { range: "S6:T7", text: "COFINS IMPORTAÇÃO ALIQUOTA EXTRA" },
    { range: "U6:V7", text: "COFINS" },
    { range: "W6:W7", text: "ANTIDUMPING" },
    { range: "X6:Y7", text: "ICMS" },
    { range: "G7:G7", text: moeda },
    { range: "H7:H7", text: moeda },
    { range: "I7:I7", text: "R$" },
    { range: "AE7:AE7", text: "FOB+FRETE" },
    { range: "AF7:AF7", text: "REP. S/ FOB" },
  ];

  headerCells.forEach(({ range, text }) => {
    if (range.includes(":") && range.split(":")[0] !== range.split(":")[1]) {
      sheet.mergeCells(range);
    }
    const firstCell = range.split(":")[0];
    const cell = sheet.getCell(firstCell);
    cell.value = text;
    cell.font = whiteBold();
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = rateioFill();
  });

  // Aplica o preenchimento em todas as células da faixa de cabeçalho
  // (linhas 5-7, colunas C:AF), inclusive as que não têm rótulo próprio.
  for (let r = 5; r <= 7; r += 1) {
    for (const col of Object.keys(RATEIO_COLUMN_WIDTHS)) {
      const cell = sheet.getCell(`${col}${r}`);
      if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb !== HEADER_FILL_RATEIO) {
        cell.fill = rateioFill();
      }
    }
  }
  sheet.getRow(5).height = 18;
  sheet.getRow(6).height = 24.75;
  sheet.getRow(7).height = 20.25;

  const firstDataRow = 8;
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalsRow = lastDataRow + 1;

  rows.forEach((row, index) => {
    const r = firstDataRow + index;

    sheet.getCell(`C${r}`).value = row.nomeProduto;
    sheet.getCell(`D${r}`).value = row.ncm;
    sheet.getCell(`E${r}`).value = row.peso;
    sheet.getCell(`F${r}`).value = row.quantidade;
    sheet.getCell(`G${r}`).value = row.fobUnit;
    sheet.getCell(`H${r}`).value = { formula: `F${r}*G${r}` };
    sheet.getCell(`I${r}`).value = { formula: `H${r}*${taxaConversao}` };
    sheet.getCell(`J${r}`).value = 0;
    sheet.getCell(`K${r}`).value = row.frete;
    sheet.getCell(`L${r}`).value = row.seguro;
    sheet.getCell(`M${r}`).value = row.iiRate;
    sheet.getCell(`N${r}`).value = {
      formula: `(I${r}+J${r}+K${r}+L${r})*M${r}`,
    };
    sheet.getCell(`O${r}`).value = row.ipiRate;
    sheet.getCell(`P${r}`).value = {
      formula: `(I${r}+J${r}+K${r}+L${r}+N${r})*O${r}`,
    };
    sheet.getCell(`Q${r}`).value = row.pisRate;
    sheet.getCell(`R${r}`).value = {
      formula: `(I${r}+J${r}+K${r}+L${r})*Q${r}`,
    };
    sheet.getCell(`S${r}`).value = 0;
    sheet.getCell(`T${r}`).value = {
      formula: `(I${r}+J${r}+K${r}+L${r})*S${r}`,
    };
    sheet.getCell(`U${r}`).value = row.cofinsRate;
    sheet.getCell(`V${r}`).value = {
      formula: `(I${r}+J${r}+K${r}+L${r})*U${r}`,
    };
    sheet.getCell(`W${r}`).value = row.antidumping;
    sheet.getCell(`X${r}`).value = row.icmsRate;
    sheet.getCell(`Y${r}`).value = {
      formula: `((I${r}+J${r}+K${r}+L${r}+N${r}+P${r}+R${r}+T${r}+V${r}+W${r}+AA${r})/(1-X${r}))*X${r}`,
    };
    sheet.getCell(`Z${r}`).value = {
      formula: `IFERROR(($Z$${totalsRow}/$I$${totalsRow})*I${r},0)`,
    };
    sheet.getCell(`AA${r}`).value = {
      formula: `IFERROR(($AA$${totalsRow}/$I$${totalsRow})*I${r},0)`,
    };
    sheet.getCell(`AB${r}`).value = {
      formula: `IFERROR(((I${r}+K${r}+L${r}+N${r}+T${r}+AA${r}+W${r}+Y${r})/F${r}),0)`,
    };
    sheet.getCell(`AC${r}`).value = {
      formula: `IFERROR(((I${r}+K${r}+L${r}+N${r}+T${r}+AA${r}+W${r}+Y${r})),0)`,
    };
    sheet.getCell(`AE${r}`).value = {
      formula: `IFERROR((I${r}+K${r}+L${r})/F${r},"")`,
    };
    sheet.getCell(`AF${r}`).value = { formula: `IFERROR((AE${r}/AB${r}),"")` };

    ["H", "I", "J", "K", "L", "N", "P", "R", "T", "V", "W", "Y", "Z", "AA", "AB", "AC"].forEach(
      (col) => {
        sheet.getCell(`${col}${r}`).numFmt = CURRENCY_FORMAT;
      },
    );
    ["M", "O", "Q", "S", "U", "X"].forEach((col) => {
      sheet.getCell(`${col}${r}`).numFmt = "0.00%";
    });
    sheet.getCell(`AF${r}`).numFmt = "0.00%";
    sheet.getRow(r).eachCell((cell) => {
      cell.font = { name: "Tahoma", size: 10 };
    });
  });

  sheet.getCell(`C${totalsRow}`).value = "TOTAL";
  sheet.getCell(`D${totalsRow}`).value = "-";
  (["E", "F", "H", "I"] as const).forEach((col) => {
    sheet.getCell(`${col}${totalsRow}`).value = {
      formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})`,
    };
  });
  sheet.getCell(`J${totalsRow}`).value = 0;
  (["K", "L", "N", "P", "R", "T", "V", "W", "Y", "AB", "AC", "AE"] as const).forEach(
    (col) => {
      sheet.getCell(`${col}${totalsRow}`).value = {
        formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})`,
      };
    },
  );
  sheet.getCell(`AA${totalsRow}`).value = { formula: despesaRef };
  sheet.getCell(`Z${totalsRow}`).value = { formula: `AA${totalsRow}` };

  [
    "H",
    "I",
    "J",
    "K",
    "L",
    "N",
    "P",
    "R",
    "T",
    "V",
    "W",
    "Y",
    "Z",
    "AA",
    "AB",
    "AC",
  ].forEach((col) => {
    sheet.getCell(`${col}${totalsRow}`).numFmt = CURRENCY_FORMAT;
  });
  sheet.getRow(totalsRow).eachCell((cell) => {
    cell.font = { name: "Tahoma", size: 10, bold: true };
  });

  return { firstDataRow, lastDataRow, totalsRow };
}

// ---------------------------------------------------------------------
// IPI: mesmas 21 colunas (A:U). Cada linha lê direto da Rateio Produto
// por referência de célula (mesmo deslocamento de 6 linhas do original:
// IPI!linha2 = Rateio!linha8).
// ---------------------------------------------------------------------
const IPI_COLUMNS: { header: string; width: number }[] = [
  { header: "PRODUTO ", width: 40 },
  { header: "NCM ", width: 13.71 },
  { header: "PESO ", width: 12.14 },
  { header: "QUANT.", width: 15.57 },
  { header: "PESO TOTAL", width: 15.57 },
  { header: "Valor total ", width: 13.29 },
  { header: "Seguro ", width: 11.43 },
  { header: "Frete ", width: 12.14 },
  { header: "CIF", width: 14.14 },
  { header: "II", width: 16.29 },
  { header: "IPI", width: 13 },
  { header: "PIS", width: 13 },
  { header: "COFINS", width: 13 },
  { header: "Total ", width: 16.29 },
  { header: "Porcetagem", width: 11.43 },
  { header: "Despesa ", width: 13.86 },
  { header: "Total nota de entrada", width: 18.57 },
  { header: "margem ", width: 13.29 },
  { header: "Aliquota IPI ", width: 16.29 },
  { header: "IPI na saida ", width: 14.14 },
  { header: "Valor final ", width: 17.86 },
];

const RATEIO_ROW_OFFSET = 6;

function buildIpiSheet(
  workbook: ExcelJS.Workbook,
  rowCount: number,
  despesaRef: string,
  margemRef: string,
) {
  const sheet = workbook.addWorksheet("IPI", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = IPI_COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Arial", size: 9 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL_IPI },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  const firstDataRow = 2;
  const lastDataRow = firstDataRow + rowCount - 1;
  const totalsRow = lastDataRow + 1;

  for (let r = firstDataRow; r <= lastDataRow; r += 1) {
    const rateioRow = r + RATEIO_ROW_OFFSET;
    const rateioCell = (col: string) => `'${RATEIO_SHEET_NAME}'!${col}${rateioRow}`;

    sheet.getCell(`A${r}`).value = { formula: rateioCell("C") };
    sheet.getCell(`B${r}`).value = { formula: rateioCell("D") };
    sheet.getCell(`C${r}`).value = { formula: rateioCell("E") };
    sheet.getCell(`D${r}`).value = { formula: rateioCell("F") };
    sheet.getCell(`E${r}`).value = { formula: `D${r}*C${r}` };
    sheet.getCell(`F${r}`).value = { formula: rateioCell("I") };
    sheet.getCell(`H${r}`).value = { formula: rateioCell("K") };
    sheet.getCell(`I${r}`).value = { formula: `F${r}+G${r}+H${r}` };
    sheet.getCell(`J${r}`).value = { formula: rateioCell("N") };
    sheet.getCell(`K${r}`).value = { formula: rateioCell("P") };
    sheet.getCell(`L${r}`).value = { formula: rateioCell("R") };
    sheet.getCell(`M${r}`).value = { formula: rateioCell("V") };
    sheet.getCell(`N${r}`).value = {
      formula: `I${r}+J${r}+K${r}+L${r}+M${r}`,
    };
    sheet.getCell(`O${r}`).value = {
      formula: `IFERROR(N${r}/$N$${totalsRow},0)`,
    };
    sheet.getCell(`P${r}`).value = { formula: `O${r}*$P$${totalsRow}` };
    sheet.getCell(`Q${r}`).value = { formula: `N${r}+P${r}` };
    sheet.getCell(`R${r}`).value = { formula: `O${r}*$R$${totalsRow}` };
    sheet.getCell(`S${r}`).value = { formula: rateioCell("O") };
    sheet.getCell(`T${r}`).value = { formula: `R${r}*S${r}` };
    sheet.getCell(`U${r}`).value = { formula: `R${r}+T${r}` };

    ["F", "G", "H", "I", "J", "K", "L", "M", "N", "P", "Q", "R", "T", "U"].forEach(
      (col) => {
        sheet.getCell(`${col}${r}`).numFmt = CURRENCY_FORMAT;
      },
    );
    sheet.getCell(`O${r}`).numFmt = "0.0000%";
    sheet.getCell(`S${r}`).numFmt = "0.00%";
    sheet.getRow(r).eachCell((cell) => {
      cell.font = { name: "Arial", size: 10 };
    });
  }

  sheet.getCell(`A${totalsRow}`).value = "TOTAL";
  (["E", "F", "I", "J", "K", "L", "M", "N", "Q", "T", "U"] as const).forEach(
    (col) => {
      sheet.getCell(`${col}${totalsRow}`).value = {
        formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})`,
      };
    },
  );
  sheet.getCell(`P${totalsRow}`).value = { formula: despesaRef };
  sheet.getCell(`R${totalsRow}`).value = { formula: margemRef };

  ["F", "I", "J", "K", "L", "M", "N", "P", "Q", "R", "T", "U"].forEach((col) => {
    sheet.getCell(`${col}${totalsRow}`).numFmt = CURRENCY_FORMAT;
  });
  sheet.getRow(totalsRow).eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true };
  });

  return { totalsRow };
}

// ---------------------------------------------------------------------
// Demonstrativo Importação: mesma disposição de linhas/colunas do
// arquivo original (rótulo na coluna C, valor em D/F/H conforme a
// seção), logo no topo, mesmas seções.
// ---------------------------------------------------------------------
const DEMONSTRATIVO_ROW_COLS = ["C", "D", "E", "F", "G", "H"] as const;

function sectionLabel(sheet: ExcelJS.Worksheet, row: number, text: string) {
  sheet.mergeCells(`C${row}:G${row}`);
  const label = sheet.getCell(`C${row}`);
  label.value = text;
  label.font = { name: "Tahoma", size: 12, bold: true };
  label.alignment = { vertical: "middle" };
  DEMONSTRATIVO_ROW_COLS.forEach((col) => {
    sheet.getCell(`${col}${row}`).border = { bottom: { style: "hair" } };
  });
  sheet.getRow(row).height = 19;
}

function fieldLabel(sheet: ExcelJS.Worksheet, cellRef: string, text: string) {
  const cell = sheet.getCell(cellRef);
  cell.value = text;
  cell.font = { name: "Tahoma", size: 10, bold: true };
  cell.alignment = { vertical: "middle" };
}

function fieldMoney(
  sheet: ExcelJS.Worksheet,
  cellRef: string,
  value: number | string | { formula: string },
  bold = false,
) {
  const cell = sheet.getCell(cellRef);
  cell.value = value;
  if (typeof value !== "string") {
    cell.numFmt = CURRENCY_FORMAT;
  }
  cell.font = { name: "Tahoma", size: 10, bold };
  cell.alignment = { vertical: "middle", horizontal: "right" };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: DEMONSTRATIVO_VALUE_FILL },
  };
  cell.border = { left: { style: "hair" }, right: { style: "thin" } };
}

// Bloco de identificação (linhas 8-17): rótulo em negrito preto,
// valor em azul (mesma cor de "POR CONTA E ORDEM" e dos campos de
// seleção do arquivo original), com preenchimento cinza opcional para
// os campos "travados"/replicados de outra aba (PRODUTO, NCM,
// Contribuinte ICMS/IPI).
const HEADER_VALUE_COLOR = "FF3333CC";
const HEADER_GREY_FILL = "FFD9D9D9";

function headerFieldLabel(sheet: ExcelJS.Worksheet, cellRef: string, text: string) {
  const cell = sheet.getCell(cellRef);
  cell.value = text;
  cell.font = { name: "Tahoma", size: 12, bold: true };
  cell.alignment = { vertical: "middle" };
}

function headerFieldValue(
  sheet: ExcelJS.Worksheet,
  cellRef: string,
  value: string | number,
  grey = false,
) {
  const cell = sheet.getCell(cellRef);
  cell.value = value;
  cell.font = { name: "Tahoma", size: 12, color: { argb: HEADER_VALUE_COLOR } };
  cell.alignment = { vertical: "middle" };
  if (grey) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_GREY_FILL } };
  }
}

const SIM_NAO_LABEL: Record<string, string> = { sim: "SIM", nao: "NÃO" };
const DESTINADO_A_LABEL: Record<string, string> = {
  revenda: "REVENDA",
  ativo_fixo: "ATIVO FIXO",
  industrializacao: "INDUSTRIALIZAÇÃO",
};
const FRETE_INTERNO_LABEL: Record<string, string> = {
  emitente: "EMITENTE",
  destinatario: "DESTINATÁRIO",
};
const UNIDADE_MEDIDA_LABEL: Record<string, string> = {
  unidade: "UNIDADE",
  peso: "PESO",
  metro: "METRO",
  caixa: "CAIXA",
  m2: "M²",
  m3: "M³",
};
const APURACAO_FISCAL_LABEL: Record<string, string> = {
  lucro_real: "LUCRO REAL",
  lucro_presumido: "LUCRO PRESUMIDO",
};

// Sublinha uma linha de subtotal (VALOR CIF, TOTAL de impostos/despesas/
// créditos) com borda fina de cima e de baixo cobrindo C:H, igual ao
// modelo original.
function subtotalRow(sheet: ExcelJS.Worksheet, row: number) {
  DEMONSTRATIVO_ROW_COLS.forEach((col) => {
    sheet.getCell(`${col}${row}`).border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      ...(col === "H" ? { left: { style: "hair" }, right: { style: "thin" } } : {}),
    };
  });
}

// Faixa azul de destaque (TOTAL CIF+impostos, TOTAL da NF, CUSTO DE
// AQUISIÇÃO) cobrindo C:H, com texto branco em negrito — mesma cor
// (#003870) usada no cabeçalho da aba Rateio Produto.
function bannerRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  text: string,
  value: number | { formula: string },
) {
  sheet.mergeCells(`C${row}:G${row}`);
  DEMONSTRATIVO_ROW_COLS.forEach((col) => {
    sheet.getCell(`${col}${row}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: DEMONSTRATIVO_BANNER_FILL },
    };
  });
  const label = sheet.getCell(`C${row}`);
  label.value = text;
  label.font = whiteBold(12);
  label.alignment = { vertical: "middle" };
  const valueCell = sheet.getCell(`H${row}`);
  valueCell.value = value;
  valueCell.numFmt = CURRENCY_FORMAT;
  valueCell.font = whiteBold(11);
  valueCell.alignment = { vertical: "middle", horizontal: "right" };
  valueCell.border = { left: { style: "hair" }, right: { style: "thin" } };
  sheet.getRow(row).height = 20;
}

// Pinta a moldura laranja (#EF863F) nas colunas B e I, iguais ao arquivo
// modelo, do topo até a última linha usada da aba.
function drawOuterFrame(sheet: ExcelJS.Worksheet, lastRow: number) {
  sheet.getColumn("I").width = 1.71;
  for (let row = 2; row <= lastRow; row += 1) {
    (["B", "I"] as const).forEach((col) => {
      sheet.getCell(`${col}${row}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: DEMONSTRATIVO_FRAME_FILL },
      };
    });
  }
  sheet.getCell("B2").border = { left: { style: "thin" }, top: { style: "thin" } };
  sheet.getCell("I2").border = { right: { style: "thin" }, top: { style: "thin" } };
  sheet.getCell(`B${lastRow}`).border = { left: { style: "thin" }, bottom: { style: "thin" } };
  sheet.getCell(`I${lastRow}`).border = { right: { style: "thin" }, bottom: { style: "thin" } };
  for (let row = 3; row < lastRow; row += 1) {
    sheet.getCell(`B${row}`).border = { left: { style: "thin" } };
    sheet.getCell(`I${row}`).border = { right: { style: "thin" } };
  }
}

// Painel claro de apoio ao cálculo de revenda (Base de Cálculo, PIS,
// COFINS, ICMS, Margem, Total dos produtos etc.), separado visualmente
// do bloco principal com moldura laranja.
function drawSupportPanel(sheet: ExcelJS.Worksheet, firstRow: number, lastRow: number) {
  for (let row = firstRow; row <= lastRow; row += 1) {
    ["B", "C", "D", "E", "F", "G", "H"].forEach((col) => {
      const cell = sheet.getCell(`${col}${row}`);
      if (!cell.fill || cell.fill.type !== "pattern") {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: DEMONSTRATIVO_PANEL_FILL },
        };
      }
    });
  }
}

function buildDemonstrativoSheet(
  workbook: ExcelJS.Workbook,
  data: z.infer<typeof ExportInputSchema>,
  rateioTotalsRow: number,
  ipiTotalsRow: number,
) {
  const sheet = workbook.addWorksheet(DEMONSTRATIVO_SHEET_NAME, {
    views: [{ showGridLines: false }],
  });

  sheet.getColumn("B").width = 1.71;
  sheet.getColumn("C").width = 42;
  sheet.getColumn("D").width = 20;
  sheet.getColumn("E").width = 14;
  sheet.getColumn("F").width = 30;
  sheet.getColumn("G").width = 12;
  sheet.getColumn("H").width = 26;

  try {
    const logoBuffer = readFileSync(LOGO_PATH);
    const imageId = workbook.addImage({
      buffer: logoBuffer as unknown as ExcelJS.Buffer,
      extension: "jpeg",
    });
    sheet.addImage(imageId, {
      tl: { col: 1.3, row: 0.3 },
      ext: { width: 110, height: 110 },
    });
  } catch {
    // Segue sem logo se o arquivo não estiver disponível no ambiente.
  }

  sheet.mergeCells("C3:H3");
  sheet.getCell("C3").value = "PREVISÃO DE CUSTOS COM IMPORTAÇÃO";
  sheet.getCell("C3").font = { name: "Tahoma", size: 18, bold: true };
  sheet.getCell("C3").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(3).height = 70.5;

  sheet.getCell("H4").value = "POR CONTA E ORDEM";
  sheet.getCell("H4").font = { name: "Tahoma", size: 12, bold: true, color: { argb: HEADER_VALUE_COLOR } };
  sheet.getCell("H4").alignment = { horizontal: "right", vertical: "middle" };

  // Faixa "OPERAÇÃO VIA" (linha 6): rótulo em C:E, valor solto em F,
  // igual ao arquivo modelo (G/H só preenchem a faixa azul).
  DEMONSTRATIVO_ROW_COLS.forEach((col) => {
    sheet.getCell(`${col}6`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: DEMONSTRATIVO_BANNER_FILL },
    };
  });
  sheet.mergeCells("C6:E6");
  sheet.getCell("C6").value = "OPERAÇÃO VIA:";
  sheet.getCell("C6").font = whiteBold(14);
  sheet.getCell("C6").alignment = { vertical: "middle" };
  sheet.getCell("F6").value = data.header.destinoUf || "-";
  sheet.getCell("F6").font = whiteBold(14);
  sheet.getCell("F6").alignment = { vertical: "middle" };
  sheet.getRow(6).height = 24;

  // Bloco de identificação (linhas 8-17): duas colunas de rótulo/valor,
  // igual ao arquivo modelo — esquerda (C/D) com identificação do
  // embarque, direita (F/H) com dados logísticos.
  const h = data.header;
  const identRows: {
    row: number;
    leftLabel: string;
    leftValue: string;
    leftGrey?: boolean;
    rightLabel: string;
    rightValue: string | number;
  }[] = [
    {
      row: 8,
      leftLabel: "IDENTIFICAÇÃO:",
      leftValue: h.identificacao,
      rightLabel: "DESTINADO A:",
      rightValue: DESTINADO_A_LABEL[h.destinadoA] ?? h.destinadoA,
    },
    {
      row: 9,
      leftLabel: "PROCESSO:",
      leftValue: h.processo,
      rightLabel: "DI:",
      rightValue: h.di,
    },
    {
      row: 10,
      leftLabel: "PRODUTO:",
      leftValue: "VIDE PLANILHA RATEADA",
      leftGrey: true,
      rightLabel: "PORTO / AEROPORTO:",
      rightValue: h.portoAeroporto,
    },
    {
      row: 11,
      leftLabel: "NCM:",
      leftValue: "VIDE PLANILHA RATEADA",
      leftGrey: true,
      rightLabel: "PESO:",
      rightValue: "",
    },
    {
      row: 12,
      leftLabel: "OPERAÇÃO BENEFICIADA:",
      leftValue: SIM_NAO_LABEL[h.operacaoBeneficiada] ?? h.operacaoBeneficiada,
      rightLabel: "BENEFICIO:",
      rightValue: h.beneficio.toUpperCase(),
    },
    {
      row: 13,
      leftLabel: "DESTINO / CLIENTE:",
      leftValue: [h.destinoCliente, h.ufDestino].filter(Boolean).join(" — "),
      rightLabel: "QUANTIDADE:",
      rightValue: h.quantidade,
    },
    {
      row: 14,
      leftLabel: "CONTRIBUINTE - ICMS:",
      leftValue: SIM_NAO_LABEL[h.contribuinteIcms] ?? h.contribuinteIcms,
      leftGrey: true,
      rightLabel: "INCOTERM:",
      rightValue: h.incoterm,
    },
    {
      row: 15,
      leftLabel: "CONTRIBUINTE - IPI:",
      leftValue: SIM_NAO_LABEL[h.contribuinteIpi] ?? h.contribuinteIpi,
      leftGrey: true,
      rightLabel: "FRETE INTERNO POR CONTA:",
      rightValue: FRETE_INTERNO_LABEL[h.freteInternoPorConta] ?? h.freteInternoPorConta,
    },
    {
      row: 16,
      leftLabel: "APURAÇÃO FISCAL :",
      leftValue: APURACAO_FISCAL_LABEL[h.apuracaoFiscal] ?? h.apuracaoFiscal,
      rightLabel: "UNIDADE / MEDIDA:",
      rightValue: UNIDADE_MEDIDA_LABEL[h.unidadeMedida] ?? h.unidadeMedida,
    },
    {
      row: 17,
      leftLabel: "POSSUI SUBSTITUIÇÃO TRIBUTÁRIA:",
      leftValue: SIM_NAO_LABEL[h.possuiSubstituicaoTributaria] ?? h.possuiSubstituicaoTributaria,
      rightLabel: "QTDE DE CONTAINER:",
      rightValue: h.qtdeContainer,
    },
  ];

  identRows.forEach(({ row, leftLabel, leftValue, leftGrey, rightLabel, rightValue }) => {
    headerFieldLabel(sheet, `C${row}`, leftLabel);
    sheet.mergeCells(`D${row}:E${row}`);
    headerFieldValue(sheet, `D${row}`, leftValue, leftGrey);
    headerFieldLabel(sheet, `F${row}`, rightLabel);
    headerFieldValue(sheet, `H${row}`, rightValue);
  });

  // Faixa "DATA DE CONVERSÃO / TAXA DE CONVERSÃO" (linha 19).
  DEMONSTRATIVO_ROW_COLS.forEach((col) => {
    sheet.getCell(`${col}19`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: DEMONSTRATIVO_BANNER_FILL },
    };
  });
  sheet.getCell("C19").value = "DATA DE CONVERSÃO:";
  sheet.getCell("C19").font = whiteBold(12);
  sheet.getCell("C19").alignment = { vertical: "middle" };
  const dataOperacao = new Date(data.dataOperacao);
  sheet.getCell("D19").value = Number.isNaN(dataOperacao.getTime()) ? null : dataOperacao;
  sheet.getCell("D19").numFmt = "dd/mm/yy";
  sheet.getCell("D19").font = whiteBold(12);
  sheet.getCell("D19").alignment = { vertical: "middle" };
  sheet.getCell("F19").value = "TAXA DE CONVERSÃO:";
  sheet.getCell("F19").font = whiteBold(12);
  sheet.getCell("F19").alignment = { vertical: "middle" };
  sheet.getCell("G19").value = data.moeda;
  sheet.getCell("G19").font = whiteBold(12);
  sheet.getCell("G19").alignment = { vertical: "middle" };
  sheet.getCell("H19").value = data.taxaConversao;
  sheet.getCell("H19").numFmt = "0.0000";
  sheet.getCell("H19").font = whiteBold(12);
  sheet.getCell("H19").alignment = { vertical: "middle" };
  sheet.getRow(19).height = 20;

  sectionLabel(sheet, 21, "VALOR DA MERCADORIA");
  fieldLabel(sheet, "C22", "Valor");
  fieldMoney(sheet, "H22", { formula: `'${RATEIO_SHEET_NAME}'!I${rateioTotalsRow}` });
  fieldLabel(sheet, "C23", "Adicional");
  fieldMoney(sheet, "H23", data.adicional);
  fieldLabel(sheet, "C24", "Frete Internacional");
  fieldMoney(sheet, "H24", data.freteInternacional);
  fieldLabel(sheet, "C25", "Seguro");
  fieldMoney(sheet, "H25", { formula: `'${RATEIO_SHEET_NAME}'!L${rateioTotalsRow}` });
  fieldLabel(sheet, "C26", "VALOR CIF");
  fieldMoney(sheet, "H26", { formula: "SUM(H22:H25)" }, true);
  subtotalRow(sheet, 26);

  sectionLabel(sheet, 28, "IMPOSTOS DE NACIONALIZAÇÃO");
  fieldLabel(sheet, "C29", "Imposto de Importação");
  fieldMoney(sheet, "H29", { formula: `'${RATEIO_SHEET_NAME}'!N${rateioTotalsRow}` });
  fieldLabel(sheet, "C30", "IPI");
  fieldMoney(sheet, "H30", { formula: `'${RATEIO_SHEET_NAME}'!P${rateioTotalsRow}` });
  fieldLabel(sheet, "C31", "PIS");
  fieldMoney(sheet, "H31", { formula: `'${RATEIO_SHEET_NAME}'!R${rateioTotalsRow}` });
  fieldLabel(sheet, "C32", "COFINS");
  fieldMoney(sheet, "H32", { formula: `'${RATEIO_SHEET_NAME}'!V${rateioTotalsRow}` });
  fieldLabel(sheet, "C33", "COFINS - Custo");
  fieldMoney(sheet, "H33", { formula: `'${RATEIO_SHEET_NAME}'!T${rateioTotalsRow}` });
  fieldLabel(sheet, "C34", "Direitos Antidumping");
  fieldMoney(sheet, "H34", { formula: `'${RATEIO_SHEET_NAME}'!W${rateioTotalsRow}` });
  fieldLabel(sheet, "C35", "ICMS");
  fieldMoney(sheet, "H35", "DIFERIDO");
  sheet.getCell("H35").alignment = { vertical: "middle", horizontal: "center" };
  fieldLabel(sheet, "C36", "TOTAL");
  fieldMoney(sheet, "H36", { formula: "H29+H30+H31+H32" }, true);
  subtotalRow(sheet, 36);

  bannerRow(sheet, 38, "TOTAL (CIF s/ adicional + IMPOSTOS)", { formula: "(H26+H36)-H23" });

  sectionLabel(sheet, 40, "DESPESAS COM NACIONALIZAÇÃO");
  let despesaRow = 41;
  const despesaFirstRow = despesaRow;
  data.despesaLines.forEach((line) => {
    fieldLabel(sheet, `C${despesaRow}`, line.label || "Despesa");
    fieldMoney(sheet, `H${despesaRow}`, line.value);
    despesaRow += 1;
  });
  const despesaLastRow = despesaRow - 1;
  const despesaTotalRow = Math.max(despesaRow, 70);
  fieldLabel(sheet, `C${despesaTotalRow}`, "TOTAL");
  if (despesaLastRow >= despesaFirstRow) {
    fieldMoney(
      sheet,
      `H${despesaTotalRow}`,
      { formula: `SUM(H${despesaFirstRow}:H${despesaLastRow})` },
      true,
    );
  } else {
    fieldMoney(sheet, `H${despesaTotalRow}`, 0, true);
  }
  subtotalRow(sheet, despesaTotalRow);

  const totalNfRow = despesaTotalRow + 2;
  bannerRow(sheet, totalNfRow, "TOTAL DA NOTA FISCAL DE NACIONALIZAÇÃO", {
    formula: `H38+H${despesaTotalRow}`,
  });

  const creditoHeaderRow = totalNfRow + 2;
  sectionLabel(sheet, creditoHeaderRow, "CRÉDITO DOS TRIBUTOS");
  const creditoIpiRow = creditoHeaderRow + 1;
  fieldLabel(sheet, `C${creditoIpiRow}`, "Crédito IPI");
  fieldMoney(sheet, `H${creditoIpiRow}`, { formula: "-H30" });
  const creditoPisRow = creditoIpiRow + 1;
  fieldLabel(sheet, `C${creditoPisRow}`, "Crédito PIS");
  fieldMoney(sheet, `H${creditoPisRow}`, { formula: "-H31" });
  const creditoCofinsRow = creditoPisRow + 1;
  fieldLabel(sheet, `C${creditoCofinsRow}`, "Crédito COFINS");
  fieldMoney(sheet, `H${creditoCofinsRow}`, { formula: "-H32" });
  const creditoTotalRow = creditoCofinsRow + 1;
  fieldLabel(sheet, `C${creditoTotalRow}`, "TOTAL");
  fieldMoney(
    sheet,
    `H${creditoTotalRow}`,
    { formula: `H${creditoIpiRow}+H${creditoPisRow}+H${creditoCofinsRow}` },
    true,
  );
  subtotalRow(sheet, creditoTotalRow);

  const custoAquisicaoRow = creditoTotalRow + 2;
  bannerRow(sheet, custoAquisicaoRow, "CUSTO DE AQUISIÇÃO DA MERCADORIA IMPORTADA", {
    formula: `H${creditoTotalRow}+H${totalNfRow}`,
  });

  drawOuterFrame(sheet, custoAquisicaoRow + 1);

  const revendaHeaderRow = custoAquisicaoRow + 3;
  fieldLabel(sheet, `C${revendaHeaderRow}`, "Base de Cálculo NF de saída");
  fieldMoney(sheet, `H${revendaHeaderRow}`, { formula: `H${custoAquisicaoRow}` }, true);

  const pisRevRow = revendaHeaderRow + 2;
  fieldLabel(sheet, `C${pisRevRow}`, "PIS");
  sheet.getCell(`G${pisRevRow}`).value = data.pisRevendaRate / 100;
  sheet.getCell(`G${pisRevRow}`).numFmt = "0.00%";
  const cofinsRevRow = pisRevRow + 1;
  fieldLabel(sheet, `C${cofinsRevRow}`, "COFINS");
  sheet.getCell(`G${cofinsRevRow}`).value = data.cofinsRevendaRate / 100;
  sheet.getCell(`G${cofinsRevRow}`).numFmt = "0.00%";
  const icmsRevRow = cofinsRevRow + 1;
  fieldLabel(sheet, `C${icmsRevRow}`, "ICMS");
  sheet.getCell(`G${icmsRevRow}`).value = data.icmsRevendaRate / 100;
  sheet.getCell(`G${icmsRevRow}`).numFmt = "0.00%";
  const margemRevRow = icmsRevRow + 1;
  fieldLabel(sheet, `C${margemRevRow}`, "Margem de lucro");
  sheet.getCell(`G${margemRevRow}`).value = data.margemRate / 100;
  sheet.getCell(`G${margemRevRow}`).numFmt = "0.00%";
  const porcentagemRow = margemRevRow + 1;
  fieldLabel(sheet, `C${porcentagemRow}`, "Porcentagem");
  sheet.getCell(`G${porcentagemRow}`).value = {
    formula: `1-SUM(G${pisRevRow}:G${margemRevRow})`,
  };
  sheet.getCell(`G${porcentagemRow}`).numFmt = "0.00%";

  const totalDosProdutosRow = porcentagemRow + 2;
  fieldLabel(sheet, `C${totalDosProdutosRow}`, "Total dos produtos");
  fieldMoney(
    sheet,
    `H${totalDosProdutosRow}`,
    { formula: `IFERROR(H${revendaHeaderRow}/G${porcentagemRow},0)` },
    true,
  );
  const ipiSaidaRow = totalDosProdutosRow + 1;
  fieldLabel(sheet, `C${ipiSaidaRow}`, "IPI Saída");
  fieldMoney(sheet, `H${ipiSaidaRow}`, { formula: `'IPI'!T${ipiTotalsRow}` });

  // Bloco "SUBSTITUIÇÃO TRIBUTÁRIA (ICMS-ST)" — BC-ST = (Total dos
  // produtos + Frete + IPI Saída) x (1 + MVA); ICMS-ST = BC-ST x
  // alíquota interna - crédito de ICMS (mesma alíquota da revenda,
  // G${icmsRevRow}). Réplica do bloco "SUBSTITUIÇÃO TRIBUTARIA" da aba
  // Rateio Produto do arquivo modelo (linha do produto, colunas E:K).
  const stHeaderRow = ipiSaidaRow + 2;
  sectionLabel(sheet, stHeaderRow, "SUBSTITUIÇÃO TRIBUTÁRIA (ICMS-ST)");
  const mvaStRow = stHeaderRow + 1;
  fieldLabel(sheet, `C${mvaStRow}`, "MVA");
  sheet.getCell(`G${mvaStRow}`).value = data.mvaStRate / 100;
  sheet.getCell(`G${mvaStRow}`).numFmt = "0.00%";
  const aliquotaIcmsStRow = mvaStRow + 1;
  fieldLabel(sheet, `C${aliquotaIcmsStRow}`, "Alíquota ICMS-ST");
  sheet.getCell(`G${aliquotaIcmsStRow}`).value = data.aliquotaIcmsStRate / 100;
  sheet.getCell(`G${aliquotaIcmsStRow}`).numFmt = "0.00%";
  const freteStRow = aliquotaIcmsStRow + 1;
  fieldLabel(sheet, `C${freteStRow}`, "Frete (base ST)");
  fieldMoney(sheet, `H${freteStRow}`, data.freteSt);
  const creditoIcmsStRow = freteStRow + 1;
  fieldLabel(sheet, `C${creditoIcmsStRow}`, "Crédito ICMS");
  fieldMoney(sheet, `H${creditoIcmsStRow}`, {
    formula: `H${totalDosProdutosRow}*G${icmsRevRow}`,
  });
  const baseStRow = creditoIcmsStRow + 1;
  fieldLabel(sheet, `C${baseStRow}`, "Base de Cálculo (BC-ST)");
  fieldMoney(sheet, `H${baseStRow}`, {
    formula: `(H${totalDosProdutosRow}+H${freteStRow}+H${ipiSaidaRow})*(1+G${mvaStRow})`,
  });
  const icmsStRow = baseStRow + 1;
  fieldLabel(sheet, `C${icmsStRow}`, "ICMS-ST");
  fieldMoney(
    sheet,
    `H${icmsStRow}`,
    { formula: `H${baseStRow}*G${aliquotaIcmsStRow}-H${creditoIcmsStRow}` },
    true,
  );
  subtotalRow(sheet, icmsStRow);

  const totalDaNfRow = icmsStRow + 2;
  bannerRow(sheet, totalDaNfRow, "Total da NF", {
    formula: `H${totalDosProdutosRow}+H${ipiSaidaRow}+H${icmsStRow}`,
  });

  drawSupportPanel(sheet, revendaHeaderRow, totalDaNfRow);

  return {
    despesaRef: `'${DEMONSTRATIVO_SHEET_NAME}'!H${despesaTotalRow}`,
    totalDosProdutosRef: `'${DEMONSTRATIVO_SHEET_NAME}'!H${totalDosProdutosRow}`,
  };
}

export const exportSimulacaoIpiXlsx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExportInputSchema.parse(input))
  .handler(async ({ data }) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FC Comércio Exterior";
    workbook.created = new Date();

    // Linha de totais de cada aba é só aritmética sobre a quantidade de
    // produtos e o tamanho do bloco de despesas — dá pra calcular antes
    // de montar as abas e criar tudo na ordem certa (Demonstrativo,
    // Rateio Produto, IPI, igual ao arquivo original).
    const rateioTotalsRow = 8 + data.rateioRows.length;
    const ipiTotalsRow = 2 + data.ipiRows.length;

    const demonstrativo = buildDemonstrativoSheet(
      workbook,
      data,
      rateioTotalsRow,
      ipiTotalsRow,
    );
    buildRateioSheet(
      workbook,
      data.rateioRows,
      demonstrativo.despesaRef,
      data.taxaConversao,
      data.moeda,
    );
    buildIpiSheet(
      workbook,
      data.ipiRows.length,
      demonstrativo.despesaRef,
      demonstrativo.totalDosProdutosRef,
    );

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      base64: Buffer.from(buffer).toString("base64"),
      filename: `simulacao-custos-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  });
