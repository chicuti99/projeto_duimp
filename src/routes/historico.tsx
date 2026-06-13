import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { History } from "lucide-react";

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
                Aqui você pode listar as classificações anteriores quando a integração estiver
                pronta.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center text-sm text-muted-foreground">
              Nenhum histórico foi carregado ainda.
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
