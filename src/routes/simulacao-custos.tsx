import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Edit3,
  Menu,
  PackagePlus,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type SimNao = "sim" | "nao";

type CostItem = {
  id: string;
  nomeProduto: string;
  contribuinteIcms: SimNao;
  contribuinteIpi: SimNao;
  ncm: string;
  peso: string;
  quantidade: string;
  fobUnit: string;
  frete: string;
  seguro: string;
  expanded: boolean;
};

const STORAGE_KEY = "fc-simulacao-custos-items";

const EMPTY_ITEM: Omit<CostItem, "id" | "expanded"> = {
  nomeProduto: "",
  contribuinteIcms: "sim",
  contribuinteIpi: "sim",
  ncm: "",
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);
}

function calculateItem(item: CostItem) {
  const quantidade = toNumber(item.quantidade);
  const peso = toNumber(item.peso);
  const fobUnit = toNumber(item.fobUnit);
  const frete = toNumber(item.frete);
  const seguro = toNumber(item.seguro);
  const fobTotal = quantidade * fobUnit;
  const cif = fobTotal + frete + seguro;
  const custoUnitario = quantidade > 0 ? cif / quantidade : 0;

  return {
    quantidade,
    peso,
    fobTotal,
    cif,
    custoUnitario,
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
  const [items, setItems] = useState<CostItem[]>([]);
  const [form, setForm] = useState(EMPTY_ITEM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setStorageReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as CostItem[];
      setItems(Array.isArray(parsed) ? parsed : []);
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

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          const calculated = calculateItem(item);

          acc.peso += calculated.peso;
          acc.quantidade += calculated.quantidade;
          acc.fob += calculated.fobTotal;
          acc.cif += calculated.cif;

          return acc;
        },
        { peso: 0, quantidade: 0, fob: 0, cif: 0 },
      ),
    [items],
  );

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_ITEM);
    setEditingId(null);
  };

  const saveItem = () => {
    const trimmedName = form.nomeProduto.trim();

    if (!trimmedName) return;

    if (editingId) {
      setItems((current) =>
        current.map((item) =>
          item.id === editingId
            ? { ...item, ...form, nomeProduto: trimmedName }
            : item,
        ),
      );
    } else {
      setItems((current) => [
        {
          id: createId(),
          ...form,
          nomeProduto: trimmedName,
          expanded: true,
        },
        ...current,
      ]);
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
                  <Input
                    id="ncm"
                    value={form.ncm}
                    onChange={(event) => updateForm("ncm", event.target.value)}
                    placeholder="2207.10.10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="peso">Peso</Label>
                  <Input
                    id="peso"
                    inputMode="decimal"
                    value={form.peso}
                    onChange={(event) => updateForm("peso", event.target.value)}
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
                      updateForm("quantidade", event.target.value)
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
                      updateForm("fobUnit", event.target.value)
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
                      updateForm("frete", event.target.value)
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
                      updateForm("seguro", event.target.value)
                    }
                    placeholder="200"
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
                label="CIF total"
                value={formatCurrency(totals.cif)}
              />
            </div>

            <div className="space-y-3">
              {items.length === 0 ? (
                <Card className="border-dashed border-border/80 bg-muted/20 shadow-none">
                  <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <Coins className="h-10 w-10 text-muted-foreground" />
                    <div>
                      <div className="font-medium">
                        Nenhum produto na simulação.
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Preencha os campos ao lado para começar a lista.
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                items.map((item, index) => {
                  const calculated = calculateItem(item);

                  return (
                    <Collapsible
                      key={item.id}
                      open={item.expanded}
                      onOpenChange={() => toggleItem(item.id)}
                    >
                      <Card className="overflow-hidden border-border/60 shadow-sm">
                        <div className="flex items-start justify-between gap-3 p-4">
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
                                    CIF {formatCurrency(calculated.cif)}
                                  </span>
                                </span>
                              </span>
                            </button>
                          </CollapsibleTrigger>

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
                              label="Custo unitário"
                              value={formatCurrency(calculated.custoUnitario)}
                            />
                            <Detail
                              label="Custo total"
                              value={formatCurrency(calculated.cif)}
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
      </main>
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
