# Auditoria técnica e funcional — HomeFund ("expense")

- **Data:** 2026-11-23
- **Commit auditado:** `9543949` (branch de trabalho `claude/brave-knuth-q8i36s`)
- **Natureza:** análise estática do código + verificações não destrutivas numa cópia isolada. Nenhum ficheiro existente foi alterado; nenhum commit/deploy; nenhum serviço de produção acedido; nenhuma credencial real usada.
- **Documentos relacionados:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`IMPROVEMENTS.md`](./IMPROVEMENTS.md)

---

## 0. Como ler este relatório

Cada achado tem um **estado de confiança**:

| Estado | Significado |
|---|---|
| **COMPROVADO** | Visível diretamente no código/ferramentas desta auditoria (ficheiro:linha citado). Não implica que o efeito tenha sido *executado* — não existe backend Supabase nesta auditoria. |
| **PROVÁVEL** | Decorre do código, mas depende de configuração/estado externo (BD real, deploy, versão do Supabase) que não pude ver. |
| **HIPÓTESE** | Suspeita razoável, sem evidência suficiente. Precisa de teste. |

Severidade: **Crítica** (perda/exposição de dados ou controlo total), **Alta**, **Média**, **Baixa**.

Os números de linha referem-se ao commit `9543949`.

---

## 1. Âmbito e cobertura (honestidade sobre o que foi — e não foi — inspecionado)

### 1.1 Verificações executadas (numa cópia em `git archive`, fora do repo)

| Verificação | Resultado |
|---|---|
| `npm ci` | OK — 422 pacotes |
| `tsc --noEmit` | **0 erros** |
| `eslint` (config Next core-web-vitals + TS) | **0 problemas** |
| `npm test` (`tsx --test`) | **30/30 testes passam** (só `src/lib/*.test.ts`) |
| `npm audit` | **20 vulnerabilidades: 1 crítica, 9 altas, 9 moderadas, 1 baixa** (ver F-06) |
| Pesquisa de segredos no histórico git (padrões JWT `eyJ…`, `sb_secret_`) | Nada encontrado (histórico com 5 commits; pesquisa por padrões, não exaustiva) |
| `.env*` no `.gitignore` | Sim; nenhum `.env` versionado |

### 1.2 Cobertura de leitura de código

**Lido integralmente:** todo o SQL (`supabase/sql/01–14`), as 2 Edge Functions, `src/lib/api-auth.ts`, `member-kind.ts`, `member-tags.ts`, `supabase-{admin,browser,server}.ts`, `client-fetch.ts`, `fetch-all-pages.ts`, `format.ts`, `src/app/actions/*`, `api/families`, `api/family-members`, `api/loan-payments` (quase todo), `layout.tsx`, `manifest.ts`, páginas de login/registo, `AppDialog`, `PrettySelect`, `next.config.ts`, `package.json`, `tsconfig`, `eslint.config.mjs`.

**Lido parcialmente (não afirmo cobertura total):**

| Ficheiro | Linhas lidas |
|---|---|
| `api/transactions/route.ts` (1638 l.) | 1–140, 215–470, 647–1010, 1480–1638. **Não li** o corpo do PATCH (1010–1480) nem o fim do GET (470–646). |
| `api/recurring-transactions/route.ts` (982 l.) | 30–200, 296–500, 626–700. **Não li** o resto do POST/PATCH/DELETE. |
| `api/goals/route.ts` | 60–180, 217–507. |
| `api/loans/route.ts` | POST, DELETE. **Não li** GET/PATCH. |
| `api/categories/route.ts` | POST, DELETE. **Não li** GET/PATCH. |
| `api/bank-accounts/route.ts` | 99–383. **Não li** GET. |
| `api/dashboard/route.ts` (648 l.) | 226–420. **Não li** 420–648 (agregações). |
| `context/AppState.tsx` | 1–120, 225–320. |
| `app/families/page.tsx` | só excertos (auth redirect, formulários). |
| `app/goals/page.tsx` | só excertos por pesquisa (uso de localStorage/idempotência). |

**Não lido (apenas inventariado por nome/tamanho ou executado via testes):** `app/{dashboard,transactions,loans,recurring,accounts,categories}/page.tsx`, `components/TransactionWizard.tsx`, `FamilyCharts`, `LoanCharts`, `GoalCard/Form`, `LoanCard/Form`, `AppNav` (excertos), `ThemeContext/ThemePicker`, `globals.css` (1923 l.), `themes.css` (1547 l.), `lib/{cash-flow-trend,financial-totals,transaction-balance,goal-movement-*,theme-preferences,category-color*}.ts` (só executados via os seus testes, não lidos).

### 1.3 Áreas NÃO VERIFICADAS (não tenho evidência — não afirmo nada sobre elas)

