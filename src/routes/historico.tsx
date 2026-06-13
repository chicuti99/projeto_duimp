import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { ChevronLeft, ChevronRight, History, Loader2 } from "lucide-react";

const ITEMS_PER_PAGE = 10;

type SearchRow = Tables<"ncm_searches">;

export const Route = createFileRoute("/historico")({
  component: HistoricoPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Histórico" },
      {
        name: "description",
        content: "Histórico de classificações NCM realizadas no sistema.",
      },
    ],
  }),
});

function HistoricoPage() {
  const [items, setItems] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function loadHistorico() {
      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("ncm_searches")
        .select("id, query, created_at")
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });

      if (cancelled) return;

      if (error) {
        setError("Não foi possível carregar o histórico.");
        setItems([]);
      } else {
        setItems((data ?? []) as SearchRow[]);
      }

      setLoading(false);
    }

    loadHistorico();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), totalPages));
  }, [totalPages]);

  const visibleItems = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return items.slice(start, start + ITEMS_PER_PAGE);
  }, [items, page]);

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div>
            <div className="font-bold leading-tight">FC Comércio Exterior</div>
            <div className="text-xs text-muted-foreground leading-tight">Histórico de consultas</div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/classificacao">Voltar</Link>
          </Button>
        </div>
      </header>

      <main className="px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                <History className="h-5 w-5" />
              </div>
              <CardTitle className="text-2xl">Histórico</CardTitle>
              <CardDescription>
                Lista das consultas salvas em ncm_searches, com até 10 itens por página.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando histórico...
                </div>
              ) : error ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {error}
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum item encontrado em ncm_searches.
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {visibleItems.map((item, index) => (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        className="group cursor-pointer rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/10 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <span className="mr-2 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
                          {String((page - 1) * ITEMS_PER_PAGE + index + 1).padStart(2, "0")}
                        </span>
                        <span className="transition-colors group-hover:text-primary">
                          {item.query?.trim() || "Consulta não informada"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div className="text-sm text-muted-foreground">
                      Página {page} de {totalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={page <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Anterior
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                        disabled={page >= totalPages}
                      >
                        Próxima
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
