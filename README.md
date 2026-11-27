# Simulador e Gestão de Mão de Obra (Headcount)

Aplicação web interna desenvolvida para planejamento operacional de turnos, alocação inteligente de máquinas (Termoformagem e Extrusão), controle diário de absenteísmo e gestão de equipes em tempo real.

* **Acesso ao sistema (Ambiente Atual):** [https://cavera360jm-cmd.github.io/headcount/](https://cavera360jm-cmd.github.io/headcount/)

---

## Stack Tecnológica e Ambiente de Desenvolvimento

O sistema foi projetado para ser **leve, transparente e de fácil manutenção**, sem depender de frameworks pesados, servidores complexos ou pacotes externos ocultos:

* **Ambiente de Desenvolvimento (VS Code):** Todo o código foi escrito e estruturado no **Visual Studio Code**, utilizando apenas tecnologias web nativas padrão de mercado.
* **Frontend Puro (Zero Dependências / Sem Build):** Desenvolvido exclusivamente com **HTML5, CSS3 e JavaScript (ES6+)** puro (*Vanilla JS*). Não foram instalados pacotes `npm`, bibliotecas de terceiros não auditadas ou compiladores — o navegador executa exatamente o código-fonte legível presente neste repositório.
* **Hospedagem Estática (GitHub & GitHub Pages):**
  * **GitHub:** Utilizado como repositório de versionamento do código-fonte, garantindo histórico completo de alterações.
  * **GitHub Pages (Plano Gratuito):** Serviço de hospedagem de arquivos estáticos que publica a interface diretamente via HTTPS. Ele entrega apenas os arquivos visuais (`HTML`, `CSS` e `JS`) para o navegador do usuário, sem executar processamento de backend nem armazenar dados de colaboradores.
* **Backend e Banco de Dados (Supabase — Plano Gratuito / Free Tier):**
  * Plataforma *Backend-as-a-Service (BaaS)* baseada em **PostgreSQL** gerenciado, utilizada em sua **versão gratuita (Free Tier)** — sem custo de licenciamento para a operação atual.
  * Fornece autenticação de usuários, API REST automática via HTTPS, sincronização em tempo real (*Realtime Channels*) e controle de acesso por linha (*Row Level Security*) diretamente no banco de dados.

---

## Arquitetura e Separação de Dados

O sistema opera com separação estrita entre o **código-fonte da interface** e o **armazenamento dos dados operacionais**, garantindo que nenhuma informação pessoal fique exposta publicamente:

1. **Camada de Apresentação (GitHub Pages):**
   * Contém **exclusivamente os arquivos estáticos da interface** (`index.html`, `style.css`, `melhorias.css`, `app.js`, `melhorias.js` e `nuvem.js`).
   * **Zero dados pessoais no código:** Nenhuma lista de colaboradores, nomes, cargos, históricos de faltas ou senhas de acesso existem neste repositório.
2. **Camada de Dados e Autenticação (Supabase PostgreSQL):**
   * Todos os dados operacionais (`colaboradores`, `setores`, `faltas` e `config_sim`) residem exclusivamente no banco PostgreSQL do Supabase, protegidos por criptografia em trânsito (TLS/HTTPS) e em repouso.

---

## Controles de Segurança e Conformidade com a LGPD

Para atender às diretrizes de segurança da informação e à **Lei Geral de Proteção de Dados (Lei nº 13.709/2018)**, as seguintes camadas de proteção foram implementadas:

* **Minimização de Dados (Art. 6º, III - LGPD):** O banco armazena apenas os dados estritamente necessários para a alocação operacional nos turnos (nome, cargo, equipe, setor, status operacional e datas de movimentação), sem coleta de documentos pessoais sensíveis (CPF, RG, endereço, telefone ou dados bancários).
* **Controle de Acesso e Autenticação Fechada:**
  * O cadastro público de novos usuários (*Sign Up*) está **desativado** no Supabase, exigindo confirmação de e-mail corporativo para ativação de contas provisionadas.
  * Nenhuma tela ou dado operacional é carregado antes da validação da sessão autenticada do usuário, com verificação periódica automática de sessão ativa e domínio.
* **Restrição por Domínio Corporativo (`@ajover.com`) e RLS no Banco:**
  * Todas as tabelas (`colaboradores`, `setores`, `faltas` e `config_sim`) possuem **Row Level Security (RLS)** ativado.
  * A validação de acesso no PostgreSQL é centralizada na função `public.is_ajover()`, que exige sessão autenticada (`authenticated`) e valida no token JWT que o e-mail pertence ao domínio `@ajover.com`.
  * Políticas granulares (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) bloqueiam qualquer acesso anônimo ou de domínios externos diretamente no nível do banco de dados.
* **Chave Pública de Cliente (`Publishable Key`):**
  * O arquivo `nuvem.js` utiliza exclusivamente a chave pública (`sb_publishable_...`), projetada para operar no navegador em conjunto com as regras de RLS. Chaves administrativas (`service_role`) não existem no código-fonte.
* **Sincronização e Rastreabilidade:**
  * Alterações de quadro e apontamentos diários são gravados diretamente no banco protegido com sincronização em tempo real, eliminando o tráfego de planilhas locais desatualizadas com dados de colaboradores.

---

## Guia de Migração para o Ecossistema Microsoft (Azure + Domínio Ajover)

Como o projeto foi construído em **HTML, CSS e JavaScript puro** sobre **PostgreSQL**, ele não possui dependência proprietária (*vendor lock-in*) e pode ser migrado integralmente para a nuvem **Microsoft Azure** da Ajover com endereço corporativo próprio (ex.: `https://headcount.ajover.com`).

### Arquitetura Alvo na Microsoft

| Camada | Solução Atual (Custo Zero) | Solução Corporativa Microsoft (Azure) |
| :--- | :--- | :--- |
| **Hospedagem Frontend** | GitHub Pages | **Azure Static Web Apps** (ou **Azure App Service**) |
| **Domínio & Certificado SSL** | `*.github.io` | **Domínio Corporativo Ajover** (`headcount.ajover.com`) com SSL gerenciado |
| **Autenticação / MFA** | Supabase Auth (`@ajover.com`) | **Microsoft Entra ID (Azure AD) — Single Sign-On (SSO)** |
| **Banco de Dados** | Supabase (PostgreSQL) | **Azure Database for PostgreSQL** (Flexible Server) |

### Passo a Passo Técnico para Implantação pela TI

1. **Publicação no Azure Static Web Apps e Domínio Customizado (`headcount.ajover.com`):**
   * Criar um recurso **Azure Static Web Apps** conectado ao repositório do projeto (ou via upload direto dos 6 arquivos estáticos).
   * Na aba **Custom domains** do Azure Static Web Apps, adicionar o subdomínio desejado (ex.: `headcount.ajover.com`).
   * No servidor DNS da Ajover, criar um registro **`CNAME`** apontando `headcount.ajover.com` para o hostname gerado pelo Azure (`*.azurestaticapps.net`). O Azure provisiona e renova o certificado HTTPS/TLS automaticamente.
2. **Ativação do Login Corporativo (Microsoft Entra ID / SSO):**
   * Registrar a aplicação no **Microsoft Entra ID → App registrations** (configurado como *Single Tenant — Ajover only*).
   * Configurar a autenticação nativa do Azure Static Web Apps (`staticwebapp.config.json`) ou integrar via OAuth 2.0, garantindo que apenas colaboradores ativos no diretório `@ajover.com` com o MFA corporativo da empresa acessem a página.
3. **Migração do Banco de Dados para o Azure:**
   * Provisionar uma instância **Azure Database for PostgreSQL** na assinatura corporativa da Ajover.
   * Exportar o schema (tabelas `colaboradores`, `setores`, `faltas`, `config_sim` e políticas RLS) e os dados do Supabase via `pg_dump` e restaurar no PostgreSQL do Azure, atualizando apenas o endpoint de conexão em `nuvem.js`.
4. **Trilha de Auditoria (Opcional Recomendado):**
   * Adicionar colunas `updated_by` e `updated_at` nas tabelas operacionais para registrar automaticamente qual usuário `@ajover.com` realizou cada alteração de turno ou cadastro.

---

## Estrutura dos Arquivos

| Arquivo | Função |
| :--- | :--- |
| `index.html` | Estrutura visual do painel, abas de simulação e modal de gestão de equipes. |
| `style.css` / `melhorias.css` | Folhas de estilo e responsividade da interface. |
| `app.js` / `melhorias.js` | Regras de cálculo de capacidade, alocação por grupo de máquinas e renderização. |
| `nuvem.js` | Camada de autenticação, leitura/gravação segura no banco e sincronização em tempo real. |