1. **Base de dados real:** que migrações estão aplicadas, se RLS está ativo, se `family_members.kind` existe, política de `verify_jwt` das Edge Functions, cron do `recurring-runner`.
2. **Comportamento em runtime:** nenhum servidor Next foi arrancado (sem variáveis Supabase). Nenhum pedido HTTP foi feito. Os impactos descritos são deduzidos do código.
3. **UI renderizada:** responsividade, contraste, layout real, desempenho de Lighthouse, leitores de ecrã — **não testados** em browser. Os pontos de acessibilidade/UX vêm de leitura de código.
4. **Lógica de agregação do dashboard/gráficos** e a maioria dos componentes de UI (ver 1.2).
5. **Desempenho medido** (latências, tamanho do bundle): nada medido. `next build` não foi executado.

---

## 2. Resumo executivo

A aplicação é um gestor de finanças familiares (Next.js 16 + Supabase) com funcionalidade ampla e uma base de qualidade estática sólida (tsc/eslint limpos, 30 testes a passar, e um RPC atómico bem desenhado para movimentos de metas). Os riscos concentram-se em quatro temas:

1. **Autorização fraca dentro da família e uma escalada de privilégios** via `user_metadata` (F-01, F-02, F-03).
2. **Integridade financeira:** saldos atualizados por *ler-modificar-escrever* sem transação, em múltiplos pontos e em concorrência com um job e com reconciliação disparada pelo browser (F-04, F-05, F-10).
3. **Dívida de schema:** duas gerações de modelo de dados coexistentes, migrações com lacunas, RLS que não protege nada na prática porque tudo corre com `service_role` (F-08, F-09).
4. **Cadeia de fornecimento/operacional:** `next@16.2.1` com advisory crítico, sem CI, sem testes de API/auth, sem headers de segurança nem rate limiting (F-06, F-17, F-18).

**Pontos fortes:** `service_role` marcado `server-only`; RPC `apply_goal_movement_v1` (bloqueios de linha, idempotência por `(user_id, operation_id)`, `REVOKE` a `anon/authenticated`); tipagem `strict`; separação razoável de utilitários puros testados.

---

## 3. Achados

### Tabela-resumo

| ID | Sev. | Estado | Título |
|---|---|---|---|
| F-01 | Alta | COMPROVADO | Qualquer membro apaga/edita saldo de **qualquer** conta (ignora visibilidade/owner) |
| F-02 | Alta | COMPROVADO (exploração não executada) | Escalada via `user_metadata.homefund_member_kind = "system"` |
| F-03 | Alta | COMPROVADO / alcance PROVÁVEL | Server action `addMember` sem qualquer autorização |
| F-04 | Alta | COMPROVADO | Saldos atualizados por read-modify-write, sem transação |
| F-05 | Alta | COMPROVADO | Reconciliação de recorrentes disparada pelo cliente + apagamento automático por heurística de tags |
| F-06 | Alta | COMPROVADO (npm audit) | `next@16.2.1` com advisory **crítico**; 19 outras vulnerabilidades |
| F-07 | Média | COMPROVADO | Metadados funcionais em texto livre (`[goal:…]`, `[transfer:…]`) injetáveis pelo utilizador |
| F-08 | Alta | COMPROVADO (BD real não verificada) | Schema em duas gerações; migrações com lacunas e dependências ocultas |
| F-09 | Média | COMPROVADO | RLS permissiva/defeituosa; app contorna-a com `service_role` |
| F-10 | Média | COMPROVADO | Pagamentos de empréstimo: DELETE não reverte conta/transação; erros ignorados |
| F-11 | Média | PROVÁVEL | Truncagem silenciosa a 1000 linhas (dashboard / filtro por membro) |
| F-12 | Média | COMPROVADO | Sem validação de input; mensagens de BD devolvidas ao cliente |
| F-13 | Média | COMPROVADO | `auth.admin.listUsers` paginado por pedido; chamadas admin por verificação |
| F-14 | Média | COMPROVADO | Enumeração de emails e criação de contas "system" com email arbitrário |
| F-15 | Média | PROVÁVEL | Edge Functions: `recurring-runner` sem auth própria; `create-transaction` legado incorreto |
| F-16 | Média | COMPROVADO / impacto PROVÁVEL | Sem `proxy.ts` (ex-middleware): sem proteção de rotas nem refresh de sessão no servidor |
| F-17 | Média | COMPROVADO | Sem headers de segurança/CSP, sem rate limiting |
| F-18 | Média | COMPROVADO | Cobertura de testes só em `lib/`; sem CI |
| F-19 | Média | COMPROVADO (código) / não testado em browser | Acessibilidade: labels sem associação, diálogo sem foco, select custom sem teclado |
| F-20 | Baixa | COMPROVADO | UX/i18n: idiomas misturados, sem `error.tsx`/`not-found`, fluxo de registo incompleto |
| F-21 | Baixa | COMPROVADO | Documentação desatualizada/incorreta (README) |
| F-22 | Baixa | COMPROVADO | Qualidade/manutenção: ficheiros gigantes, duplicação, cliente BD sem tipos |
| F-23 | — | HIPÓTESES | CSRF, fuso horário, floats, TOCTOU, saldos negativos |

---

