
/* ============================================================
   SIMULADOR DE MÃO DE OBRA - TERMOFORMAGEM / EXTRUSÃO
   Dados carregados de ./dados.json
   ============================================================ */

"use strict";

const CONFIG = {
  dataUrl: "./dados.json",
  teams: ["A", "B", "C", "D"],
  machineGroups: [
    { id: "G1", machines: [1, 2, 3], operators: 1, assistants: 1 },
    { id: "G2", machines: [4, 5], operators: 1, assistants: 0 },
    { id: "G3", machines: [6, 7, 8], operators: 1, assistants: 1 },
    { id: "G4", machines: [9, 10], operators: 1, assistants: 1 }
  ],
  machines: Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return {
      id: n,
      name: `TF ${n}`,
      packers: ([6, 7, 8, 10].includes(n) ? 3 : 2),
      priority: n
    };
  }),
  millWorkers: 2,
  statusesNoHeadcount: [
    "dispensa/absenteismo", "dispensa", "absenteismo", "restricao",
    "falta reposicao", "afastado - inss", "afastada - gestante",
    "aumento de quadro", "vai entrar", "vaga aberta"
  ],
  statusesUnavailable: [
    "ferias", "dispensa/absenteismo", "dispensa", "absenteismo", "restricao",
    "falta reposicao", "afastado - inss", "afastada - gestante",
    "aumento de quadro", "vai entrar", "vaga aberta"
  ]
};

let appData = null;
let selectedTeam = "A";
let priorities = Object.fromEntries(CONFIG.machines.map(m => [m.id, m.priority]));
let machineModes = Object.fromEntries(CONFIG.machines.map(m => [m.id, "auto"]));
let machinePackers = Object.fromEntries(CONFIG.machines.map(m => [m.id, m.packers]));
let lastSimulation = null;
let searchTerm = "";
let selectedSectorView = "all";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function loadMachineSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("darnel-machine-settings") || "{}");
    const teamSettings = saved[selectedTeam];
    if (!teamSettings) return;
    priorities = { ...priorities, ...(teamSettings.priorities || {}) };
    machineModes = { ...machineModes, ...(teamSettings.modes || {}) };
    machinePackers = { ...machinePackers, ...(teamSettings.packers || {}) };
  } catch (error) {
    console.warn("Não foi possível recuperar as configurações das máquinas.", error);
  }
}

function saveMachineSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("darnel-machine-settings") || "{}");
    saved[selectedTeam] = {
      priorities,
      modes: machineModes,
      packers: machinePackers
    };
    localStorage.setItem("darnel-machine-settings", JSON.stringify(saved));
  } catch (error) {
    console.warn("Não foi possível salvar as configurações das máquinas.", error);
  }
}

function getTeam(teamName = selectedTeam) {
  return appData?.equipes?.find(team =>
    String(team.equipe).toUpperCase() === String(teamName).toUpperCase()
  ) || null;
}

function getSetor(teamName, sectorName) {
  const team = getTeam(teamName);
  return team?.setores?.find(s =>
    normalize(s.setor) === normalize(sectorName)
  ) || null;
}

function getEmployees(teamName, sectorName) {
  return getSetor(teamName, sectorName)?.colaboradores || [];
}

function hasExitDate(employee) {
  return Boolean(String(employee?.dt_saida ?? "").trim());
}

function isCountedInHeadcount(employee) {
  if (!employee || !String(employee.nome ?? "").trim() || hasExitDate(employee)) {
    return false;
  }
  return !CONFIG.statusesNoHeadcount.includes(normalize(employee.status));
}

function isDisponivelHoje(employee) {
  if (!isCountedInHeadcount(employee)) return false;
  return !CONFIG.statusesUnavailable.includes(normalize(employee.status));
}

function isPacker(employee) {
  return normalize(employee.cargo).includes("auxiliar de producao");
}

function isOperator(employee) {
  return normalize(employee.cargo).includes("operador de termoformagem");
}

function isAssistant(employee) {
  return normalize(employee.cargo).includes("assistente de termoformagem");
}

function isLeader(employee) {
  return normalize(employee.cargo).includes("operador lider de termoformagem") ||
    normalize(employee.status) === "operador lider";
}

function getAvailableEmployees(teamName, role, onlyPresent = true) {
  const employees = getEmployees(teamName, "TERMOFORMAGEM");

  return employees.filter(employee => {
    if (!String(employee.nome ?? "").trim() || hasExitDate(employee)) return false;
    if (!isDisponivelHoje(employee)) return false;

    if (role === "packer") return isPacker(employee);
    if (role === "operator") return isOperator(employee);
    if (role === "assistant") return isAssistant(employee);
    if (role === "leader") return isLeader(employee);

    return false;
  });
}

