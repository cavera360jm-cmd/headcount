# Simulador e Gestão de Mão de Obra (Headcount)

Aplicação web interna para planejamento de turnos, alocação de máquinas (Termoformagem e Extrusão), controle diário de absenteísmo e gestão de equipes.

* **Acesso ao sistema:** [https://cavera360jm-cmd.github.io/headcount/](https://cavera360jm-cmd.github.io/headcount/)

---

## Arquitetura e Separação de Dados

O sistema foi estruturado com separação estrita entre o **código-fonte da interface** e o **armazenamento dos dados operacionais**, garantindo que nenhuma informação pessoal fique exposta publicamente.

1. **Hospedagem da Aplicação (GitHub Pages):**
   * Este repositório contém **exclusivamente os arquivos estáticos da interface** (`index.html`, `style.css`, `melhorias.css`, `app.js`, `melhorias.js` e `nuvem.js`).
   * **Zero dados pessoais no código:** Nenhuma lista de colaboradores, nomes, matrículas, cargos, históricos de faltas ou senhas de acesso são armazenados neste repositório.

2. **Banco de Dados e Autenticação (Supabase):**
   * Todos os dados operacionais (`colaboradores`, `setores`, `faltas` e `config_sim`) residem exclusivamente em banco de dados PostgreSQL gerenciado no Supabase, protegido por criptografia em trânsito (HTTPS/TLS) e em repouso.

---

## Controles de Segurança e Conformidade com a LGPD

Para atender às diretrizes de segurança da informação e à **Lei Geral de Proteção de Dados (Lei nº 13.709/2018)**, as seguintes camadas de proteção foram configuradas:

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

## Roadmap de Evolução e Migração Corporativa (Sugestões para TI)

Embora a arquitetura atual já opere com isolamento de dados, RLS e restrição de domínio, as etapas abaixo representam caminhos recomendados caso a equipe de TI deseje internalizar 100% da infraestrutura dentro do ecossistema **Microsoft** da Ajover:

### 1. Autenticação Única Corporativa (SSO com Microsoft Entra ID)
* **O que muda:** Substituir o login via e-mail/senha do Supabase pela autenticação nativa Microsoft 365 da empresa (OAuth 2.0 / OpenID Connect).
* **Ganhos de segurança:** Uso obrigatório do MFA corporativo já configurado pela TI, fim da gestão paralela de senhas e bloqueio imediato do sistema caso o colaborador seja desligado no Active Directory / Entra ID.
* **Requisito:** Criação de um *App Registration* (Single Tenant) no Microsoft Entra ID pela TI.

### 2. Migração de Hospedagem e Banco para a Nuvem Corporativa (Azure / Microsoft 365)
Caso a política interna exija que os dados residam exclusivamente em servidores gerenciados pela Ajover, o projeto pode ser migrado para o ambiente Microsoft sem reescrever as regras de negócio da interface:

| Camada Atual | Opção 1: Azure Cloud (Recomendada para escala) | Opção 2: Microsoft 365 / Power Platform |
| :--- | :--- | :--- |
| **Hospedagem Web (Frontend)** | **Azure Static Web Apps** (com autenticação nativa Entra ID integrada e domínio interno `headcount.ajover.com`) | **SharePoint Online** (hospedagem interna restrita aos membros do site da equipe) |
| **Banco de Dados** | **Azure Database for PostgreSQL** ou **Azure SQL Database** (mantendo a mesma estrutura relacional e políticas de acesso) | **Microsoft Dataverse** ou **SharePoint Lists** (governança nativa dentro do tenant Microsoft 365) |
| **Camada de API / Regras** | **Azure Functions** (endpoints protegidos por token corporativo) | **Power Automate** / APIs internas |

### 3. Auditoria e Logs de Alteração (Trilha de Auditoria)
* **Sugestão:** Adicionar colunas de auditoria (`updated_by`, `updated_at`) e triggers de histórico nas tabelas `colaboradores` e `faltas` para registrar qual usuário `@ajover.com` realizou cada movimentação de quadro ou lançamento diário.

---

## Estrutura dos Arquivos

| Arquivo | Função |
| :--- | :--- |
| `index.html` | Estrutura visual do painel, abas de simulação e modal de gestão de equipes. |
| `style.css` / `melhorias.css` | Folhas de estilo e responsividade da interface. |
| `app.js` / `melhorias.js` | Regras de cálculo de capacidade, alocação por grupo de máquinas e renderização. |
| `nuvem.js` | Camada de autenticação, leitura/gravação segura no banco e sincronização em tempo real. |
