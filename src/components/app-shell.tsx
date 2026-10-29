import { useEffect, useState } from "react";
import { AvisoAssinatura, EmpresaBloqueada } from "@/components/assinatura/aviso-assinatura";
import { AceiteTermos } from "@/components/termos/aceite-termos";
import { useSituacaoAssinatura } from "@/lib/assinatura-situacao";
import { PainelEnvios } from "@/components/os/painel-envios";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, Inbox, Lock, LogOut, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { resumoAliceHoje } from "@/lib/alice.functions";
import { SinoDeAvisos } from "@/components/avisos/painel-avisos";
import { displayName, useProfile, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { irParaPainelNexa, podeAcessar, rotaDoPainelNexa, useContextoTenant } from "@/lib/tenant";
import { useTrocarEmpresa } from "@/lib/documentos-hooks";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InstallPrompt } from "@/components/install-prompt";
import { AvisoNotificacoesAparelho } from "@/components/avisos/aviso-notificacoes-aparelho";
import { AvatarEmpresa, BarraDeNavegacaoInferior, LogoNexa } from "@/components/nexa";
import { useRespostaEmFoco } from "@/lib/resposta-em-foco";
import { ABA_MAIS, abasDoPapel } from "@/lib/navegacao";
import { itemAtivo, menuDoPapel } from "@/lib/menu";
import { minhaImplantacaoFn } from "@/lib/implantacao.functions";
import { usePlanoDaEmpresa } from "@/lib/plano-empresa";
import { recursoDaRota, temRecurso } from "@/lib/recursos";
import { RecursoBloqueado } from "@/components/plano/recurso-bloqueado";
import { SinoNexa } from "@/components/plano/sino-nexa";
import { AlertaParadaIa } from "@/components/plano/alerta-parada-ia";
import { limparCacheAnexos } from "@/lib/anexos";

