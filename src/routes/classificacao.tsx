import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { NcmClassifier } from "@/components/NcmClassifier";
import { BatchClassifier } from "@/components/BatchClassifier";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/classificacao")({
  component: ClassificacaoPage,
  head: () => ({
    meta: [
      { title: "FC Comércio Exterior — Classificação NCM" },
      {
        name: "description",
        content: "Página principal para classificação fiscal NCM.",
      },
    ],
  }),
});

function ClassificacaoPage() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="Abrir menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Menu</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link
                    to="/classificacao"
                    className={location.pathname === "/classificacao" ? "font-medium" : ""}
                  >
                    Classificar
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link
                    to="/historico"
                    className={location.pathname === "/historico" ? "font-medium" : ""}
                  >
                    Historico
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div>
              <div className="font-bold leading-tight">FC Comércio Exterior</div>
              <div className="text-xs text-muted-foreground leading-tight">
                Classificação fiscal • LI • DUIMP
              </div>
            </div>
          </div>
          <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
            sair
          </Link>
        </div>
      </header>

      <main>
        <section className="px-4 pt-16 pb-12" style={{ backgroundImage: "var(--gradient-subtle)" }}>
          <div className="max-w-4xl mx-auto text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-sm font-medium mb-5">
              <ShieldCheck className="h-4 w-4" /> Alinhado ao Siscomex e órgãos anuentes
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-5">
              Consulta NCM, LI e DUIMP{" "}
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                com IA
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Descreva o produto e receba sugestões de NCM, descrição padrão para LI e Catálogo
              DUIMP, alíquotas e alertas de anuência.
            </p>
          </div>

          <NcmClassifier />

          <div className="max-w-5xl mx-auto mt-8">
            <BatchClassifier />
          </div>
        </section>
      </main>
    </div>
  );
}
