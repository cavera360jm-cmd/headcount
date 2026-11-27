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
  * O cadastro público de novos usuários (*Sign Up*) está **desativado** no Supabase. Apenas administradores autorizados podem provisionar contas internas.
  * Nenhuma tela ou dado operacional é carregado antes da validação da sessão autenticada do usuário.
* **Restrição por Domínio Corporativo (`@ajover.com`) e RLS:**
  * Todas as tabelas do banco possuem **Row Level Security (RLS)** ativado.
  * Políticas de segurança no nível do banco bloqueiam qualquer leitura, inserção, edição ou exclusão anônima, exigindo sessão autenticada e validando explicitamente que o e-mail do usuário pertence ao domínio corporativo (`%@ajover.com`).
* **Chave Pública de Cliente (`Publishable Key`):**
  * O arquivo `nuvem.js` utiliza exclusivamente a chave pública (`sb_publishable_...`), projetada para operar no navegador em conjunto com as regras de RLS. Chaves administrativas (`service_role`) não existem no código-fonte.
* **Sincronização e Rastreabilidade:**
  * Alterações de quadro e apontamentos diários são gravados diretamente no banco protegido, evitando o tráfego de planilhas ou arquivos locais desatualizados com dados de colaboradores.

---

## Estrutura dos Arquivos

| Arquivo | Função |
| :--- | :--- |
| `index.html` | Estrutura visual do painel, abas de simulação e modal de gestão de equipes. |
| `style.css` / `melhorias.css` | Folhas de estilo e responsividade da interface. |
| `app.js` / `melhorias.js` | Regras de cálculo de capacidade, alocação por grupo de máquinas e renderização. |
| `nuvem.js` | Camada de autenticação, leitura/gravação segura no Supabase e sincronização em tempo real. |
