/* ============================================================
   MELHORIAS DO SIMULADOR — carregar DEPOIS do app.js
   - Marcar falta/presença por pessoa (salvo no navegador)
   - Alocação atômica: grupo só consome operador/assistente se a máquina roda
   - Operador Líder cobre 1 vaga de operador OU assistente
   - Fila de prioridade com ▲▼ / 📌 liberar / ⛔ parar e botão de maximizar
   - Simulação da Extrusão (regras deduzidas — ajuste em CFG.E)
   - Contador por equipe nas abas e botão "Copiar resumo"
   ============================================================ */
"use strict";
(() => {
  const baseDisp = window.isDisponivelHoje;
  const baseLoad = window.loadMachineSettings;
  const baseSave = window.saveMachineSettings;

  /* ---------- Estado extra ---------- */
  const LS = "darnel-sim-extra";
  const faltas = new Set();
  const EXT_IDS = [1, 2, 3, 4];
  let extPrio = {}, extMode = {};
  const resetExt = () => {
    extPrio = Object.fromEntries(EXT_IDS.map(i => [i, i]));
    extMode = Object.fromEntries(EXT_IDS.map(i => [i, "auto"]));
  };
  resetExt();
  const readLS = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } };

  window.saveMachineSettings = function () {
    baseSave();
    try {
      const d = readLS();
      d.faltas = [...faltas];
      d.ext = d.ext || {};
      d.ext[selectedTeam] = { prio: extPrio, mode: extMode };
      localStorage.setItem(LS, JSON.stringify(d));
    } catch (e) { console.warn("Não foi possível salvar.", e); }
    window.onSimSave?.(); // gancho usado pelo nuvem.js (Supabase)
  };

  window.loadMachineSettings = function () {
    baseLoad();
    resetExt();
    const d = readLS();
    if (!window.CLOUD) { faltas.clear(); (d.faltas || []).forEach(n => faltas.add(n)); }
    const e = d.ext?.[selectedTeam];
    if (e) { extPrio = { ...extPrio, ...e.prio }; extMode = { ...extMode, ...e.mode }; }
  };

  // Falta marcada hoje = indisponível (vale para simulador e dashboard)
  window.isDisponivelHoje = emp => baseDisp(emp) && !faltas.has(emp.nome);

  /* ---------- Regras por setor (ajuste aqui) ---------- */
  const CFG = {
    T: {
      sector: "TERMOFORMAGEM", mk: "TF",
      roles: {
        emb: /auxiliar de producao/, op: /^operador de termoformagem/,
        ass: /^assistente de termoformagem/, lead: /operador lider de termoformagem/
      },
      ids: () => CONFIG.machines.map(m => m.id),
      pk: id => Number(machinePackers[id]),
      groups: () => CONFIG.machineGroups.map(g => ({ m: g.machines, op: g.operators, ass: g.assistants, fork: 0 })),
      fixed: () => ({ emb: getSelectedOptions().reserveMills ? CONFIG.millWorkers : 0 }),
      prio: () => priorities, mode: () => machineModes
    },
    E: { // DEDUZIDO da aba CONFIG da planilha — confirmar
      sector: "EXTRUSÃO", mk: "EXT",
      roles: {
        op: /^operador de extrusao/, ass: /^assistente de extrusao/,
        fork: /empilhadeira/, lead: /operador lider de extrusao/
      },
      ids: () => EXT_IDS,
      pk: () => 0,
      groups: () => [
        { m: [1], op: 1, ass: 0, fork: 0 },
        { m: [2], op: 1, ass: 0, fork: 0 },
        { m: [3, 4], op: 1, ass: 1, fork: 1 }
      ],
      fixed: () => ({ ass: 1, fork: 1 }), // densificadora + empilhadeira
      prio: () => extPrio, mode: () => extMode
    }
  };
  const RL = { emb: "embalador", op: "operador", ass: "assistente", fork: "empilhadeira" };

  /* ---------- Motor de alocação ---------- */
  function runSim(team, sc) {
    const C = CFG[sc], opt = getSelectedOptions();
    const staff = getEmployees(team, C.sector).filter(isCountedInHeadcount);
    const people = [], pool = {}, have = {};
    for (const r in C.roles) {
      const all = staff.filter(e => C.roles[r].test(normalize(e.cargo)));
      all.forEach(e => people.push({ e, r, on: isDisponivelHoje(e) }));
      pool[r] = all.filter(isDisponivelHoje);
      have[r] = pool[r].length;
    }
    let lead = opt.leaderBackup ? pool.lead[0] || null : null;
    const used = new Set();
    const take = (r, n) => { const a = (pool[r] || []).splice(0, n); a.forEach(p => used.add(p.nome)); return a; };

    const fx = C.fixed(), fixedCrew = {}, short = {};
    for (const r in fx) {
      fixedCrew[r] = take(r, fx[r]);
      if (fixedCrew[r].length < fx[r]) short[r] = fx[r] - fixedCrew[r].length;
    }

    const groups = C.groups(), gCrew = {}, prio = C.prio(), mode = C.mode(), res = {};
    const order = [...C.ids()].sort((a, b) =>
      ((mode[a] === "on" ? 0 : 1) - (mode[b] === "on" ? 0 : 1)) || prio[a] - prio[b]);

    for (const id of order) {
      const m = res[id] = { id, name: `${C.mk} ${id}`, mode: mode[id], running: false, reason: "" };
      if (mode[id] === "off") { m.reason = "Parada definida manualmente"; continue; }

      const gi = groups.findIndex(g => g.m.includes(id)), g = groups[gi];
      const need = { emb: C.pk(id) };
      if (!gCrew[gi]) ["op", "ass", "fork"].forEach(r => { if (g[r]) need[r] = g[r]; });

      const miss = []; let cover = null;
      for (const r in need) {
        const d = need[r] - (pool[r] || []).length;
        if (d <= 0) continue;
        if (d === 1 && (r === "op" || r === "ass") && lead && !cover) cover = r; // líder cobre 1 vaga
        else miss.push(`${d} ${RL[r]}(es)`);
      }
      if (miss.length) { m.reason = "Faltam " + miss.join(" + "); continue; }

      // Só aqui os recursos são consumidos (alocação atômica)
      gCrew[gi] = gCrew[gi] || {};
      m.emb = [];
      for (const r in need) { const a = take(r, need[r]); if (r === "emb") m.emb = a; else gCrew[gi][r] = a; }
      if (cover) { gCrew[gi][cover].push(lead); used.add(lead.nome); lead = null; }
      Object.assign(m, { running: true, reason: "Mão de obra disponível", group: gCrew[gi] });
    }

    const need = { emb: 0, op: 0, ass: 0, fork: 0 };
    Object.entries(fx).forEach(([r, n]) => need[r] += n);
    groups.forEach(g => {
      const ms = g.m.filter(i => mode[i] !== "off");
      if (!ms.length) return;
      ["op", "ass", "fork"].forEach(r => need[r] += g[r] || 0);
      ms.forEach(i => need.emb += C.pk(i));
    });

    const machines = C.ids().map(i => res[i]);
    return {
      team, sc, C, machines, total: machines.length, run: machines.filter(m => m.running).length,
      need, have, short, fixedCrew, used, people, left: pool,
      leadAvail: have.lead || 0, leadUsed: Boolean(opt.leaderBackup && have.lead && !lead)
    };
  }
  window.simulateTeam = (team = selectedTeam) => runSim(team, "T");

  /* ---------- Helpers de tela ---------- */
  const shortName = n => escapeHtml(String(n).split(" ").slice(0, 2).join(" "));
  const names = a => (a || []).map(p => shortName(p.nome) + (/lider/.test(normalize(p.cargo)) ? " ⭐" : "")).join(", ") || "—";
  const saldo = (h, n) => `${h - n >= 0 ? "+" : ""}${h - n}`;

  const crewHtml = m => {
    const g = m.group || {};
    const rows = [["op", "Op."], ["ass", "Ass."], ["fork", "Emp."]]
      .filter(([k]) => g[k]).map(([k, l]) => `<small class="tf-crew"><b>${l}</b> ${names(g[k])}</small>`);
    if (m.emb?.length) rows.push(`<small class="tf-crew"><b>Emb.</b> ${names(m.emb)}</small>`);
    return rows.join("");
  };

  const nextMode = m => (m === "auto" ? "on" : m === "on" ? "off" : "auto");

  /* Painel: fila de prioridade (esquerda) + layout verde/vermelho (direita) */
  function machinePanel(r, sc) {
    const list = sortedByPriority(r), isT = sc === "T";
    const btn = (act, m, txt, title, cls = "", dis = false) =>
      `<button type="button" class="q-btn ${cls}" data-act="${act}" data-sc="${sc}" data-id="${m.id}" title="${title}" ${dis ? "disabled" : ""}>${txt}</button>`;
    const rows = list.map((m, i) => `
      <div class="q-row ${m.running ? "ok" : "no"}">
        <span class="q-rank">${i + 1}</span>
        <div class="q-main"><b>${m.name}</b> ${m.running ? "🟢" : "🔴"}<small>${escapeHtml(m.reason)}</small></div>
        ${isT ? `<select class="packers-select q-pk" data-packers="${m.id}" title="Embaladores necessários">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(machinePackers[m.id]) === n ? "selected" : ""}>${n} emb.</option>`).join("")}</select>` : ""}
        ${btn("up", m, "▲", "Subir prioridade", "", i === 0)}
        ${btn("down", m, "▼", "Descer prioridade", "", i === list.length - 1)}
        ${btn("pin", m, "📌", "Liberar para operar (passa na frente)", m.mode === "on" ? "is-on" : "")}
        ${btn("stop", m, "⛔", "Parada manual", m.mode === "off" ? "is-off" : "")}
      </div>`).join("");
    const tiles = r.C.ids().map(id => r.machines.find(x => x.id === id)).map(m => `
      <div class="tile ${m.running ? "ok" : "no"}" data-act="cycle" data-sc="${sc}" data-id="${m.id}" title="Clique: automático → liberar → parar">
        <div class="tile-h"><b>${m.name}</b><span>${m.mode === "on" ? "📌 " : m.mode === "off" ? "⛔ " : ""}${m.running ? "🟢" : "🔴"}</span></div>
        ${m.running ? crewHtml(m) : `<small class="tile-reason">${escapeHtml(m.reason)}</small>`}
      </div>`).join("");
    return `<div class="sim-wrap">
      <section class="sim-queue">
        <h4 class="chip-title" style="margin-top:0">Fila de prioridade</h4>${rows}
        <button type="button" class="btn btn-outline btn-sm q-opt" data-act="optimize" data-sc="${sc}">⚡ Maximizar máquinas rodando</button>
      </section>
      <section class="sim-tiles">
        <h4 class="chip-title" style="margin-top:0">Layout — ${r.C.sector} · Equipe ${r.team}</h4>
        <div class="tile-grid">${tiles}</div>
        <small class="tile-hint">Clique na máquina: automático → 📌 liberar → ⛔ parar. 📌 passa na frente da fila; ⛔ libera as pessoas para as outras.</small>
      </section></div>`;
  }

  const sortedByPriority = r => [...r.machines].sort((a, b) => r.C.prio()[a.id] - r.C.prio()[b.id]);

  const STC = st => ({ ativo: "st-ativo", "em experiencia": "st-exp", pcd: "st-pcd", "alerta de faltas": "st-alerta",
    treinamento: "st-trein", ferias: "st-ferias", "operador lider": "st-lider" })[normalize(st)] || "st-outro";

  function peopleChips(r) {
    const legend = [["st-ativo", "Ativo"], ["st-exp", "Em experiência"], ["st-pcd", "PCD"], ["st-alerta", "Alerta de faltas"],
      ["st-trein", "Treinamento"], ["st-lider", "Líder"], ["st-ferias", "Férias / outros"]]
      .map(([c, l]) => `<span class="chip legend ${c}">${l}</span>`).join("");
    const groupsOrder = [["lead", "Operador Líder"], ["op", "Operadores"], ["ass", "Assistentes"], ["fork", "Empilhadeira"], ["emb", "Embaladores"]];
    return `<div class="legend-row">${legend}</div>` + groupsOrder.map(([k, label]) => {
      const list = r.people.filter(p => p.r === k);
      if (!list.length) return "";
      return `<h4 class="chip-title">${label} (${list.filter(p => p.on).length}/${list.length})</h4>` +
        list.map(({ e, on }) => {
          const falta = faltas.has(e.nome), locked = !on && !falta, used = r.used.has(e.nome);
          const cls = [STC(e.status), falta && "is-falta", locked && "is-locked", used && "is-used"].filter(Boolean).join(" ");
          return `<button type="button" class="chip ${cls}" ${locked ? "disabled" : ""} data-falta="${escapeHtml(e.nome)}" title="${escapeHtml(e.status)}${locked ? " (indisponível pelo status)" : " — clique para marcar falta/presença"}">${used ? "✓ " : ""}${shortName(e.nome)}${k === "lead" ? " ⭐" : ""}</button>`;
        }).join("");
    }).join("") + `<small class="chip-hint">✓ alocado · sem ✓ disponível sem posto · <s>riscado</s> falta marcada · tracejado indisponível pelo status (passe o mouse para ver o status)</small>`;
  }

  /* ---------- Renderizações (substituem as do app.js) ---------- */
  window.renderResourceSummary = function (r) {
    const box = $("#resource-summary-grid");
    if (!box) return;
    const cards = [
      ["Embaladores disponíveis", r.have.emb, `Necessário p/ rodar tudo: ${r.need.emb} · saldo ${saldo(r.have.emb, r.need.emb)}`],
      ["Operadores disponíveis", r.have.op, `Necessário: ${r.need.op} · saldo ${saldo(r.have.op, r.need.op)}`],
      ["Assistentes disponíveis", r.have.ass, `Necessário: ${r.need.ass} · saldo ${saldo(r.have.ass, r.need.ass)}`],
      ["Máquinas viáveis", `${r.run}/${r.total}`, `${r.total - r.run} máquina(s) sem condição de operar`]
    ];
    const lider = !r.leadAvail ? "indisponível" : r.leadUsed ? "em uso como backup" : "livre como backup";
    box.innerHTML = cards.map(([l, v, d]) => `
      <article class="resource-card"><span class="resource-card-label">${l}</span>
      <strong class="resource-card-value">${v}</strong><small>${d}</small></article>`).join("") + `
      <div class="redistribution-note">
        <strong>Redistribuição automática de mão de obra</strong>
        <span>Parada manual libera as pessoas da máquina para as demais, por prioridade. Máquinas “Liberadas” passam na frente, mas só rodam se houver gente. Use ▲▼ na fila de prioridade, 📌 para liberar e ⛔ para parar.</span>
        <small>Líder ${lider} · ${r.left.emb.length} embalador(es) livre(s) após a alocação${r.short.emb ? ` · faltam ${r.short.emb} para os moinhos` : ""}.</small>
      </div>
      <div class="redistribution-note people-panel">
        <strong>Pessoas do turno · clique para marcar falta/presença</strong>
        <div>${peopleChips(r)}</div>
        <small>Verde: alocado · Amarelo: disponível sem posto · Vermelho: falta marcada · Cinza: status impeditivo (não editável aqui).</small>
        <div class="people-actions">
          <button class="btn btn-outline btn-sm" id="btn-limpar-faltas" type="button">Limpar faltas (todas as equipes)</button>
          <button class="btn btn-primary btn-sm" id="btn-copiar-resumo" type="button">Copiar resumo do turno</button>
        </div>
      </div>`;
  };

  window.renderLayout = function () {
    const grid = $("#tf-grid");
    if (!grid) return;
    const r = runSim(selectedTeam, "T");
    grid.innerHTML = machinePanel(r, "T");
    renderResourceSummary(r);
    renderExtrusaoLayout();
    $$("#team-pills .pill").forEach(p => {
      const t = p.dataset.team, a = runSim(t, "T"), b = runSim(t, "E");
      p.innerHTML = `Equipe ${t}<small>TF ${a.run}/${a.total} · EXT ${b.run}/${b.total}</small>`;
    });
  };

  window.renderExtrusaoLayout = function () {
    const grid = $("#ext-grid");
    if (!grid) return;
    const sector = getSetor(selectedTeam, "EXTRUSÃO");
    const emps = sector?.colaboradores || [];
    const r = runSim(selectedTeam, "E");
    if ($("#ext-team-label")) $("#ext-team-label").textContent = `Equipe ${selectedTeam}`;
    if ($("#ext-gestor-label")) $("#ext-gestor-label").textContent = sector?.gestor || "Gestor não informado";
    if ($("#ext-status-badge")) $("#ext-status-badge").textContent =
      `${emps.filter(isDisponivelHoje).length} disponíveis de ${emps.filter(isCountedInHeadcount).length} · ${r.run}/${r.total} extrusoras`;

    let box = $("#ext-sim");
    if (!box) { box = document.createElement("div"); box.id = "ext-sim"; grid.before(box); }
    const fixedTxt = `Densificadora: ${names(r.fixedCrew.ass)} · Empilhadeira fixa: ${names(r.fixedCrew.fork)}` +
      (Object.keys(r.short).length ? ` · <b>faltam ${Object.entries(r.short).map(([k, n]) => `${n} ${RL[k]}`).join(", ")}</b>` : "");
    box.innerHTML = `
      ${machinePanel(r, "E")}
      <p class="ext-note">${fixedTxt}. Regras da Extrusão deduzidas da planilha (EXT 1 e 2: 1 operador; EXT 3/4: 1 operador + 1 assistente + 1 empilhadeira).</p>
      <h4 class="chip-title">Pessoas (clique para marcar falta/presença)</h4>${peopleChips(r)}`;

    grid.innerHTML = emps.length ? emps.map(e => `
      <article class="employee-mini-card ${faltas.has(e.nome) ? "is-falta" : ""}">
        <div class="employee-mini-main"><strong>${escapeHtml(e.nome || "Vaga sem preenchimento")}</strong><small>${escapeHtml(e.cargo)}</small></div>
        <span class="employee-status ${statusClass(e.status)}">${escapeHtml(faltas.has(e.nome) ? "Falta hoje" : e.status)}</span>
      </article>`).join("") : `<p class="empty-state">Não há colaboradores cadastrados para Extrusão nesta equipe.</p>`;
  };

  /* ---------- Ações ---------- */
  const refresh = () => { saveMachineSettings(); renderAll(); };

  function move(sc, id, d) {
    const p = CFG[sc].prio(), ids = [...CFG[sc].ids()].sort((a, b) => p[a] - p[b]);
    const i = ids.indexOf(id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    ids.forEach((x, k) => p[x] = k + 1);
  }

  // Testa todos os conjuntos de máquinas e coloca no topo da fila o maior conjunto que roda ao mesmo tempo
  function optimize(sc) {
    const C = CFG[sc], ids = C.ids(), mode = C.mode(), p = C.prio(), saved = { ...mode };
    const cand = ids.filter(i => saved[i] !== "off");
    let best = [], bestScore = -1;
    for (let mask = 1; mask < (1 << cand.length); mask++) {
      const sel = cand.filter((_, k) => (mask >> k) & 1);
      if (sel.length < best.length) continue;
      ids.forEach(i => mode[i] = sel.includes(i) ? "on" : "off");
      if (runSim(selectedTeam, sc).run === sel.length) {
        const score = sel.length * 1000 - sel.reduce((a, i) => a + p[i], 0);
        if (score > bestScore) { best = sel; bestScore = score; }
      }
    }
    Object.assign(mode, saved);
    const cur = [...ids].sort((a, b) => p[a] - p[b]);
    [...cur.filter(i => best.includes(i)), ...cur.filter(i => !best.includes(i))].forEach((i, k) => p[i] = k + 1);
  }

  function resumoTexto() {
    const list = r => r.machines.filter(m => m.running).map(m => m.name).join(", ") || "nenhuma";
    return `Resumo de mão de obra · ${$("#data-conferencia")?.textContent || ""}\n` + CONFIG.teams.map(t => {
      const a = runSim(t, "T"), b = runSim(t, "E");
      return `Equipe ${t}: TF ${a.run}/${a.total} (${list(a)}) · EXT ${b.run}/${b.total} (${list(b)})`;
    }).join("\n");
  }

  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-act]");
    if (b && !b.disabled) {
      const { act, sc } = b.dataset, id = Number(b.dataset.id), mode = CFG[sc].mode();
      if (act === "up" || act === "down") move(sc, id, act === "up" ? -1 : 1);
      else if (act === "pin") mode[id] = mode[id] === "on" ? "auto" : "on";
      else if (act === "stop") mode[id] = mode[id] === "off" ? "auto" : "off";
      else if (act === "cycle") mode[id] = nextMode(mode[id]);
      else if (act === "optimize") optimize(sc);
      return refresh();
    }
    const chip = ev.target.closest("[data-falta]");
    if (chip && !chip.disabled) {
      const n = chip.dataset.falta;
      faltas.has(n) ? faltas.delete(n) : faltas.add(n);
      return refresh();
    }
    if (ev.target.closest("#btn-limpar-faltas")) { faltas.clear(); return refresh(); }
    if (ev.target.closest("#btn-copiar-resumo")) {
      const txt = resumoTexto();
      (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
        () => alert("Resumo copiado."), () => prompt("Copie o resumo:", txt));
    }
  });

  document.addEventListener("change", ev => {
    const s = ev.target.closest(".packers-select");
    if (s) { machinePackers[Number(s.dataset.packers)] = Number(s.value); refresh(); }
  });

  // Ponte para o nuvem.js
  window.SIM = {
    faltas,
    ext: () => ({ prio: extPrio, mode: extMode }),
    setExt: (p, m) => { extPrio = { ...extPrio, ...p }; extMode = { ...extMode, ...m }; }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const chk = $("#chk-lider-backup");
    if (chk) {
      chk.checked = true;
      const s = chk.closest("label")?.querySelector("small");
      if (s) s.textContent = "O líder cobre 1 vaga de operador ou assistente por turno.";
    }
  });
})();