function getSelectedOptions() {
  return {
    leaderBackup: Boolean($("#chk-lider-backup")?.checked),
    reserveMills: $("#chk-moinhos") ? $("#chk-moinhos").checked : true,
    onlyPresent: true
  };
}

function getAvailablePool(teamName, role, onlyPresent) {
  return getAvailableEmployees(teamName, role, onlyPresent);
}

function getGroupForMachine(machineId) {
  return CONFIG.machineGroups.find(group =>
    group.machines.includes(Number(machineId))
  );
}

function simulateTeam(teamName = selectedTeam) {
  const options = getSelectedOptions();
  const onlyPresent = options.onlyPresent;

  const packers = getAvailablePool(teamName, "packer", onlyPresent);
  const operators = getAvailablePool(teamName, "operator", onlyPresent);
  const assistants = getAvailablePool(teamName, "assistant", onlyPresent);
  const leaders = getAvailablePool(teamName, "leader", onlyPresent);

  const packerPool = [...packers];
  const operatorPool = [...operators];
  const assistantPool = [...assistants];
  const leaderPool = [...leaders];

  const millAllocation = options.reserveMills
    ? packerPool.splice(0, Math.min(CONFIG.millWorkers, packerPool.length))
    : [];

  const configuredMachines = CONFIG.machines.map(machine => ({

    ...machine,
    packers: Number(machinePackers[machine.id] ?? machine.packers),
    mode: machineModes[machine.id] || "auto",
    priority: Number(priorities[machine.id] ?? machine.priority)
  }));

  const orderedMachines = [...configuredMachines].sort((a, b) => {
    const rankA = a.mode === "on" ? 0 : 1;
    const rankB = b.mode === "on" ? 0 : 1;
    return rankA - rankB || a.priority - b.priority;
  });

  const machineResults = [];
  const groupAllocations = {};
  const initializedGroups = new Set();

  for (const machine of orderedMachines) {
    if (machine.mode === "off") {
      machineResults.push({
        ...machine,
        running: false,
        reason: "Parada definida manualmente",
        assignedPackers: []
      });
      continue;
    }

    if (packerPool.length < machine.packers) {
      machineResults.push({
        ...machine,
        running: false,
        reason: `Faltam ${machine.packers - packerPool.length} embalador(es)`,
        assignedPackers: []
      });
      continue;
    }

    const group = getGroupForMachine(machine.id);

    if (!initializedGroups.has(group.id)) {
      initializedGroups.add(group.id);

      const assignedOperator = operatorPool.shift() || null;
      const assignedAssistant = group.assistants > 0
        ? (assistantPool.shift() || null)
        : null;

      let leaderUsed = null;

      if (!assignedOperator && options.leaderBackup && leaderPool.length) {
        leaderUsed = leaderPool.shift();
      }

      const operatorOk = Boolean(assignedOperator || leaderUsed);
      const assistantOk = group.assistants === 0 || Boolean(assignedAssistant);

      groupAllocations[group.id] = {
        group,
        operator: assignedOperator,
        assistant: assignedAssistant,
        leader: leaderUsed,
        ready: operatorOk && assistantOk,
        reason: !operatorOk
          ? "Sem operador disponível no grupo"
          : (!assistantOk ? "Sem assistente disponível no grupo" : "")
      };
    }

    const allocation = groupAllocations[group.id];

    if (!allocation?.ready) {
      machineResults.push({
        ...machine,
        running: false,
        reason: allocation?.reason || "Grupo sem mão de obra",
        assignedPackers: []
      });
      continue;
    }

    const assignedPackers = packerPool.splice(0, machine.packers);

    machineResults.push({
      ...machine,
      running: true,
      reason: "Mão de obra disponível",
      assignedPackers
    });
  }

  const runningCount = machineResults.filter(machine => machine.running).length;

  const requiredPackers = configuredMachines
    .filter(machine => machine.mode !== "off")
    .reduce((sum, machine) => sum + machine.packers, 0);

  const assignedMachinePackers = machineResults
    .filter(machine => machine.running)
    .reduce((sum, machine) => sum + machine.packers, 0);

  const result = {
    team: teamName,
    options,
    machineResults: machineResults.sort((a, b) => a.id - b.id),
    groupAllocations,

    available: {
      packers: packers.length,
      operators: operators.length,
      assistants: assistants.length,
      leaders: leaders.length
    },

    allocated: {
      millWorkers: millAllocation,
      machinePackers: assignedMachinePackers,
      operators: Object.values(groupAllocations).filter(g => g.operator).length,
      assistants: Object.values(groupAllocations).filter(g => g.assistant).length,
      leaders: Object.values(groupAllocations).filter(g => g.leader).length
    },

    requirements: {
      packers: requiredPackers,
      packersWithMills: requiredPackers + (options.reserveMills ? CONFIG.millWorkers : 0),
      operators: 4,
      assistants: 3
    },

    runningCount,
    stoppedCount: configuredMachines.length - runningCount,
    availableAfterMills: packerPool.length,
    freePackersAfterAllocation: packerPool.length,

    automaticMachinesRunning: machineResults
      .filter(m => m.running && m.mode === "auto")
      .map(m => m.name)
  };

  lastSimulation = result;
  return result;
}