### F-01 — Qualquer membro apaga ou altera o saldo de qualquer conta  · **Alta** · COMPROVADO

- **Onde:** `src/app/api/bank-accounts/route.ts:354-380` (DELETE), `:194-203` e `:300-316` (PATCH nome/saldo).
- **Evidência:** o DELETE faz `getAccount` → `ensureFamilyMember(...)` (linha 371) → `delete`. Não chama `ensureAccountAccess` nem `ensureAccountOwner`, que existem em `api-auth.ts` e que o resto da API usa para respeitar a visibilidade por conta. O PATCH só exige owner (`ensureAccountOwner`, linha 207) quando se alteram *permissões*; alterar `name`/`balance` só exige ser membro da família (linha 196). `ensureFamilyOwner` só é usado em `api/families` e `api/family-members` (pesquisa no código).
- **Impacto:** um membro sem visibilidade de uma conta privada (ou com papel `member`) pode (a) apagar a conta — com `ON DELETE CASCADE` desaparecem todas as transações, metas e recorrentes ligadas — e (b) definir o saldo arbitrariamente. Quebra o modelo "visibilidade por conta" que o resto da aplicação implementa.
- **Padrão semelhante, a verificar:** `categories` DELETE (`categories/route.ts:288`) só exige membro; apagar categoria faz `ON DELETE SET NULL` nas transações (perde categorização e a ligação `affects_loan`). Edição/eliminação de transações por qualquer membro com acesso à conta (sem noção de autoria) é possivelmente intencional — confirmar com o produto.
- **Solução:** centralizar autorização numa função única `authorize(user, action, resource)`; exigir `ensureAccountOwner` (ou owner da família) para DELETE e para alterar `balance`; idealmente **impedir alteração direta de `balance`** (ver F-04) e usar um ajuste auditável.

### F-02 — Escalada de privilégios via `user_metadata`  · **Alta** · COMPROVADO em código; exploração não executada

- **Onde:** `src/lib/member-kind.ts:12-16`; consumo em `src/lib/api-auth.ts:229-233` e `:272-279`.
- **Evidência:** `getMemberKindFromAuthUser` devolve `"system"` se `app_metadata.homefund_member_kind === "system"` **ou** `user_metadata.homefund_member_kind === "system"`. `user_metadata` é escrito pelo próprio utilizador (o cliente Supabase permite `auth.updateUser({ data: {...} })` com o JWT dele — comportamento documentado do Supabase; **não testado aqui**). `getAccessibleAccountIds` devolve **todas** as contas da família a quem seja "system" (linha 232) e `ensureAccountOwner` aceita-o se for owner da família (274-279).
- **Impacto:** um membro normal pode marcar-se como "system" e contornar a visibilidade por conta (ler transações/saldos de contas privadas de outros membros). Também passa a ser filtrado das listas de membros (`filterHumanMembers`).
- **Solução:** confiar **apenas** em `app_metadata` (só editável com `service_role`) ou, melhor, na coluna `family_members.kind`; remover a leitura de `user_metadata`. Em `createSystemUser` (`family-members/route.ts:41-56`) manter `app_metadata`.

### F-03 — Server action `addMember` sem autorização  · **Alta** · COMPROVADO; alcance PROVÁVEL

- **Onde:** `src/app/actions/families.ts:43-58` (`addMember`), `:18-41` (`createFamily`); `src/app/actions/accounts.ts:18` (`inviteMember`).
- **Evidência:** `addMember(familyId, name, email?)` só verifica que há sessão; depois usa `service_role` para inserir em `family_members` para **qualquer `familyId`**. Quem passar o seu próprio email fica membro de qualquer família cujo UUID conheça. Nenhum ficheiro da aplicação importa `addMember`/`createFamily` (pesquisa), nem `AccountCreateForm`/`AccountInviteForm` (`inviteMember` usa tabelas legadas `account_members`) → parecem **código morto**.
- **Estado:** o Next.js costuma eliminar server actions não referenciadas do build, por isso o alcance real é **PROVÁVEL-baixo, não verificado**. Mesmo assim é uma armadilha: basta alguém importá-la.
- **Solução:** apagar `src/app/actions/*` e os componentes legados, ou reescrever com verificação de owner reutilizando `ensureFamilyOwner`.

### F-04 — Saldos atualizados por ler-modificar-escrever, sem transação  · **Alta** · COMPROVADO

- **Onde:** `transactions/route.ts:241-254` (`applyBalanceDelta`); `loan-payments/route.ts:36-51`; `recurring-transactions/route.ts:~280, 395-440`; `supabase/functions/recurring-runner/index.ts:~150-157`.
- **Evidência:** todos fazem `SELECT balance` → somam em JS → `UPDATE balance = <valor calculado>`. Nenhum usa `balance = balance + x` nem RPC/transação.
  - Sequências com falha parcial: criar transação (`transactions/route.ts:876-900`) insere a linha **e só depois** ajusta o saldo; se o ajuste falhar, a API responde 400 mas a transação já existe. No DELETE (`:1536-1545`, `:1614-1620`) apaga a linha e depois reverte o saldo; falha ⇒ saldo errado. Na transferência (`:756-870`, ajustes em `:855-862`) os dois ajustes são independentes e feitos após os inserts.
