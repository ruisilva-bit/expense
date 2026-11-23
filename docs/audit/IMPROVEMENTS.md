# Melhorias, funcionalidades em falta e modernização — HomeFund

> Complementa [`AUDIT.md`](./AUDIT.md) (problemas) e [`ARCHITECTURE.md`](./ARCHITECTURE.md). Estimativas de esforço são ordens de grandeza (S ≤ 2 dias, M ≤ 2 semanas, L > 2 semanas) para uma equipa pequena; **não foram validadas**. Nada aqui foi implementado.

## 1. Melhorias de maior impacto (ordenadas)

| # | Melhoria | Resolve | Esforço | Porquê agora |
|---|---|---|---|---|
| 1 | **Mutações financeiras transacionais em SQL** (funções/RPC para criar/editar/apagar transação, transferência, pagamento de empréstimo; `balance = balance + Δ`), replicando o padrão de `apply_goal_movement_v1` | F-04, F-10 | M | Elimina perdas de atualização e estados parciais — o risco de negócio nº 1 |
| 2 | **Camada única de autorização** (`authorize(user, ação, recurso)`) + corrigir `bank-accounts`/`categories`; ignorar `user_metadata` para `kind` | F-01, F-02 | S–M | Fecha as brechas de permissões com pouco código |
| 3 | **Atualizar `next` (≥16.4.6) e dependências**; Dependabot/Renovate | F-06 | S | Advisory crítico em produção |
| 4 | **CI + testes de integração** (GitHub Actions: lint, tsc, test, audit, build; Supabase local; testes das rotas e pgTAP para RLS/RPC; Playwright para login→transação→transferência→meta) | F-18 | M | Rede de segurança para todas as restantes mudanças |
| 5 | **Consolidar o schema**: baseline único + `supabase/migrations`, remover legado e espelho `accounts`, constraints, tipos gerados (`supabase gen types`) | F-08, F-22 | L | Remove dupla escrita e *fallbacks*; base para tudo o resto |
| 6 | **Substituir tags em `description` por colunas/tabelas** (`goal_id`, `loan_id`, `transfer_id`, `recurring_id`, `transaction_members`) | F-07 | M–L | Integridade, desempenho e fim da injeção de tags |
| 7 | **Executor único e idempotente de recorrências** (pg_cron/Supabase Cron + função SQL, `UNIQUE(recurring_id, occurrence_date)`); retirar do browser e do GET; avanço mensal pelo dia-âncora | F-05 | M | Fim de duplicados e de apagamentos heurísticos |
| 8 | **Validação com Zod + *error mapper* central** (mensagens genéricas, `request_id`) | F-12 | M | Robustez e menos fuga de informação |
| 9 | **`proxy.ts` + Server Components para dados iniciais** (refresh de sessão, redirect, *streaming*), CSP com nonce, headers de segurança, rate limiting | F-16, F-17 | M | Segurança e percepção de velocidade |
| 10 | **Acessibilidade e i18n** (primitivas Radix/React Aria, `htmlFor`, foco em diálogos, `lang`, `next-intl` PT/EN) | F-19, F-20 | M | Conformidade (EAA/WCAG 2.1 AA) e consistência |

## 2. Funcionalidades em falta (alinhadas com o produto atual)

Estas lacunas resultam da inspeção do código (não há tal funcionalidade); a prioridade depende do produto.

### Essenciais para um produto de finanças pessoais/familiares
- **Orçamentos por categoria/mês** com alertas de excesso (não existe entidade `budgets`).
- **Importação de extratos** (CSV/OFX/CAMT) com deteção de duplicados e regras de categorização automática; a prazo **Open Banking (PSD2)** (p.ex. via agregador) para Portugal.
- **Exportação** (CSV/XLSX/PDF) por período/conta — hoje não há qualquer exportação.
- **Pesquisa e filtros avançados** (texto, intervalo de montante, tags) e **edição em massa**.
- **Anexos/recibos** (Supabase Storage) por transação.
- **Convites reais por email** (token, aceitar/recusar) em vez de "procurar o email e inserir" (F-14); papéis adicionais (ex.: `viewer`).
- **Recuperação de palavra-passe, verificação de email com UX completa, MFA/passkeys, login social** (Supabase Auth já suporta).
- **Notificações** (recorrências a vencer, saldo baixo, meta atingida, orçamento) por email/push.
- **Registo de auditoria/histórico** por entidade (quem alterou o quê) e **anular/restaurar** (soft delete) para transações e contas.
- **Privacidade/RGPD:** exportação dos dados do utilizador, eliminação de conta e de família, política de retenção.

### Empréstimos e metas
- **Empréstimos com taxa de juro** e **plano de amortização** (o modelo só tem `total_amount`, `remaining_amount`, `monthly_payment`); simulador de amortização antecipada.
- **Metas com contribuição sugerida mensal** a partir do `deadline` e com projeção.

### Relatórios
- Relatórios de *cash-flow*, património líquido ao longo do tempo (snapshots de saldo), comparação mês-a-mês, por membro; hoje limitados a 1000 transações (F-11).

### Plataforma
- **Multi-moeda** e taxas de câmbio (EUR fixo em `format.ts`).
- **PWA a sério:** service worker, cache offline de leitura, fila de escrita offline, *share target*.
- **API pública/tokens pessoais** para os "utilizadores API" em vez de contas Supabase Auth com password (hoje `system` users são utilizadores normais com `app_metadata`).