function statusClass(status) {
  const key = normalize(status);

  if ([
    "ativo", "pcd", "em experiencia", "treinamento",
    "supervisor", "operador lider", "temporario", "mudanca de setor"
  ].includes(key)) {
    return "status-ok";
  }

  if (key === "alerta de faltas") return "status-warning";

  if ([
    "ferias", "restricao", "falta reposicao", "vai entrar",
    "vaga aberta", "afastado - inss", "afastada - gestante",
    "aumento de quadro", "dispensa/absenteismo", "dispensa", "absenteismo"
  ].includes(key)) {
    return "status-danger";
  }

  return "status-neutral";
}

function renderResourceSummary(result) {
  const container = $("#resource-summary-grid");
  if (!container) return;

  const cards = [
    {
      label: "Embaladores disponíveis",
      value: result.available.packers,
      detail: `${result.requirements.packersWithMills} necessários incluindo moinhos`
    },
    {
      label: "Operadores disponíveis",
      value: result.available.operators,
      detail: `${result.requirements.operators} necessários por grupos`
    },
    {
      label: "Assistentes disponíveis",
      value: result.available.assistants,
      detail: `${result.requirements.assistants} necessários por grupos`
    },
    {
      label: "Máquinas viáveis",
      value: `${result.runningCount}/10`,
      detail: `${result.stoppedCount} máquina(s) sem condição de operar`
    }
  ];

  container.innerHTML = cards.map(card => `
    <article class="resource-card">
      <span class="resource-card-label">${escapeHtml(card.label)}</span>
      <strong class="resource-card-value">${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </article>
  `).join("") + `
    <div class="redistribution-note">
      <strong>Redistribuição automática de mão de obra</strong>
      <span>Quando uma máquina é colocada em <b>Parada manual</b>, seus embaladores deixam de ser reservados para ela. O simulador redistribui os recursos para as máquinas em modo <b>Automático</b>, respeitando prioridade, grupo operacional e quantidade de pessoas exigida.</span>
      <small>${result.automaticMachinesRunning.length
        ? `Máquinas em modo automático rodando: ${result.automaticMachinesRunning.map(escapeHtml).join(", ")}.`
        : "Nenhuma máquina em modo automático está rodando neste momento."}</small>
      <small>${result.freePackersAfterAllocation} embalador(es) livre(s) após a alocação das máquinas${result.options.reserveMills ? " e reserva dos moinhos" : ""}.</small>
    </div>`;
}

function renderLayout() {
  const container = $("#tf-grid");
  if (!container) return;

  const result = simulateTeam();

  const sorted = [...result.machineResults].sort((a, b) =>
    Number(priorities[a.id]) - Number(priorities[b.id])
  );

  container.innerHTML = sorted.map(machine => {
    const mode = machineModes[machine.id] || "auto";

    const modeLabel = mode === "off"
      ? "PARADA MANUAL"
      : (machine.running ? "RODANDO" : "SEM MO");

    const modeClass = mode === "off"
      ? "status-stopped"
      : (machine.running ? "status-running" : "status-stopped");

    return `
      <article class="tf-card ${machine.running ? "is-running" : "is-stopped"}" data-machine="${machine.id}">
        <div class="tf-card-top">
          <div>
            <span class="tf-eyebrow">TERMOFORMAGEM</span>
            <h3>${machine.name}</h3>
          </div>
          <span class="machine-status ${modeClass}">${modeLabel}</span>
        </div>

        <div class="machine-controls">
          <label>Prioridade
            <select class="priority-select" data-priority="${machine.id}" aria-label="Prioridade ${machine.name}">
              ${CONFIG.machines.map(m => `
                <option value="${m.id}" ${Number(priorities[m.id]) === Number(priorities[machine.id]) ? "selected" : ""}>${m.id}</option>
              `).join("")}
            </select>
          </label>

          <label>Embaladores
            <select class="packers-select" data-packers="${machine.id}" aria-label="Embaladores ${machine.name}">
              ${[1, 2, 3, 4, 5].map(n => `
                <option value="${n}" ${Number(machinePackers[machine.id]) === n ? "selected" : ""}>${n}</option>
              `).join("")}
            </select>
          </label>
        </div>

        <label class="machine-mode-label">Status operacional
          <select class="machine-mode-select" data-mode="${machine.id}" aria-label="Status operacional ${machine.name}">
            <option value="auto" ${mode === "auto" ? "selected" : ""}>Automático · conforme MO</option>
            <option value="on" ${mode === "on" ? "selected" : ""}>Liberada para operar</option>
            <option value="off" ${mode === "off" ? "selected" : ""}>Parada manual</option>
          </select>
        </label>

        <p class="tf-reason">${escapeHtml(machine.reason)}</p>

        ${machine.running
          ? `<small class="tf-assigned">${machine.assignedPackers.length} embalador(es) alocado(s)</small>`
          : `<small class="tf-assigned tf-unassigned">${mode === "off" ? "Retirada da programação" : "Não alocada por falta de recurso"}</small>`}
      </article>
    `;
  }).join("");

  renderResourceSummary(result);
  bindMachineControls();
  renderExtrusaoLayout();
}