- **Impacto:** *lost update* sob concorrência (dois utilizadores/tabs/job em simultâneo) e divergência permanente entre `bank_accounts.balance` e a soma das transações. O saldo é um valor **derivado armazenado** sem mecanismo de reconciliação.
- **Contraste positivo:** `apply_goal_movement_v1` (migração 14) faz tudo atomicamente com `FOR UPDATE`. É o padrão a generalizar.
- **Solução:** funções SQL/RPC transacionais para criar/editar/apagar transação (que ajustam saldo na mesma transação com `UPDATE … SET balance = balance + :delta`), ou deixar de armazenar saldo e calculá-lo (`opening_balance + sum(...)`) com vista/materialização; job de reconciliação periódico.

### F-05 — Reconciliação de recorrentes no cliente + apagamento automático por heurística  · **Alta** · COMPROVADO

- **Onde:** `src/context/AppState.tsx:236-262` (dispara `POST /api/recurring-transactions {action:"recalculate"}` em cada utilizador/tab a cada ≥5 min); `recurring-transactions/route.ts:300-380` (`cleanupRecurringDuplicates`), chamada em `:537` (**dentro do GET**) e `:680`; `supabase/functions/recurring-runner/index.ts`.
- **Evidência:**
  1. Um **GET** executa escritas (materializa ocorrências, ajusta saldos, apaga linhas).
  2. `cleanupRecurringDuplicates` **apaga** transações cuja descrição contenha `[recurring:<id>:<data>]` repetido na mesma conta — heurística baseada em texto livre (ver F-07): um utilizador que copie/cole esse marcador numa transação manual vê a segunda a ser eliminada, com o saldo "corrigido" depois.
  3. Três escritores concorrentes: API (id determinístico SHA-256, `:49-66`), Edge Function (id aleatório + dedupe por `ILIKE '%marker%'`, `recurring-runner/index.ts:118-127`) e várias sessões de browser. Sem lock, a janela de duplicação existe — e o "remédio" é apagar.
  4. Datas: a API usa `todayIsoDate()` (hora local do servidor, `api-auth.ts:343`), a Edge Function usa UTC (`recurring-runner:52+`).
  5. `normalizeFrequency`/`nextDateFromFrequency` estão duplicadas entre API e Edge Function; `setUTCMonth(+1)` salta dias (31 jan → 3 mar) — o avanço mensal deriva e nunca "regressa" ao dia 31.
- **Impacto:** duplicados, perda de lançamentos legítimos, saldos divergentes e datas deslocadas.
- **Solução:** um único executor (pg_cron/Supabase cron + função SQL idempotente com `INSERT … ON CONFLICT (recurring_id, occurrence_date) DO NOTHING` e coluna própria em vez de tag), retirar a reconciliação do browser e do GET, e tornar o avanço mensal relativo ao dia-âncora.

### F-06 — Dependências com vulnerabilidades (incl. `next` crítico)  · **Alta** · COMPROVADO

- **Evidência (`npm audit`, 2026-11-23):** 20 vulnerabilidades (1 crítica, 9 altas, 9 moderadas, 1 baixa). A crítica é o próprio **`next` (direto), intervalo 9.3.4-canary.0 – 16.4.4**, "Denial of Service with Server Components"; correção disponível em `next@16.4.6`. Altas transitivas: `postcss`, `sharp` (via `next`), `ws`, `zod`, `js-yaml`, `brace-expansion`, `browserslist`, `nanoid`, `source-map-js` (`fixAvailable` indicado pelo audit). `package.json` fixa `next` e `eslint-config-next` em `16.2.1`.
- **Impacto:** DoS remoto no servidor Next em produção (para a crítica). As restantes são maioritariamente de build/dev; avaliar caso a caso.
- **Solução:** atualizar `next`/`eslint-config-next` (≥16.4.6), `npm audit fix`, rever `npm audit` em CI; ativar Dependabot/Renovate. Consultar `node_modules/next/dist/docs/01-app/01-getting-started/18-upgrading.md` antes (regra do `AGENTS.md`).

### F-07 — Metadados funcionais em texto livre injetáveis  · **Média** · COMPROVADO