const NOME_PAPEL = { admin: "Administrador", atendente: "Atendente", tecnico: "Técnico" } as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: ctx } = useContextoTenant();
  const papel = ctx?.ativa?.papel ?? null;
  const souNexa = ctx?.souNexa ?? false;
  // "Primeiros passos" fica no menu só enquanto faltar etapa (admin).
  const implantacaoFn = useServerFn(minhaImplantacaoFn);
  const implantacao = useQuery({
    queryKey: ["implantacao"],
    queryFn: () => implantacaoFn(),
    enabled: papel === "admin",
    staleTime: 5 * 60_000,
  });
  const resumo = implantacao.data?.resumo;
  const primeirosPassos = resumo
    ? {
        faltam:
          resumo.obrigatorias.prontas + resumo.opcionais.prontas <
          resumo.obrigatorias.total + resumo.opcionais.total,
        progresso: `${resumo.obrigatorias.prontas + resumo.opcionais.prontas} de ${resumo.obrigatorias.total + resumo.opcionais.total}`,
      }
    : null;
  const { data: planoEmpresa } = usePlanoDaEmpresa();
  // Gerente comercial: só aparece para o admin da empresa em que está ligado.
  const comercial = useQuery({
    queryKey: ["gerente-comercial-ligado", ctx?.ativa?.empresa.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("comercial_configuracoes" as never)
        .select("ligado")
        .maybeSingle();
      return Boolean((data as { ligado?: boolean } | null)?.ligado);
    },
    enabled: papel === "admin" && !ctx?.painelNexa,
    staleTime: 10 * 60_000,
  });
  const grupos = menuDoPapel(
    papel,
    souNexa,
    primeirosPassos,
    ctx?.painelNexa ?? false,
    comercial.data === true,
  );
  return (
    <nav className="flex flex-col gap-5 p-3 pb-8">
      {grupos.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-widest text-navy-foreground/55">
            {group.rotulo}
          </p>
          {group.itens.map((item) => {
            const Icon = item.icone;
            const active = itemAtivo(item, pathname);
            return (
              <Link
                key={item.to}
                to={item.to as never}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                  active
                    ? "bg-navy-foreground/12 text-navy-foreground"
                    : "text-navy-foreground/70 hover:bg-navy-foreground/8 hover:text-navy-foreground",
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-destaque"
                  />
                ) : null}
                <Icon className={cn("size-4 shrink-0", active && "text-destaque")} />
                <span className="truncate">{item.rotulo}</span>
                {(() => {
                  const r = recursoDaRota(item.to);
                  return r && !temRecurso(planoEmpresa, r) ? (
                    <Lock
                      className="ml-auto size-3.5 shrink-0 opacity-70"
                      aria-label="Fora do plano"
                    />
                  ) : null;
                })()}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ fechar = false }: { fechar?: boolean }) {
  const { data: ctx } = useContextoTenant();
  return (
    <div className="flex items-center gap-3 border-b border-navy-foreground/10 px-4 py-4">
      {ctx?.ativa && !ctx.painelNexa ? (
        <AvatarEmpresa
          empresaId={ctx.ativa.empresa.id}
          nome={ctx.ativa.empresa.nome}
          tamanho={40}
        />
      ) : (
        <LogoNexa variante="simbolo" sobre="escuro" className="h-10" alt="" />
      )}
      <div className="min-w-0 leading-tight">
        <LogoNexa sobre="escuro" className="h-4" alt="Nexa OS" />
        <p className="mt-1 truncate text-xs text-navy-foreground/60">
          {ctx?.painelNexa ? "Nexa (painel)" : (ctx?.ativa?.empresa.nome ?? "Nexa Performance")}
        </p>
      </div>
      {fechar ? (
        <SheetClose
          className="ml-auto grid size-11 shrink-0 place-items-center rounded-botao text-navy-foreground/80 hover:bg-navy-foreground/10 hover:text-navy-foreground"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </SheetClose>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const profile = useProfile();
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { data: ctx, isLoading: carregandoVinculo, error: erroVinculo } = useContextoTenant();
  const vinculo = ctx?.ativa ?? null;
  const painelNexa = ctx?.painelNexa ?? false;
  const rotaNexa = rotaDoPainelNexa(pathname);
  // Painel Nexa é um espaço separado: rota do painel aberta dentro de uma empresa troca sozinha
  // para "Nexa (painel)"; no painel, rota de empresa volta para as Empresas.
  const trocandoParaPainel = Boolean(ctx?.souNexa && rotaNexa && !painelNexa);
  const saindoDoPainel = painelNexa && !rotaNexa;
  useEffect(() => {
    if (trocandoParaPainel) irParaPainelNexa(window.location.pathname + window.location.search);
    else if (saindoDoPainel) void navigate({ to: "/nexa/empresas" as never, replace: true });
  }, [trocandoParaPainel, saindoDoPainel, navigate]);
  // Conversas: no celular, a conversa aberta ocupa a tela toda (sem o topo e sem a barra de baixo);
  // no PC, lista e conversa ficam lado a lado na altura da tela, cada uma rolando por dentro.
  const rotaConversa = /^\/conversas\/[^/]+\/?$/.test(pathname);
  const rotaConversas = pathname === "/conversas" || pathname.startsWith("/conversas/");
  const liberado = podeAcessar(vinculo?.papel ?? null, pathname, ctx?.souNexa ?? false);
  const { data: assinatura } = useSituacaoAssinatura(vinculo?.empresa.id);
  const bloqueada = assinatura?.situacao === "bloqueada" && !ctx?.souNexa && !rotaNexa;
  // Tela de recurso fora do plano: cadeado no lugar da tela (vale também para a equipe Nexa).
  const { data: planoEmpresa } = usePlanoDaEmpresa();
  const recursoDaTela = vinculo && !rotaNexa ? recursoDaRota(pathname) : null;
  const telaForaDoPlano = recursoDaTela !== null && !temRecurso(planoEmpresa, recursoDaTela);
  const abasBase = painelNexa
    ? abasDoPapel(null, ctx?.souNexa ?? false, true)
    : vinculo
      ? abasDoPapel(vinculo.papel, ctx?.souNexa ?? false)
      : [];
  // Número na aba Conversas: clientes esperando resposta da equipe.
  const temConversas = abasBase.some((a) => a.to === "/conversas");
  const resumoFn = useServerFn(resumoAliceHoje);
  const resumoAlice = useQuery({
    queryKey: ["alice_resumo_hoje"],
    queryFn: () => resumoFn(),
    enabled: temConversas,
    refetchInterval: 60_000,
  });
  const esperando = resumoAlice.data?.esperandoEquipe ?? 0;
  const respostaEmFoco = useRespostaEmFoco();
  const abas = abasBase.map((a) =>
    a.to === "/conversas"
      ? { ...a, badge: esperando }
      : a.to === ABA_MAIS
        ? { ...a, aoTocar: () => setOpen(true) }
        : a,
  );
  const nome = displayName(profile, user?.email);

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await limparCacheAnexos();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-72 shrink-0 bg-navy-deep lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <Brand />
          <ScrollArea className="flex-1">
            <NavList />
          </ScrollArea>
        </div>
      </aside>

      <div className={cn("flex min-w-0 flex-1 flex-col", rotaConversas && "lg:h-dvh")}>
        <header
          className={cn(
            "sticky top-0 z-20 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur",
            rotaConversa && "hidden lg:block",
          )}
        >
          <div className="flex min-h-16 items-center gap-3 px-4 py-2.5">
            {painelNexa ? (
              <span className="shrink-0 lg:hidden">
                <LogoNexa variante="simbolo" className="h-[38px]" alt="" />
              </span>
            ) : (
              <AvatarEmpresa
                empresaId={vinculo?.empresa.id}
                nome={vinculo?.empresa.nome ?? "Nexa"}
                tamanho={38}
                className="lg:hidden"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">
                {painelNexa ? "Nexa" : (vinculo?.empresa.nome ?? nome)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {painelNexa
                  ? `Painel da plataforma · ${nome}`
                  : vinculo
                    ? `${nome} · ${NOME_PAPEL[vinculo.papel]}`
                    : user?.email}
              </p>
            </div>

            {ctx && (ctx.souNexa || ctx.empresas.length > 1) ? (
              <div className="hidden lg:block">
                <SeletorEmpresa />
              </div>
            ) : null}

            {painelNexa ? <SinoNexa /> : <SinoDeAvisos ligado={Boolean(vinculo)} />}

            <Button
              variant="ghost"
              size="sm"
              onClick={sair}
              className="hidden gap-2 lg:inline-flex"
            >
              <LogOut className="size-4" />
              Sair
            </Button>

            {/* Celular: o menu completo abre pela aba "Mais" da barra de baixo. */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent
                side="right"
                className="flex w-[86vw] max-w-80 flex-col gap-0 border-0 bg-navy-deep p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-navy-foreground [&>button:first-child]:hidden"
              >
                <SheetTitle className="sr-only">Mais opções</SheetTitle>
                <Brand fechar />
                <ScrollArea className="min-h-0 flex-1">
                  <NavList onNavigate={() => setOpen(false)} />
                </ScrollArea>
                <div className="flex flex-col gap-2 border-t border-navy-foreground/10 p-3">
                  {ctx && (ctx.souNexa || ctx.empresas.length > 1) ? <SeletorEmpresa /> : null}
                  <button
                    type="button"
                    onClick={sair}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-navy-foreground/80 hover:bg-navy-foreground/8 hover:text-navy-foreground"
                  >
                    <LogOut className="size-4" />
                    Sair
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <main
          className={cn(
            "mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6 lg:p-8",
            // Espaço para a barra de abas (e a barra do iPhone) não cobrir o fim da página.
            abas.length > 0 && "pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-8",
            rotaConversa && "p-0 pb-0 md:p-0",
            rotaConversas && "lg:max-w-none lg:min-h-0 lg:overflow-hidden lg:p-0 lg:pb-0",
          )}
        >
          {rotaConversa ? null : (
            <div className={rotaConversas ? "lg:hidden" : undefined}>
              <InstallPrompt />
              {vinculo && !rotaNexa ? <AvisoNotificacoesAparelho /> : null}
            </div>
          )}
          {vinculo && !rotaNexa ? <AvisoAssinatura situacao={assinatura} /> : null}
          {painelNexa && rotaNexa ? <AlertaParadaIa /> : null}
          <AceiteTermos />
          {carregandoVinculo || trocandoParaPainel || saindoDoPainel ? (
            <p className="text-sm text-muted-foreground">
              {trocandoParaPainel ? "Abrindo o Painel Nexa…" : "Carregando…"}
            </p>
          ) : erroVinculo ? (
            <div className="card-surface mx-auto max-w-md p-6 text-center">
              <h1 className="text-lg font-semibold text-navy">
                Não foi possível carregar sua empresa
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Recarregue a página em instantes.
              </p>
            </div>
          ) : !vinculo && !rotaNexa ? (
            <div className="card-surface mx-auto max-w-md p-6 text-center">
              <h1 className="text-lg font-semibold text-navy">
                {ctx?.souNexa ? "Nenhuma empresa cadastrada" : "Conta sem empresa vinculada"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {ctx?.souNexa
                  ? "Cadastre a primeira empresa cliente para começar."
                  : "Sua conta ainda não foi vinculada a uma empresa. Peça um convite ao administrador."}
              </p>
              {ctx?.souNexa ? (
                <Button className="mt-4" onClick={() => irParaPainelNexa()}>
                  Cadastrar empresa
                </Button>
              ) : null}
            </div>
          ) : bloqueada && vinculo ? (
            <EmpresaBloqueada nome={vinculo.empresa.nome} />
          ) : liberado && telaForaDoPlano && recursoDaTela ? (
            <RecursoBloqueado recurso={recursoDaTela} />
          ) : liberado ? (
            children
          ) : (
            <div className="card-surface mx-auto max-w-md p-6 text-center">
              <h1 className="text-lg font-semibold text-navy">Acesso não liberado</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Seu perfil não tem permissão para esta página. Fale com o administrador da empresa.
              </p>
              <Button
                className="mt-4"
                onClick={() => navigate({ to: "/agenda", search: {} as never })}
              >
                Ir para a agenda
              </Button>
            </div>
          )}
        </main>
      </div>

      {abas.length > 0 && !respostaEmFoco && !rotaConversa ? (
        <BarraDeNavegacaoInferior itens={abas} className="lg:hidden" />
      ) : null}
      <PainelEnvios />
    </div>
  );
}

const OPCAO_PAINEL = "__painel_nexa__";

/**
 * Troca de empresa (quem tem mais de uma). Para nexa_admin, "Nexa (painel)" vem separado das
 * empresas: é o único caminho para as telas da plataforma.
 */
function SeletorEmpresa() {
  const { data: ctx } = useContextoTenant();
  const trocarEmpresa = useTrocarEmpresa();
  const vinculo = ctx?.ativa ?? null;
  const atual = ctx?.painelNexa ? OPCAO_PAINEL : (vinculo?.empresa.id ?? "");
  return (
    <Select
      value={atual}
      onValueChange={(id) => {
        if (id === atual) return;
        if (id === OPCAO_PAINEL) irParaPainelNexa();
        else trocarEmpresa(id);
      }}
    >
      <SelectTrigger className="w-full lg:w-[240px]" aria-label="Empresa ou Painel Nexa">
        <SelectValue placeholder="Escolha a empresa" />
      </SelectTrigger>
      <SelectContent>
        {ctx?.souNexa ? (
          <>
            <SelectGroup>
              <SelectItem value={OPCAO_PAINEL}>
                <span className="flex items-center gap-2">
                  <LogoNexa variante="simbolo" className="h-[22px]" alt="" />
                  Nexa (painel)
                </span>
              </SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Empresas</SelectLabel>
            </SelectGroup>
          </>
        ) : null}
        {(ctx?.empresas ?? []).map((v) => (
          <SelectItem key={v.empresa.id} value={v.empresa.id}>
            <span className="flex items-center gap-2">
              <AvatarEmpresa empresaId={v.empresa.id} nome={v.empresa.nome} tamanho={22} />
              {v.empresa.nome}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  voltarPara,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Tela que abriu esta (ex.: um grupo das Configurações): mostra a seta de voltar. */
  voltarPara?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {voltarPara ? (
          <Link
            to={voltarPara as never}
            className="-ml-2 mb-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-botao px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" aria-hidden />
            Voltar
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-navy md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/40 p-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-card text-primary shadow-card">
        <Icon className="size-5" />
      </span>
      <p className="font-medium text-navy">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function SectionCard({
  step,
  icon: Icon,
  title,
  description,
  actions,
  accent = "teal",
  className,
  children,
}: {
  step?: number | string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  accent?: "teal" | "navy" | "success" | "warning" | "danger" | "none";
  className?: string;
  children?: React.ReactNode;
}) {
  const accentClass =
    accent === "none"
      ? ""
      : accent === "navy"
        ? "card-accent-navy"
        : accent === "success"
          ? "card-accent-success"
          : accent === "warning"
            ? "card-accent-warning"
            : accent === "danger"
              ? "card-accent-danger"
              : "card-accent-teal";
  return (
    <section className={cn("card-surface p-5 md:p-6", accentClass, className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {step !== undefined ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold text-navy">
              {step}
            </span>
          ) : Icon ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
              <Icon className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="section-title">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