function bindMachineControls() {
  $$(".priority-select").forEach(select => {
    select.addEventListener("change", event => {
      const machineId = Number(event.currentTarget.dataset.priority);
      const newPriority = Number(event.currentTarget.value);

      const otherMachine = Object.keys(priorities).find(id =>
        Number(id) !== machineId && Number(priorities[id]) === newPriority
      );

      if (otherMachine) {
        priorities[otherMachine] = Number(priorities[machineId]);
      }

      priorities[machineId] = newPriority;
      saveMachineSettings();
      renderLayout();
    });
  });

  $$(".packers-select").forEach(select => {
    select.addEventListener("change", event => {
      machinePackers[Number(event.currentTarget.dataset.packers)] =
        Number(event.currentTarget.value);

      saveMachineSettings();
      renderLayout();
    });
  });

  $$(".machine-mode-select").forEach(select => {
    select.addEventListener("change", event => {
      machineModes[Number(event.currentTarget.dataset.mode)] =
        event.currentTarget.value;

      saveMachineSettings();
      renderLayout();
    });
  });
}

function renderExtrusaoLayout() {
  const grid = $("#ext-grid");
  if (!grid) return;

  const sector = getSetor(selectedTeam, "EXTRUSÃO");
  const employees = sector?.colaboradores || [];

  const label = $("#ext-team-label");
  const manager = $("#ext-gestor-label");
  const badge = $("#ext-status-badge");

  if (label) label.textContent = `Equipe ${selectedTeam}`;
  if (manager) manager.textContent = sector?.gestor || "Gestor não informado";

  const present = employees.filter(isDisponivelHoje);
  const total = employees.filter(isCountedInHeadcount).length;

  if (badge) badge.textContent = `${present.length} disponíveis de ${total}`;

  if (!employees.length) {
    grid.innerHTML = `
      <p class="empty-state">
        Não há colaboradores cadastrados para Extrusão nesta equipe.
      </p>
    `;
    return;
  }

  grid.innerHTML = employees.map(employee => `
    <article class="employee-mini-card">
      <div class="employee-mini-main">
        <strong>${escapeHtml(employee.nome || "Vaga sem preenchimento")}</strong>
        <small>${escapeHtml(employee.cargo)}</small>
      </div>
      <span class="employee-status ${statusClass(employee.status)}">
        ${escapeHtml(employee.status)}
      </span>
    </article>
  `).join("");
}

function countRealizado(teamName, sectorName, onlyPresent = false) {
  const employees = getEmployees(teamName, sectorName);

  return employees.filter(employee => {
    if (onlyPresent) return isDisponivelHoje(employee);
    return isCountedInHeadcount(employee);
  }).length;
}

function getSectorStats(teamName, sectorName) {
  const sector = getSetor(teamName, sectorName);
  const employees = sector?.colaboradores || [];

  const named = employees.filter(isCountedInHeadcount);
  const available = named.filter(isDisponivelHoje);
  const vacancies = employees.filter(employee =>
    normalize(employee.status) === "vaga aberta"
  ).length;
  const absent = named.filter(employee => !isDisponivelHoje(employee)).length;

  return {
    sector,
    total: named.length,
    available: available.length,
    absent,
    vacancies,
    target: Number(sector?.meta || 0),
    shiftTotal: sector?.total_turno
  };
}