- **Onde:** `src/lib/goal-moves.ts`, `member-tags.ts`; `transactions/route.ts:100-170`, `:713`, `:887`; SQL `14_atomic_goal_movements.sql:346-362`.
- **Evidência:** ligações a metas, empréstimos, transferências, recorrências e atribuição a membros vivem como `[goal:uuid] [goal-move:x] [loan:uuid] [transfer:uuid:side] [recurring:uuid:date] [members:a,b]` **dentro de `transactions.description`**. No POST de uma transação normal só se removem as tags de `loan` e `members` (`withLoanTag`, `withMemberIdsTag`); `[goal:…]`, `[goal-move:…]`, `[transfer:…]`, `[recurring:…]` introduzidas pelo utilizador **não são sanitizadas** (`:713`, `:887`).
- **Impacto:** um utilizador pode fabricar uma descrição que faça o DELETE/PATCH seguir o ramo de "movimento de meta" ou "transferência" (DELETE: `transactions/route.ts:1516` goal-move, `:1558` transfer; PATCH: `:963`, `:1107`), ajustando saldos/metas de forma inconsistente (dentro do âmbito da família). Também: consultas `ILIKE '%[transfer:…%'` sem índice (cresce O(n)), regexes duplicadas em 3 sítios, e a migração 11 teve de "reparar" dados por regex.
- **Solução:** colunas/tabelas próprias (`goal_id`, `loan_id`, `transfer_id`, `recurring_id`, `transaction_members`), migração de dados, e rejeitar/escapar `[...]` em descrições. Curto prazo: sanitizar todas as tags reservadas no input.

### F-08 — Schema em duas gerações, migrações com lacunas e dependências ocultas  · **Alta** · COMPROVADO (BD real não verificada)

- **Evidência:**
  - `01_schema.sql` (modelo legado `accounts/account_members`, `transactions.account_id/user_id/category NOT NULL`) e `06_families_schema.sql` (modelo `families/bank_accounts`) **coexistem**. `06` usa `CREATE TABLE IF NOT EXISTS` sobre tabelas legadas já existentes (`transactions`, `goals`, `loans`) → **não** as altera; só `ADD COLUMN IF NOT EXISTS`. Ficam colunas legadas `NOT NULL` (`goals.user_id`, `loans.account_id`, `transactions.account_id/user_id/category`) que todos os inserts têm de preencher. É por isso que o código escreve em ambas (`account_id: bankAccountId`, `user_id`, `category`…) e mantém um espelho `accounts` por cada `bank_account` (`api-auth.ts:ensureLegacyAccountForBankAccount`, chamado em cada escrita).
  - Numeração `…11` → `14`: **faltam `12` e `13`**. `14_atomic_goal_movements.sql` depende de `family_members.kind` (`:299, :308`), que **nenhum ficheiro SQL cria**; e de `goals.deadline`/`account_id` (só no legado 01) e do espelho `accounts` (`:265`).
  - README lista só `01–08` como migrações; `09–14` não constam.
  - O código tem *fallbacks* para colunas em falta (`isMissingColorColumnError` ×3, 5 variantes de INSERT em `loans/route.ts:187-240`, `goals` com fallback `account_id`), o que é evidência de deriva entre ambientes.
  - `07_families_rls.sql` e `02_rls.sql` usam `CREATE POLICY` sem `DROP IF EXISTS`: **não são idempotentes** (reaplicar falha). `08_migrate_old_to_families.sql` usa tabela temporária e `DISTINCT name` para criar famílias → contas com o mesmo nome fundem-se numa só família.
  - `loans.monthly_payment`/`total_amount` sem `CHECK`; `family_members`/`bank_accounts` sem unicidade `(family_id, user_id)` (o código tolera duplicados "legacy", `api/families/route.ts:29`).
- **Impacto:** instalações novas podem falhar a meio ou ficar num estado parcial; comportamento diferente por ambiente; qualquer nova feature tem de suportar dois schemas.
- **Solução:** baseline único consolidado + migrações geradas com Supabase CLI (`supabase/migrations`), remover legado e espelho `accounts`, constraints (`UNIQUE(family_id,user_id)`, `CHECK(amount>0)`), tipos gerados (`supabase gen types`).
- **Não verificado:** estado da BD de produção/dev.

### F-09 — RLS permissiva/defeituosa; a aplicação contorna-a  · **Média** · COMPROVADO

- **Evidência:**
  - `07_families_rls.sql:162-167`: `is_family_member()` é `LANGUAGE sql STABLE` **sem `SECURITY DEFINER`** e consulta `family_members`, cuja própria política chama a função → recursão infinita de políticas. `supabase-admin.ts:37` confirma-o em comentário ("bypass broken RLS recursion paths").
  - Por isso **toda a API usa `service_role`** (RLS ignorada). A autorização vive só no código das rotas — um único esquecimento (cf. F-01) expõe dados. A chave anon é pública (`NEXT_PUBLIC_*`): se alguma vez a RLS passar a funcionar tal como escrita, ela é permissiva (qualquer membro pode `UPDATE/DELETE` em `families` e `family_members`, incl. alterar o próprio papel — `07:170-182`).
  - `07:177-180` e `02:115-118`: subconsultas com `family_id = family_id` / `account_id = account_id` não qualificadas → comparam a coluna consigo mesma (política incorreta).
  - `02:103`: `accounts` INSERT `WITH CHECK (true)`.
  - Políticas de `transactions`/`transfers`/`goals` não validam que `bank_account_id` pertence à mesma família.
