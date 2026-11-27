# Headcount & Simulador de Turnos — Arquitetura, Segurança (LGPD) e Guia de Evolução Azure

Aplicação web interna criada para facilitar o planejamento diário de turnos, a distribuição de pessoas nas máquinas (Termoformagem e Extrusão), o controle de faltas e a gestão das equipes em tempo real.

* **Acesso ao sistema:** [https://cavera360jm-cmd.github.io/headcount/](https://cavera360jm-cmd.github.io/headcount/)

---

## Como o Sistema Foi Feito e Onde Ele Roda

O projeto foi desenhado para ser simples, leve, fácil de manter e **sem custo de licenciamento** no momento:

* **Onde o código foi escrito (VS Code):** Todo o sistema foi construído no editor Visual Studio Code, usando apenas a base padrão da internet (HTML, CSS e JavaScript puro), sem instalar pacotes extras ou programas pesados.
* **Onde a tela fica publicada (GitHub e GitHub Pages — Gratuito):** O GitHub guarda as versões do código, e o **GitHub Pages** (na versão gratuita) coloca o site no ar com cadeado de segurança (HTTPS). Ele serve apenas para exibir a tela no navegador — **não guarda nomes, faltas ou dados de colaboradores**.
* **Onde os dados ficam guardados (Supabase — Versão Gratuita):** É o banco de dados na nuvem utilizado na **versão gratuita**. É ele que armazena o cadastro das equipes, setores, faltas do dia e prioridades das máquinas, atualiza a tela para todos que estiverem usando e só libera o acesso após login com e-mail `@ajover.com`.

---

## Segurança e Conformidade com a LGPD

Para proteger as informações da empresa e atender à **Lei Geral de Proteção de Dados (Lei nº 13.709/2018)**, o sistema segue estas regras:

* **Apenas dados essenciais (Minimização — LGPD):** O banco guarda somente o necessário para organizar os turnos (nome, cargo, equipe, setor, status e datas de movimentação). Nenhum documento sensível (como CPF, RG, endereço, telefone ou dados bancários) é coletado ou armazenado.
* **Separação entre Tela e Dados:** Os arquivos públicos do site contêm apenas o visual e os cálculos; todas as informações de colaboradores ficam isoladas no banco de dados protegido.
* **Acesso Fechado e Restrito a `@ajover.com`:**
  * Ninguém consegue criar uma conta sozinho pelo site; apenas administradores autorizados habilitam novos acessos.
  * Tanto a tela quanto o banco de dados bloqueiam qualquer tentativa de acesso sem login ou com e-mails fora do domínio `@ajover.com`.
* **Fim das Planilhas Soltas:** Como as faltas e mudanças de turno ficam centralizadas no banco, evita-se o envio de arquivos e planilhas desatualizadas com listas de funcionários.

---

## Próximos Passos: Migração para a Nuvem Microsoft (Azure + Domínio Ajover)

Hoje o sistema roda sem custos usando GitHub Pages e Supabase. Caso a empresa deseje trazer toda a estrutura para dentro do ambiente oficial da **Microsoft (Azure)** da Ajover — usando um endereço interno como `https://headcount.ajover.com` — a transição é direta e não exige refazer o sistema:

| O que é | Como funciona hoje (Custo Zero) | Como fica na Microsoft (Azure) |
| :--- | :--- | :--- |
| **Endereço do Site** | `cavera360jm-cmd.github.io/headcount` | **Domínio oficial Ajover** (`headcount.ajover.com`) |
| **Hospedagem da Tela** | GitHub Pages | **Azure Static Web Apps** |
| **Login e Senha** | E-mail `@ajover.com` + senha no Supabase | **Login único Microsoft 365 (SSO)** — usa a mesma senha e autenticação do e-mail/Teams da Ajover |
| **Banco de Dados** | Supabase (PostgreSQL) | **Azure Database for PostgreSQL** |

**Principais ganhos ao migrar para o Azure:**
* **Login único da empresa:** O colaborador entra com a própria conta Microsoft da Ajover, aproveitando as regras de segurança e dupla verificação já usadas pela TI.
* **Bloqueio automático no desligamento:** Se um funcionário sair da empresa e a TI desativar o e-mail dele na Microsoft, o acesso ao sistema é cortado na mesma hora.
* **Infraestrutura 100% interna:** Todo o banco de dados passa a ficar dentro da assinatura corporativa da Ajover.

---

## Parte Técnica (Referência para a Equipe de TI)

* **Frontend:** HTML5, CSS3 e JavaScript puro (*Vanilla JS* ES6+), sem *bundlers*, frameworks externos ou dependências `npm`.
* **Hospedagem Estática:** **GitHub Pages** sob TLS/HTTPS, sem processamento *server-side*.
* **Banco de Dados e Autenticação:** **Supabase** (*Free Tier*) sobre **PostgreSQL** gerenciado, utilizando apenas a chave pública de cliente (`Publishable Key`) no frontend — chaves administrativas (`service_role`) não existem no código.
* **Segurança no Banco (RLS):** Todas as tabelas (`colaboradores`, `setores`, `faltas` e `config_sim`) operam com **Row Level Security (RLS)** ativado e políticas granulares (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) vinculadas à função `public.is_ajover()`, que valida no token JWT (`authenticated`) o domínio `%@ajover.com`.
* **Roteiro de Migração Azure:**
  1. Publicar os arquivos estáticos no **Azure Static Web Apps** e apontar o subdomínio `headcount.ajover.com` via registro `CNAME` no DNS da Ajover (SSL gerenciado automaticamente).
  2. Configurar um *App Registration* (*Single Tenant*) no **Microsoft Entra ID** para autenticação nativa OAuth 2.0 / OpenID Connect.
  3. Exportar o schema (tabelas e políticas RLS) e os dados via `pg_dump` para uma instância **Azure Database for PostgreSQL**, atualizando o endpoint de conexão em `nuvem.js`.
  4. *(Opcional)* Incluir colunas de auditoria (`updated_by`, `updated_at`) para trilha de alterações por usuário.

---

## Estrutura dos Arquivos

| Arquivo | Função |
| :--- | :--- |
| `index.html` | Estrutura visual do painel, abas de simulação e janela de gestão de equipes. |
| `style.css` / `melhorias.css` | Aparência visual, cores e adaptação para diferentes tamanhos de tela. |
| `app.js` / `melhorias.js` | Regras de cálculo de capacidade, distribuição nas máquinas e atualização da tela. |
| `nuvem.js` | Controle de login, leitura/gravação segura no banco de dados e atualização em tempo real. |