function renderDashboard() {
  const kpis = $("#dashboard-kpis");
  if (!kpis) return;

  const teams = (appData?.equipes || []).map(item => String(item.equipe));

  const tfStats = teams.map(team => ({
    team,
    ...getSectorStats(team, "TERMOFORMAGEM")
  }));

  const extStats = teams.map(team => ({
    team,
    ...getSectorStats(team, "EXTRUSÃO")
  }));

  const allAvailable = tfStats.reduce((sum, stat) => sum + stat.available, 0);
  const allTarget = tfStats.reduce((sum, stat) => sum + stat.target, 0);
  const allVacancies = tfStats.reduce((sum, stat) => sum + stat.vacancies, 0);
  const allAbsent = tfStats.reduce((sum, stat) => sum + stat.absent, 0);

  kpis.innerHTML = [
    {
      label: "Colaboradores disponíveis · TF",
      value: allAvailable,
      detail: "Somatório das equipes A-D"
    },
    {
      label: "Meta de quadro · TF",
      value: allTarget,
      detail: "Meta cadastrada por equipe"
    },
    {
      label: "Vagas abertas · TF",
      value: allVacancies,
      detail: "Posições sem colaborador"
    },
    {
      label: "Indisponíveis · TF",
      value: allAbsent,
      detail: "Inclui férias e afastamentos; fora da MO operacional"
    }
  ].map(item => `
    <article class="dashboard-kpi">
      <span>${escapeHtml(item.label)}</span>
      <strong>${item.value}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </article>
  `).join("");

  renderTeamStatusTable(tfStats);
  renderIdealTable("table-termo-ideal", tfStats, "TERMOFORMAGEM");
  renderIdealTable("table-ext-ideal", extStats, "EXTRUSÃO");
}