- **Solução:** `SECURITY DEFINER` com `search_path` fixo para os helpers; políticas por papel (owner vs member) e por visibilidade de conta; testes pgTAP; manter `service_role` apenas onde necessário.

### F-10 — Pagamentos de empréstimo: inconsistências  · **Média** · COMPROVADO

- **Onde:** `loan-payments/route.ts:140-190` (POST), `:246-251` (DELETE).
- **Evidência:** o POST insere o pagamento, atualiza `remaining_amount` (resultado **não verificado**, linha 154), insere uma transação de despesa e ajusta o saldo. O DELETE só apaga o pagamento e **repõe** o `remaining_amount`; não remove a transação criada nem reverte o saldo da conta. Não há limite superior: pagar mais do que falta é truncado a 0 (`Math.max(0, …)`), mas ao apagar soma-se o valor **completo**, inflacionando o remanescente. Respostas de erro como "Payment saved but transaction failed" deixam estado parcial.
- **Impacto:** saldo de conta e transações divergem do estado do empréstimo; remanescente incorreto após apagar.
- **Solução:** RPC transacional (pagamento + transação + saldo + remanescente) e DELETE simétrico; validar `amount ≤ remaining`.

### F-11 — Truncagem silenciosa a 1000 linhas  · **Média** · PROVÁVEL

- **Onde:** `api/dashboard/route.ts:364` (`.limit(1000)` nas transações do período), `:370-381` (consulta de uso por categoria **sem limite** — PostgREST limita por omissão a `max-rows`, tipicamente 1000), `api/transactions/route.ts:413` (com filtro `memberIds` usa `limit(1000)` e ignora a paginação).
- **Impacto:** famílias com >1000 transações no intervalo veem totais/gráficos/"uso por categoria" incompletos sem aviso; o filtro por membro não pagina. Depende de como o dashboard agrega (`420–648`, **não lido**).
- **Solução:** agregar em SQL (`GROUP BY`, vistas/RPC), paginar por cursor, devolver `truncated: true`.

### F-12 — Sem validação de input; erros de BD expostos  · **Média** · COMPROVADO

- **Evidência:** nenhum schema de validação (sem Zod/Valibot) — todas as rotas fazem `request.json() as {...}`. Exemplos: datas apenas `slice(0,10)` (`transactions/route.ts:677`, `goals`, `loan-payments:68`) sem validar formato/intervalo; `Number(payload.balance)` pode ser `NaN/Infinity` (`bank-accounts/route.ts:113, 203`); `page` NaN (`transactions:360`); montantes sem teto; strings sem limite de tamanho. Dezenas de respostas devolvem `error.message` do PostgREST/Postgres ao cliente (`…, { status: 400 }`), revelando nomes de colunas/constraints.
- **Solução:** Zod por rota (parse → tipos), `Number.isFinite`, limites, e um *error mapper* central que devolve mensagens genéricas + id de correlação.

### F-13 — Custo de autenticação/autorização por pedido  · **Média** · COMPROVADO

- **Onde:** `member-kind.ts:23-47` (`getAuthUsersByIds` percorre `listUsers` página a página — até **todos** os utilizadores da plataforma — por pedido); `family-members/route.ts:17-39` (`findUserByEmail` idem); `actions/*.ts:12` (só 1ª página de 1000); `api-auth.ts:231,273` (`getAuthUserKindById` → `admin.auth.admin.getUserById` extra em cada verificação de acesso); `dashboard/route.ts:226-249` duplica `getRequestUser`.
- **Impacto:** latência e carga crescem com o nº de utilizadores totais; cada pedido faz 4–8 viagens sequenciais (getUser, membership, contas, account_members, getUserById…). Com >1000 utilizadores as server actions deixam de encontrar emails.
- **Solução:** guardar `kind` e `email` em `family_members`/`profiles` (tabela própria sincronizada por trigger), procurar por email via consulta indexada/`getUserByEmail`, cache por pedido, e juntar verificações numa única consulta/RPC.

### F-14 — Enumeração de emails e criação de contas com email arbitrário  · **Média** · COMPROVADO

- **Onde:** `family-members/route.ts:176-221, 341-358`.
- **Evidência:** qualquer *owner* de família recebe respostas diferentes para "email existe / não existe" (`:213-216`, `:351`), podendo sondar quem está registado na plataforma inteira. Para utilizadores `system`, `createUser({ email, password, email_confirm: true })` cria uma conta confirmada com **qualquer** email que ainda não exista — incluindo o de terceiros — com palavra-passe escolhida pelo owner.
- **Impacto:** privacidade (RGPD) e *pre-account-takeover* (o dono real não conseguirá registar-se com esse email).
- **Solução:** convites por token enviados por email (o convidado aceita), resposta neutra; para utilizadores API usar domínio reservado/identificadores não-email e `email_confirm: false`.

### F-15 — Edge Functions  · **Média** · PROVÁVEL (deploy não verificado)