## 3. Modernização técnica

### 3.1 Dados e backend
- **Moderno com Supabase:** usar `supabase/migrations` + CLI (`db diff`, `db reset`), `supabase gen types typescript`, e substituir o cliente `GenericDatabase` por tipos reais (`supabase-admin.ts`).
- **RLS correta como 2.ª barreira:** helpers `SECURITY DEFINER` com `search_path` fixo, políticas por papel/visibilidade; usar o cliente **com o JWT do utilizador** para leituras e reservar `service_role` a operações administrativas — reduz o raio de explosão de um bug de autorização.
- **Perfis:** tabela `profiles(user_id, email, display_name, kind)` sincronizada por trigger — elimina `listUsers`/`getUserById` por pedido (F-13).
- **Agregações no servidor:** vistas/RPC para totais por período/categoria/membro e `balance_after` via *window function* (`SUM() OVER`), em vez de *replay* em JS.
- **Dinheiro em cêntimos (`bigint`)** ou `numeric` com bibliotecas decimais no código TS; um só caminho (hoje o RPC usa cêntimos e o resto `number`).
- **Índices:** `transactions(family_id, bank_account_id, date)`; remover `ILIKE` em tags após F-07; `UNIQUE(family_id,user_id)` em `family_members`.
- **Observabilidade:** logs estruturados com `request_id`, Sentry/OpenTelemetry, métricas de latência por rota.

### 3.2 Frontend
- **Aproveitar o App Router:** carregar dados iniciais em Server Components (`dashboard`, `transactions`), SWR só para refresco; `loading.tsx`/`error.tsx`/`not-found.tsx` por segmento; `Suspense` + *streaming*.
- **Server Actions** (ou Route Handlers finos) com validação Zod partilhada cliente/servidor (`react-hook-form` + `zod`), em vez de `fetch` + estado manual em páginas de 700–900 linhas.
- **Dividir ficheiros gigantes:** `transactions/route.ts` (1638 l.) → `services/transactions/*`; `TransactionWizard` e páginas em componentes/hook; remover duplicação (F-22).
- **Design system:** consolidar `globals.css`/`themes.css` (~3500 l.) em *design tokens* (CSS variables) + componentes acessíveis (Radix/shadcn); reduzir as 7 famílias de fontes a 1–2 e medir (Lighthouse/`next build` analyzer).
- **Gráficos acessíveis:** resumo textual/tabela alternativa para cada gráfico Recharts; não depender só da cor.
- **React 19/Next 16:** avaliar React Compiler, Turbopack (remover `--webpack` se já não for necessário), `use cache`/Cache Components onde aplicável, `useOptimistic` para criar/apagar transações.

### 3.3 Engenharia e DX
- **CI/CD:** lint, tsc, testes, `npm audit --audit-level=high`, build, preview deploys; *pre-commit* (lint-staged).
- **Testes:** (a) unidade — manter e ampliar `lib`; (b) integração das rotas contra Supabase local; (c) pgTAP para RLS/RPC; (d) Playwright E2E + `@axe-core/playwright` para acessibilidade; (e) testes de concorrência para saldos (dois pedidos paralelos).
- **`.env.example`**, README corrigido (F-21), ADRs curtas para decisões (modelo de saldo, tags, visibilidade).
- **Qualidade:** `eslint-plugin-jsx-a11y` (já parcial no config Next), regra proibindo `service_role` fora de `lib/supabase-admin`, `knip` para código morto (`actions/*`, `create-transaction`).
- **Segurança contínua:** CodeQL/`gitleaks` no CI; rotação documentada do `service_role`; `Content-Security-Policy-Report-Only` antes de impor.

## 4. Roteiro sugerido

| Fase | Duração | Entregas |
|---|---|---|
| **0 — Estancar risco** | ~1 semana | Atualizar Next/deps; ignorar `user_metadata`; autorização em contas/categorias; apagar `actions/*` e `create-transaction`; tirar `cleanup` do GET de recorrentes; headers básicos |
| **1 — Fundações** | 2–4 semanas | CI + testes de API; Zod + error mapper; `proxy.ts`; RPCs transacionais de transação/transferência/empréstimo; `.env.example` + README |
| **2 — Dados** | 4–8 semanas | Baseline de schema + migrations; remover legado/espelho; colunas em vez de tags; recorrências via cron SQL; RLS correta; perfis |
| **3 — Produto** | contínuo | Orçamentos, importação/exportação, convites por email, notificações, relatórios, PWA offline |
| **4 — Qualidade percebida** | em paralelo | Acessibilidade, i18n, design tokens, desempenho (medir antes/depois) |

## 5. Métricas de sucesso propostas

- 0 vulnerabilidades altas/críticas em `npm audit` (produção).
- Divergência `balance` vs soma das transações = 0 (job de verificação diário) e teste de concorrência a passar.
- Cobertura: ≥70 % nas rotas e 100 % dos caminhos de autorização testados (matriz papel × recurso).
- Lighthouse A11y ≥ 95 e 0 violações *serious* no axe nos fluxos principais.
- p95 de `/api/transactions` e `/api/dashboard` medido e com orçamento definido (hoje **não medido**).