function renderTeamStatusTable(stats) {
  const table = $("#table-status-equipe");
  if (!table) return;

  table.innerHTML = `
    <thead>
      <tr>
        <th>Equipe</th>
        <th>MO disponível</th>
        <th>Headcount nominal</th>
        <th>Meta</th>
        <th>Vagas</th>
        <th>Indisponíveis</th>
      </tr>
    </thead>
    <tbody>
      ${stats.map(stat => `
        <tr>
          <td><strong>Equipe ${stat.team}</strong></td>
          <td>${stat.available}</td>
          <td>${stat.total}</td>
          <td>${stat.target || "—"}</td>
          <td>${stat.vacancies}</td>
          <td>${stat.absent}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderIdealTable(id, stats, sectorName) {
  const table = document.getElementById(id);
  if (!table) return;

  table.innerHTML = `
    <thead>
      <tr>
        <th>Equipe</th>
        <th>Gestor</th>
        <th>Disponíveis</th>
        <th>Meta</th>
        <th>Diferença</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${stats.map(stat => {
        const difference = stat.available - stat.target;
        const label = difference >= 0
          ? "Meta atingida"
          : `Déficit de ${Math.abs(difference)}`;

        return `
          <tr>
            <td><strong>${stat.team}</strong></td>
            <td>${escapeHtml(stat.sector?.gestor || "—")}</td>
            <td>${stat.available}</td>
            <td>${stat.target || "—"}</td>
            <td>${difference > 0 ? "+" : ""}${stat.target ? difference : "—"}</td>
            <td>
              <span class="table-status ${difference >= 0 ? "status-ok" : "status-warning"}">
                ${stat.target ? label : "Meta não definida"}
              </span>
            </td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
}

function renderEquipesEditor() {
  const container = $("#equipes-editor-container");
  if (!container) return;

  const team = getTeam(selectedTeam);

  if (!team) {
    container.innerHTML = `<p class="empty-state">Equipe não encontrada.</p>`;
    return;
  }

  container.innerHTML = `
    <section class="team-config-editor">
      <h3>Dados gerais da equipe ${escapeHtml(team.equipe)}</h3>

      <div class="team-config-grid">
        <label>
          Data de conferência
          <input
            id="edit-data-conferencia"
            type="text"
            value="${escapeHtml(appData.data_conferencia || "")}"
            placeholder="DD/MM/AAAA"
          >
        </label>

        <label>
          Identificação da equipe
          <input
            id="edit-team-name"
            type="text"
            value="${escapeHtml(team.equipe)}"
            readonly
          >
        </label>
      </div>

      <button class="btn btn-primary btn-sm" id="save-team-config" type="button">
        Salvar dados gerais
      </button>
    </section>

    ${team.setores.map((sector, index) => {
      const sectorEmployees = (sector.colaboradores || []).filter(employee => {
        const haystack = normalize(
          `${employee.nome} ${employee.cargo} ${employee.status} ${sector.setor}`
        );

        return !searchTerm || haystack.includes(normalize(searchTerm));
      });

      return `
        <section class="editor-sector">
          <div class="editor-sector-heading">
            <div>
              <h3>${escapeHtml(sector.setor)}</h3>
              <p>Edite gestor, meta e total do turno.</p>
            </div>
            <span>${sectorEmployees.length} registro(s)</span>
          </div>

          <div class="sector-config-grid">
            <label>
              Gestor
              <input
                data-sector-manager="${index}"
                type="text"
                value="${escapeHtml(sector.gestor || "")}"
              >
            </label>

            <label>
              Meta
              <input
                data-sector-meta="${index}"
                type="number"
                min="0"
                value="${escapeHtml(sector.meta ?? 0)}"
              >
            </label>

            <label>
              Total por turno
              <input
                data-sector-shift="${index}"
                type="number"
                min="0"
                value="${escapeHtml(sector.total_turno ?? 0)}"
              >
            </label>

            <button
              class="btn btn-outline btn-sm save-sector-config"
              data-sector-save="${index}"
              type="button"
            >
              Salvar setor
            </button>
          </div>

          <div class="editor-employee-list">
            ${sectorEmployees.map(employee => {
              const employeeIndex = sector.colaboradores.indexOf(employee);

              return `
                <article class="editor-employee">
                  <div>
                    <strong>${escapeHtml(employee.nome || "Vaga aberta")}</strong>
                    <small>${escapeHtml(employee.cargo)} · ${escapeHtml(employee.status)}</small>
                    ${employee.observacoes
                      ? `<small class="employee-note">${escapeHtml(employee.observacoes)}</small>`
                      : ""}
                  </div>

                  <div class="employee-actions">
                    <span class="employee-status ${statusClass(employee.status)}">
                      ${escapeHtml(employee.status)}
                    </span>

                    <button
                      class="btn btn-outline btn-sm edit-employee"
                      data-sector="${index}"
                      data-employee="${employeeIndex}"
                      type="button"
                    >
                      Editar
                    </button>

                    <button
                      class="btn btn-danger btn-sm delete-employee"
                      data-sector="${index}"
                      data-employee="${employeeIndex}"
                      type="button"
                    >
                      Excluir
                    </button>
                  </div>
                </article>
              `;
            }).join("") || `
              <p class="empty-state">Nenhum registro corresponde à busca.</p>
            `}
          </div>
        </section>
      `;
    }).join("")}
  `;

  $("#save-team-config")?.addEventListener("click", () => {
    appData.data_conferencia =
      $("#edit-data-conferencia")?.value.trim() || appData.data_conferencia;

    renderAll();
    alert("Dados gerais atualizados. Clique em Exportar JSON para salvar o arquivo.");
  });

  $$(".save-sector-config").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.sectorSave);
      const sector = team.setores[index];

      sector.gestor = $(`[data-sector-manager="${index}"]`)?.value.trim() || "";
      sector.meta = Number($(`[data-sector-meta="${index}"]`)?.value || 0);
      sector.total_turno = Number($(`[data-sector-shift="${index}"]`)?.value || 0);

      renderAll();
      alert("Dados do setor atualizados. Clique em Exportar JSON para salvar o arquivo.");
    });
  });

  $$(".edit-employee").forEach(button => {
    button.addEventListener("click", () => {
      const sector = team.setores[Number(button.dataset.sector)];
      const employee = sector.colaboradores[Number(button.dataset.employee)];

      openAddModal(
        employee,
        Number(button.dataset.sector),
        Number(button.dataset.employee)
      );
    });
  });

  $$(".delete-employee").forEach(button => {
    button.addEventListener("click", () => {
      const sector = team.setores[Number(button.dataset.sector)];
      const index = Number(button.dataset.employee);
      const employee = sector.colaboradores[index];

      if (!confirm(`Excluir ${employee.nome || "este registro"} da equipe ${selectedTeam}?`)) {
        return;
      }

      sector.colaboradores.splice(index, 1);
      renderAll();
    });
  });
}

function renderTeamPills() {
  $$(".pill[data-team]").forEach(pill => {
    const active = String(pill.dataset.team).toUpperCase() === selectedTeam;
    pill.classList.toggle("active", active);
    pill.setAttribute("aria-pressed", String(active));
  });

  $$(".team-pills [data-team], #edit-team-pills [data-team]").forEach(pill => {
    const active = String(pill.dataset.team).toUpperCase() === selectedTeam;
    pill.classList.toggle("active", active);
  });
}