- `recurring-runner/index.ts:52`: `serve(async () => …)` com `service_role` e **sem verificar o chamador**. Se `verify_jwt` estiver ativo (por omissão), a chave `anon` (pública) basta para o invocar; se desativado, qualquer pessoa. Efeito: disparo arbitrário do job (carga, concorrência com F-05).
- `create-transaction/index.ts`: escreve no **modelo legado** (`account_members`, `transactions.account_id`); a verificação de pertença (`:39-43`) usa `.single()` **sem filtrar por `user_id`** → falha com ≥2 membros ou valida pertença de outrem (depende de RLS). Não é chamada pela app → provável código morto; o README manda fazer deploy dela.
- **Solução:** autenticar o runner por segredo (cabeçalho `x-cron-secret`) ou migrar para `pg_cron`; remover `create-transaction`.

### F-16 — Sem `proxy.ts` (middleware do Next 16)  · **Média** · COMPROVADO (ausência) / impacto PROVÁVEL

- **Evidência:** não existe `proxy.ts`/`middleware.ts` (confirmado: `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` é a convenção atual). Páginas são todas `"use client"` (exceto `app/page.tsx`); o único redirecionamento para `/login` está num `useEffect` em `families/page.tsx:56-59`. `supabase-server.ts:27-36` ignora falhas de escrita de cookies em Server Components, e não há sítio no servidor que renove o token.
- **Impacto:** visitantes não autenticados recebem o *shell* das páginas e só depois erros 401 nas chamadas; sem refresh de sessão no servidor a cookie-auth pode expirar (o código mitiga enviando `Authorization: Bearer` obtido no browser). Má UX e superfície desnecessária.
- **Solução:** `proxy.ts` com `@supabase/ssr` (refresh + redirect), páginas como Server Components a ler dados iniciais.

### F-17 — Sem headers de segurança, CSP nem rate limiting  · **Média** · COMPROVADO

- `next.config.ts` só define `allowedDevOrigins: ["192.168.1.35"]` (IP de LAN fixo no repositório). Sem CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy. Script inline de tema (`layout.tsx:118`) exigirá *nonce* para uma CSP estrita. Nenhuma limitação de taxa nas rotas (nem em criação de utilizadores `system`, nem em pesquisas por email). Login/registo dependem apenas dos limites do Supabase.
- **Solução:** `headers()` no `next.config.ts` + CSP com nonce via `proxy.ts`; rate limit (Upstash/Vercel) nas rotas sensíveis.

### F-18 — Testes e CI  · **Média** · COMPROVADO

- 30 testes, todos em `src/lib/*.test.ts` (lógica pura). **Zero** para rotas API, `api-auth`, RPC SQL, componentes ou E2E. Não existe `.github/` nem outra CI. O script `"test": "tsx --test src/**/*.test.ts"` usa glob não citado: expande pela shell (sem `globstar` só apanha `src/<dir>/*.test.ts`, ignorando subpastas). Sem `.env.example`.
- **Impacto:** as regressões de autorização/financeiras (F-01…F-10) não seriam detetadas.
- **Solução:** testes de integração das rotas com Supabase local (`supabase start`), testes pgTAP de RLS/RPC, Playwright para fluxos críticos, CI (lint+tsc+test+audit+build).

### F-19 — Acessibilidade  · **Média** · COMPROVADO no código; **não testado em browser/leitor de ecrã**

- 74 `<label>` e **0** `htmlFor`; em login/registo o `<label>` é irmão do `<input>` (não o envolve) → controlos sem nome acessível (`(auth)/login/page.tsx`, `register/page.tsx` ~l.38-46).
- `AppDialog.tsx:45`: `role="dialog" aria-modal` sem `aria-labelledby`, sem *focus trap*, sem foco inicial nem devolução de foco, fundo não `inert`; fecha-se com clique no *scrim* sem confirmação.
- `PrettySelect.tsx`: `<button>` + lista sem `aria-haspopup/aria-expanded`, sem `role="listbox/option"`, sem navegação por setas/typeahead; fecha só com `mousedown` fora.
- `<html lang="en">` (`layout.tsx:112`) mas UI mistura PT/EN; mensagens de erro/estado sem `role="alert"`/`aria-live`; indicadores de cor de categoria dependem de cor (há texto, mas não verificado em todos os ecrãs).
- **Solução:** `htmlFor`/`useId`, primitivas acessíveis (Radix/React Aria/Headless UI), `lang` dinâmico, auditoria axe/Lighthouse.

### F-20 — UX / i18n / robustez de interface  · **Baixa** · COMPROVADO

- Strings misturadas ("Saving…", "Close" vs "Não tens permissão para alterar esta poupança"); EUR e `pt-PT` fixos (`format.ts`).
- Não existem `error.tsx`, `global-error.tsx` nem `not-found.tsx`; apenas `dashboard/loading.tsx`.
- Registo (`register/page.tsx:14-27`): após `signUp` redireciona sempre para `/families` e força `window.location.assign` após 150 ms (workaround) — com confirmação de email ativa não há sessão e o utilizador cai no login sem explicação. Não há "esqueci-me da palavra-passe", nem confirmação de palavra-passe, nem regras de força.
- Sessão "última família" e conta principal em `localStorage` (válido; limpo no logout).

