import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  AlertTriangle,
  ArrowLeft,
  FileBadge2,
  GitBranch,
  HelpCircle,
  Loader2,
  Sparkles,
  Gauge,
} from "lucide-react";

type SearchRow = Tables<"ncm_searches">;
type NcmResultRow = Tables<"ncm_results">;

export const Route = createFileRoute("/historico/$searchId")({
  component: HistoricoDetailPage,
  head: () => ({
    meta: [{ title: "FC Comércio Exterior — Detalhe do Histórico" }],
  }),
});

function HistoricoDetailPage() {
  const { searchId } = Route.useParams();
  const [search, setSearch] = useState<SearchRow | null>(null);
  const [result, setResult] = useState<NcmResultRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      setLoading(true);
      setError("");

      const [searchResponse, resultResponse] = await Promise.all([
        supabase.from("ncm_searches").select("id, query, created_at").eq("id", searchId).maybeSingle(),
        supabase
          .from("ncm_results")
          .select("id, search_id, natureza_funcional, nivel_dados, confianca_maxima_permitida, analise_rgi, perguntas_obrigatorias, falsos_cognatos_alertados, sugestoes_pesquisa, alertas, classifications, created_at")
          .eq("search_id", searchId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (searchResponse.error) {
        setError("Não foi possível carregar a consulta.");
      } else if (!searchResponse.data) {
        setError("Consulta não encontrada.");
      } else {
        setSearch(searchResponse.data as SearchRow);
      }

      if (resultResponse.error) {
        setError("Não foi possível carregar o resultado relacionado.");
      } else if (resultResponse.data) {
        setResult(resultResponse.data as NcmResultRow);
      }

      setLoading(false);
    }

    loadDetail();

    return () => {
      cancelled = true;
    };
  }, [searchId]);

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div>
            <div className="font-bold leading-tight">FC Comércio Exterior</div>
            <div className="text-xs text-muted-foreground leading-tight">Detalhe do histórico</div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/historico">
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Link>
          </Button>
        </div>
      </header>

      <main className="px-4 py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl">{search?.query || "Consulta selecionada"}</CardTitle>
              <CardDescription>Resultado relacionado em ncm_results</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando detalhe...
                </div>
              ) : error ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {error}
                </div>
              ) : result ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3 text-sm">
                    <DetailStat label="Natureza funcional" value={result.natureza_funcional} />
                    <DetailStat label="Qualidade dos dados" value={result.nivel_dados} />
                    <DetailStat label="Teto de confiança" value={result.confianca_maxima_permitida.replace("_", " ")} />
                  </div>

                  <DetailRow icon={<GitBranch className="h-4 w-4 text-primary" />} title="Análise RGI" text={result.analise_rgi} />

                  {result.perguntas_obrigatorias.length > 0 && (
                    <DetailList
                      icon={<HelpCircle className="h-4 w-4 text-primary" />}
                      title="Perguntas obrigatórias"
                      items={result.perguntas_obrigatorias}
                    />
                  )}

                  {result.falsos_cognatos_alertados.length > 0 && (
                    <DetailList
                      icon={<Gauge className="h-4 w-4 text-accent" />}
                      title="Falsos cognatos alertados"
                      items={result.falsos_cognatos_alertados}
                    />
                  )}

                  {result.alertas.length > 0 && (
                    <DetailList
                      icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
                      title="Alertas"
                      items={result.alertas}
                    />
                  )}

                  {result.sugestoes_pesquisa.length > 0 && (
                    <DetailList
                      icon={<Sparkles className="h-4 w-4 text-accent" />}
                      title="Sugestões de pesquisa"
                      items={result.sugestoes_pesquisa}
                    />
                  )}

                  <div className="grid gap-3">
                    {(result.classifications as Array<Record<string, unknown>>).map((c, index) => (
                      <div key={index} className="rounded-lg border border-border/60 bg-background px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
                            <FileBadge2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono text-lg font-semibold">
                              {String(c.ncm ?? "NCM não informado")}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {String(c.descricao ?? "Descrição não informada")}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                          <MiniField label="Confiança" value={String(c.confianca ?? "-")} />
                          <MiniField label="Risco fiscal" value={String(c.nivel_risco ?? "-")} />
                          <MiniField label="II" value={String(c.ii_aliquota ?? "-")} />
                          <MiniField label="IPI" value={String(c.ipi_aliquota ?? "-")} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum resultado encontrado para esta consulta.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function DetailRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function DetailList({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