function applySectorFilter() {
  const active = selectedSectorView || "all";

  $$("[data-sector-block]").forEach(element => {
    const sector = element.dataset.sectorBlock;
    element.hidden = active !== "all" && active !== sector;
  });

  $$("[data-sector-filter]").forEach(button => {
    const selected = button.dataset.sectorFilter === active;

    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderAll() {
  renderTeamPills();
  renderLayout();
  renderDashboard();
  renderEquipesEditor();
  applySectorFilter();

  const date = $("#data-conferencia");

  if (date && appData?.data_conferencia) {
    date.textContent = appData.data_conferencia;
  }
}

function switchTab(tabName) {
  $$(".tab-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  $$(".tab-panel, .tab-content, [data-tab-panel]").forEach(panel => {
    const panelName = panel.dataset.tabPanel || panel.id?.replace(/^panel-/, "");

    if (!panelName) return;

    panel.hidden = panelName !== tabName;
    panel.classList.toggle("active", panelName === tabName);
  });
}

function populateStatusSelect() {
  const select = $("#new-status");
  if (!select) return;

  const statuses = [
    "Ativo", "PCD", "Em Experiência", "Alerta de Faltas", "Supervisor",
    "Operador Líder", "Temporário", "Treinamento", "Mudança de Setor",
    "Férias", "Dispensa/Absenteísmo", "Restrição", "Falta Reposição",
    "Afastado - INSS", "Afastada - Gestante", "Aumento de Quadro",
    "Vai Entrar", "Vaga Aberta"
  ];

  select.innerHTML = statuses.map(status =>
    `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`
  ).join("");
}

let editingEmployee = null;

function openAddModal(employee = null, sectorIndex = null, employeeIndex = null) {
  const modal = $("#modal-add");
  if (!modal) return;

  const form = $("#form-add-colab");
  form?.reset();

  editingEmployee = employee ? { sectorIndex, employeeIndex } : null;

  $("#modal-title").textContent = employee
    ? "Editar colaborador"
    : "Adicionar colaborador";

  $("#modal-team-name").textContent = `Equipe ${selectedTeam}`;

  if (employee) {
    $("#new-setor").value = getTeam().setores[sectorIndex].setor;
    $("#new-cargo").value = employee.cargo || "";
    $("#new-nome").value = employee.nome || "";
    $("#new-status").value = employee.status || "Ativo";
    $("#new-admissao").value = employee.admissao || "";
    $("#new-dt-saida").value = employee.dt_saida || "";
    $("#new-obs").value = employee.observacoes || "";
  } else {
    $("#new-dt-saida").value = "";
  }

  modal.hidden = false;
  modal.classList.add("open");
}

function closeAddModal() {
  const modal = $("#modal-add");
  if (!modal) return;

  modal.hidden = true;
  modal.classList.remove("open");
  editingEmployee = null;
}

function addEmployeeFromForm(event) {
  event.preventDefault();

  const form = $("#form-add-colab");
  if (!form) return;

  const setorName = $("#new-setor")?.value;
  const setor = getSetor(selectedTeam, setorName);

  if (!setor) {
    alert("Selecione um setor válido.");
    return;
  }

  const employee = {
    numero: editingEmployee
      ? setor.colaboradores[editingEmployee.employeeIndex]?.numero
      : Math.max(0, ...setor.colaboradores.map(item => Number(item.numero) || 0)) + 1,

    cargo: $("#new-cargo")?.value?.trim() || "",
    nome: $("#new-nome")?.value?.trim() || "",
    status: $("#new-status")?.value || "Ativo",
    admissao: $("#new-admissao")?.value || "",
    dt_saida: $("#new-dt-saida")?.value || "",
    observacoes: $("#new-obs")?.value?.trim() || ""
  };

  if (!employee.cargo || !employee.nome) {
    alert("Preencha o cargo e o nome do colaborador.");
    return;
  }

  if (editingEmployee) {
    const originalSector = getTeam().setores[editingEmployee.sectorIndex];

    if (originalSector === setor) {
      originalSector.colaboradores[editingEmployee.employeeIndex] = employee;
    } else {
      originalSector.colaboradores.splice(editingEmployee.employeeIndex, 1);
      setor.colaboradores.push(employee);
    }
  } else {
    setor.colaboradores.push(employee);
  }

  renderAll();
  closeAddModal();
  form.reset();
}

function exportJson() {
  if (!appData) return;

  const blob = new Blob(
    [JSON.stringify(appData, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `dados-equipes-${new Date().toISOString().slice(0, 10)}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

async function importJsonFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    validateData(imported);

    appData = imported;
    renderAll();

    alert("Dados importados com sucesso.");
  } catch (error) {
    console.error(error);
    alert(`Não foi possível importar o JSON: ${error.message}`);
  }
}

function validateData(data) {
  if (!data || !Array.isArray(data.equipes)) {
    throw new Error(
      "O arquivo precisa conter a propriedade equipes em formato de lista."
    );
  }

  for (const team of data.equipes) {
    if (!team.equipe || !Array.isArray(team.setores)) {
      throw new Error(
        "Cada equipe precisa ter um nome e uma lista de setores."
      );
    }

    for (const sector of team.setores) {
      if (!Array.isArray(sector.colaboradores)) {
        throw new Error(
          `O setor ${sector.setor || ""} não possui a lista colaboradores.`
        );
      }
    }
  }
}

function bindEvents() {
  $$("[data-sector-filter]").forEach(button => {
    button.addEventListener("click", () => {
      selectedSectorView = button.dataset.sectorFilter || "all";

      try {
        localStorage.setItem("darnel-sector-view", selectedSectorView);
      } catch (_) {}

      applySectorFilter();
    });
  });

  $$(".tab-btn").forEach(button => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $$(".pill[data-team]").forEach(pill => {
    pill.addEventListener("click", () => {
      selectedTeam = String(pill.dataset.team).toUpperCase();

      priorities = Object.fromEntries(CONFIG.machines.map(m => [m.id, m.priority]));
      machineModes = Object.fromEntries(CONFIG.machines.map(m => [m.id, "auto"]));
      machinePackers = Object.fromEntries(CONFIG.machines.map(m => [m.id, m.packers]));

      loadMachineSettings();
      renderAll();
    });
  });

  ["chk-lider-backup", "chk-moinhos", "chk-apenas-presentes"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", renderLayout);
  });

  $("#reset-priority-btn")?.addEventListener("click", () => {
    priorities = Object.fromEntries(
      CONFIG.machines.map(machine => [machine.id, machine.id])
    );

    machineModes = Object.fromEntries(
      CONFIG.machines.map(machine => [machine.id, "auto"])
    );

    machinePackers = Object.fromEntries(
      CONFIG.machines.map(machine => [machine.id, machine.packers])
    );

    saveMachineSettings();
    renderLayout();
  });

  $("#export-json-btn")?.addEventListener("click", exportJson);

  $("#import-json-input")?.addEventListener("change", event => {
    importJsonFile(event.target.files?.[0]);
    event.target.value = "";
  });

  $("#search-colab")?.addEventListener("input", event => {
    searchTerm = event.target.value || "";
    renderEquipesEditor();
  });

  $("#add-colab-btn")?.addEventListener("click", openAddModal);
  $("#close-modal-btn")?.addEventListener("click", closeAddModal);
  $("#cancel-modal-btn")?.addEventListener("click", closeAddModal);

  $("#form-add-colab")?.addEventListener("submit", addEmployeeFromForm);

  $("#modal-add")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) {
      closeAddModal();
    }
  });

  $("#new-setor")?.addEventListener("change", event => {
    const selected = getSetor(selectedTeam, event.target.value);
    if (!selected) return;

    const cargoSelect = $("#new-cargo");

    if (cargoSelect && normalize(selected.setor) === "extrusao") {
      cargoSelect.value = "Operador de Extrusão";
    } else if (cargoSelect) {
      cargoSelect.value = "Auxiliar de Produção";
    }
  });
}

function configureEditorSectorSelect() {
  const select = $("#new-setor");
  if (!select) return;

  select.innerHTML = `
    <option value="TERMOFORMAGEM">TERMOFORMAGEM</option>
    <option value="EXTRUSÃO">EXTRUSÃO</option>
  `;
}

async function loadData() {
  try {
    const response = await fetch(CONFIG.dataUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status}`);
    }

    const data = await response.json();
    validateData(data);

    return data;
  } catch (error) {
    console.error("Falha ao carregar dados.json:", error);

    const message = document.createElement("div");
    message.className = "app-load-error";

    message.innerHTML = `
      <strong>Não foi possível carregar o dados.json.</strong>
      <p>Confirme se o arquivo está na mesma pasta do index.html e abra o projeto por um servidor local (não diretamente por file://).</p>
      <small>${escapeHtml(error.message)}</small>
    `;

    document.body.prepend(message);
    throw error;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  populateStatusSelect();
  configureEditorSectorSelect();

  try {
    const savedSectorView = localStorage.getItem("darnel-sector-view");

    if (["all", "term", "ext"].includes(savedSectorView)) {
      selectedSectorView = savedSectorView;
    }
  } catch (_) {}

  bindEvents();

  try {
    appData = await loadData();
    loadMachineSettings();
    renderAll();
  } catch (error) {
    console.error(error);
  }
});