### F-21 — Documentação desatualizada  · **Baixa** · COMPROVADO

`README.md` afirma "RSC-first / Server components for data fetching" (todas as páginas são clientes com SWR), "sessão persistente em localStorage" (`@supabase/ssr` usa cookies), lista migrações só até `08`, diz que goals/loans têm "UI mínima" (têm páginas completas), e manda fazer deploy de `create-transaction` (legado). Não documenta o `kind` do membro, o `SUPABASE_SERVICE_ROLE_KEY` como segredo crítico, nem o desenho de tags.

### F-22 — Qualidade e manutenção  · **Baixa** · COMPROVADO

- Ficheiros gigantes: `transactions/route.ts` 1638 l., `recurring-transactions/route.ts` 982, `globals.css` 1923, `themes.css` 1547, `TransactionWizard.tsx` 905, `goals/page.tsx` 885.
- Duplicação: `isMissingColorColumnError` (3+ cópias), `normalizeFrequency`/`nextDateFromFrequency` (API + Edge), `getUserFromAuthHeader` vs `getRequestUser`, regexes de tags (3 sítios), `listUsers` (4 sítios).
- Cliente `supabaseAdmin` com tipos genéricos `Record<string, unknown>` (`supabase-admin.ts:5-19`) → perde-se a verificação de colunas; muitos `as` e `unknown as`.
- Sete famílias de fontes Google carregadas no layout (`layout.tsx:22-65`) — impacto de desempenho **não medido**.
- `next build --webpack` forçado (não usa Turbopack) — verificar se ainda é necessário.
- Funções legadas e código morto (ver F-03, F-15).

### F-23 — Hipóteses (não verificadas)

| Hipótese | Nota |
|---|---|
| **CSRF** em rotas por cookie | Rotas aceitam `request.json()` independentemente do `Content-Type`; mitigado se as cookies Supabase forem `SameSite=Lax` (por omissão). Não testado. |
| **Fuso horário** | `todayIsoDate()` usa hora local do servidor; runner usa UTC; datas `YYYY-MM-DD` sem TZ do utilizador → "hoje" pode divergir à meia-noite. |
| **Floats** | Aritmética monetária em `number` JS (`asNumber`, `balance + delta`), arredondada só pelo `numeric(14,2)`. O RPC usa cêntimos (correto) — inconsistência entre caminhos. |
| **TOCTOU** | Verificação de pertença/acesso e operação feitas em chamadas separadas com `service_role`. |
| **Saldos negativos** | Nenhuma rota impede saldo negativo em despesas/transferências; pode ser intencional. |
| **Ordem de `balance_after`** | Cálculo por *replay* da linha temporal limitado a 1000 (`transaction-balance.ts`, **não lido**). |

---

## 4. Análise por dimensão (resumo)

| Dimensão | Avaliação | Nota |
|---|---|---|
| Autenticação | Delegada ao Supabase Auth (email/password); dupla via cookie/Bearer correta (`getUser` valida no servidor). Faltam reset de password, MFA, proxy, rate limit. | F-16, F-17, F-20 |
| Autorização | Verificações manuais por rota, inconsistentes; modelo "system user" frágil. | F-01, F-02, F-03 |
| Validação | Inexistente de forma sistemática. | F-12 |
| Integridade de dados | Ponto mais fraco; só o RPC de metas é atómico. | F-04, F-05, F-10 |
| Desempenho/escala | N+1 em auth, truncagens, `ILIKE` por tags, `listUsers`. Nada medido. | F-11, F-13 |
| Acessibilidade | Lacunas básicas visíveis no código; não testado. | F-19 |
| UX/UI | Funcionalidade rica (wizard, temas, PWA manifest); i18n e estados de erro incompletos. Responsividade **não verificada**. | F-20 |
| Testes | 30 testes de lógica pura; resto sem cobertura; sem CI. | F-18 |
| Manutenção | Ficheiros grandes, duplicação, dois schemas. | F-08, F-22 |
| Segurança de plataforma | Sem CSP/headers; dependências vulneráveis. | F-06, F-17 |

---

## 5. Prioridade sugerida de correção

1. **Imediato (dias):** F-06 (atualizar Next), F-02 (ignorar `user_metadata`), F-01 (autorização em DELETE/PATCH de contas e categorias), apagar `actions/*` (F-03), retirar `cleanupRecurringDuplicates` do GET (F-05).
2. **Curto prazo (1–3 semanas):** RPCs transacionais para transações/saldos/empréstimos (F-04, F-10), Zod + error mapper (F-12), CI com testes de API (F-18), headers de segurança (F-17), `proxy.ts` (F-16).
3. **Médio prazo:** consolidação de schema e eliminação do legado (F-08), colunas em vez de tags (F-07), executor único de recorrências (F-05), RLS correta (F-09), `kind`/email materializados (F-13), acessibilidade (F-19).
