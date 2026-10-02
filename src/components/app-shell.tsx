import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  HandCoins,
  BarChart3,
  Bell,
  PieChart,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  Percent,
  ScrollText,
  ListChecks,
  ClipboardList,
  Columns3,
  Gauge,
  Link2,
  Megaphone,
  Send,
  Upload,
  UserPlus,
  ClipboardPlus,
  Coins,
  FileSpreadsheet,
  FileText,
  Filter,
  Home,
  Inbox,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Receipt,
  Route as RouteIcon,
  Settings,
  Droplets,
  Building2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { resumoAliceHoje } from "@/lib/alice.functions";
import { temAvisoImportante } from "@/lib/avisos";
import { listarAvisos } from "@/lib/avisos.functions";
import { displayName, useProfile, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { podeAcessar, trocarEmpresa, useContextoTenant } from "@/lib/tenant";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InstallPrompt } from "@/components/install-prompt";
import { BarraDeNavegacaoInferior } from "@/components/nexa";
import { abasDoPapel } from "@/lib/navegacao";

const NOME_PAPEL = { admin: "Administrador", atendente: "Atendente", tecnico: "Técnico" } as const;

const NAV_GROUPS = [
  {
    label: "Operação",
    items: [
      { to: "/inicio", label: "Início", icon: Home },
      { to: "/conversas", label: "Conversas", icon: MessageCircle },
      { to: "/avisos", label: "Avisos", icon: Bell },
      { to: "/nova-os", label: "Nova OS", icon: ClipboardPlus },
      { to: "/oss", label: "OSs criadas", icon: ClipboardList },
      { to: "/orcamentos", label: "Orçamentos", icon: FileText },
      { to: "/agenda", label: "Agenda", icon: CalendarDays },
      { to: "/promocao", label: "Promoção da agenda", icon: Percent },
      { to: "/mensagens", label: "Mensagens de amanhã", icon: MessageSquareText },
      { to: "/servicos", label: "Serviços realizados", icon: FileText },
    ],
  },
  {
    label: "CRM WhatsApp",
    items: [
      { to: "/indicadores", label: "Funil e indicadores", icon: Filter },
      { to: "/crm/visao-geral", label: "Visão geral", icon: Gauge },
      { to: "/crm/leads", label: "Leads", icon: UserPlus },
      { to: "/crm/funil", label: "Funil", icon: Columns3 },
      { to: "/crm/repescagens", label: "Repescagens", icon: CalendarClock },
      { to: "/crm/campanhas", label: "Campanhas", icon: Megaphone },
      { to: "/marketing", label: "Campanhas WhatsApp", icon: Send },
      { to: "/crm/importar", label: "Importar histórico", icon: Upload },
      { to: "/crm/integracoes", label: "Integrações de Leads", icon: Link2 },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { to: "/a-receber", label: "A receber", icon: HandCoins },
      { to: "/pagamentos", label: "Pagamentos", icon: Wallet },

      { to: "/despesas", label: "Custos e despesas", icon: Coins },
      { to: "/origens", label: "Origens", icon: PieChart },
      { to: "/dre", label: "DRE", icon: BarChart3 },
    ],
  },
  {
    label: "Logística",
    items: [{ to: "/rotas", label: "Rotas e quilometragem", icon: RouteIcon }],
  },
  {
    label: "Administração",
    items: [
      { to: "/notas", label: "Notas a emitir", icon: Receipt },
      { to: "/exportacoes", label: "Exportações", icon: FileSpreadsheet },
      { to: "/implantacao", label: "Configuração da empresa", icon: ListChecks },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
      { to: "/agenda-config", label: "Agenda e promoção", icon: CalendarCog },
      { to: "/modelos-mensagem", label: "Modelos de mensagem", icon: ScrollText },
      { to: "/usuarios", label: "Usuários", icon: Users },
    ],
  },
  {
    label: "Nexa",
    items: [
      { to: "/nexa/empresas", label: "Empresas e comissões", icon: Building2 },
      { to: "/nexa/chatwoot", label: "Chatwoot", icon: MessagesSquare },
    ],
  },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: ctx } = useContextoTenant();
  const papel = ctx?.ativa?.papel ?? null;
  const souNexa = ctx?.souNexa ?? false;
  const temEmpresa = Boolean(ctx?.ativa);
  const grupos = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (temEmpresa || item.to.startsWith("/nexa")) && podeAcessar(papel, item.to, souNexa),
    ),
  })).filter((group) => group.items.length > 0);
  return (
    <nav className="flex flex-col gap-5 p-3 pb-8">
      {grupos.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-widest text-navy-foreground/45">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
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
                <span className="truncate">{item.label}</span>
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
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destaque text-marca">
        <Droplets className="size-5" />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-navy-foreground">Nexa OS</p>
        <p className="truncate text-xs text-navy-foreground/60">
          {ctx?.ativa?.empresa.nome ?? "Nexa Performance"}
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
  const rotaNexa = pathname === "/nexa" || pathname.startsWith("/nexa/");
  const liberado = podeAcessar(vinculo?.papel ?? null, pathname, ctx?.souNexa ?? false);
  const abasBase = vinculo ? abasDoPapel(vinculo.papel, ctx?.souNexa ?? false) : [];
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
  // Ponto na aba Avisos quando há algo que pede atenção.
  const temAvisos = abasBase.some((a) => a.to === "/avisos");
  const avisosFn = useServerFn(listarAvisos);
  const avisos = useQuery({
    queryKey: ["avisos"],
    queryFn: () => avisosFn(),
    enabled: temAvisos,
    refetchInterval: 60_000,
  });
  const pontoAvisos = temAvisoImportante(avisos.data ?? []);
  const abas = abasBase.map((a) =>
    a.to === "/conversas"
      ? { ...a, badge: esperando }
      : a.to === "/avisos"
        ? { ...a, ponto: pontoAvisos }
        : a,
  );
  const nome = displayName(profile, user?.email);

  async function sair() {
    await queryClient.cancelQueries();
    queryClient.clear();
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 py-2.5">
            <span
              aria-hidden
              className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-marca font-titulo text-[19px] text-destaque lg:hidden"
            >
              N
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{vinculo?.empresa.nome ?? nome}</p>
              <p className="truncate text-xs text-muted-foreground">
                {vinculo ? `${nome} · ${NOME_PAPEL[vinculo.papel]}` : user?.email}
              </p>
            </div>

            {ctx && ctx.empresas.length > 1 ? (
              <div className="hidden lg:block">
                <SeletorEmpresa />
              </div>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              onClick={sair}
              className="hidden gap-2 lg:inline-flex"
            >
              <LogOut className="size-4" />
              Sair
            </Button>

            {/* Celular: o menu completo (CRM, financeiro, configurações...) fica no "Mais". */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-11 gap-2 rounded-botao px-3.5 lg:hidden">
                  <Menu className="size-5" />
                  Mais
                </Button>
              </SheetTrigger>
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
                  {ctx && ctx.empresas.length > 1 ? <SeletorEmpresa /> : null}
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
          )}
        >
          <InstallPrompt />
          {carregandoVinculo ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
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
                <Button
                  className="mt-4"
                  onClick={() => navigate({ to: "/nexa/empresas" as never })}
                >
                  Cadastrar empresa
                </Button>
              ) : null}
            </div>
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

      {abas.length > 0 ? <BarraDeNavegacaoInferior itens={abas} className="lg:hidden" /> : null}
    </div>
  );
}

/** Troca de empresa (só para quem tem mais de uma, como a equipe da Nexa). */
function SeletorEmpresa() {
  const { data: ctx } = useContextoTenant();
  const vinculo = ctx?.ativa ?? null;
  return (
    <Select
      value={vinculo?.empresa.id ?? ""}
      onValueChange={(id) => {
        if (id !== vinculo?.empresa.id) trocarEmpresa(id);
      }}
    >
      <SelectTrigger className="w-full lg:w-[240px]" aria-label="Empresa">
        <SelectValue placeholder="Escolha a empresa" />
      </SelectTrigger>
      <SelectContent>
        {(ctx?.empresas ?? []).map((v) => (
          <SelectItem key={v.empresa.id} value={v.empresa.id}>
            {v.empresa.nome}
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
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
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
