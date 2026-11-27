/* ============================================================
   nuvem.js — liga o simulador ao Supabase
   Carregar DEPOIS do app.js e do melhorias.js.
   Faz: login (@ajover.com), carrega equipes do banco,
   compartilha faltas do dia, prioridades/modos entre todos
   (tempo real) e grava no banco: adicionar, editar e excluir
   colaboradores e salvar setores.
   ============================================================ */
"use strict";
const SUPABASE_URL = "https://igxhrsiqrgveqxxcytuf.supabase.co";
const SUPABASE_KEY = "sb_publishable_jz5XQpPvFUI42P-lxVWEyQ_zjLuS8g_";        // chave PUBLISHABLE (pode ficar no site)

(() => {
  window.CLOUD = true; // avisa o melhorias.js para não usar as faltas locais
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const hoje = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
  let remoto = new Set();
  const cfg = {};

  /* ---------- Login ---------- */
  async function garantirLogin() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const email = (session.user?.email || "").toLowerCase();
      if (!email.endsWith("@ajover.com")) {
        await sb.auth.signOut();
        alert("Acesso restrito a e-mails @ajover.com");
        location.reload();
        return;
      }
      return;
    }

    await new Promise(ok => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:rgba(5,28,47,.78)";
      d.innerHTML = `
        <form style="background:#fff;padding:26px;border-radius:14px;display:grid;gap:10px;width:min(340px,90vw)">
          <b style="font-size:16px;color:#173b59">Entrar · Gestão de Mão de Obra</b>
          <input name="e" type="email" placeholder="E-mail @ajover.com" required
                 style="padding:10px;border:1px solid #d4dfe7;border-radius:8px">
          <input name="s" type="password" placeholder="Senha" required
                 style="padding:10px;border:1px solid #d4dfe7;border-radius:8px">
          <small class="err" style="color:#a23d3d"></small>
          <button class="btn btn-primary">Entrar</button>
        </form>`;
      document.body.append(d);

      d.querySelector("form").onsubmit = async ev => {
        ev.preventDefault();
        const f = ev.target;
        const email = f.e.value.trim().toLowerCase();

        if (!email.endsWith("@ajover.com")) {
          d.querySelector(".err").textContent = "Use um e-mail @ajover.com.";
          return;
        }

        const r = await sb.auth.signInWithPassword({ email, password: f.s.value });
        if (r.error) {
          d.querySelector(".err").textContent = "E-mail ou senha inválidos.";
          return;
        }
        d.remove();
        ok();
      };
    });
  }

  /* ---------- Leitura ---------- */
  async function carregarFaltas() {
    const r = await sb.from("faltas").select("nome").eq("data", hoje());
    if (r.error) return console.warn(r.error);
    remoto = new Set(r.data.map(x => x.nome));
    SIM.faltas.clear();
    remoto.forEach(n => SIM.faltas.add(n));
  }
  async function carregarConfig() {
    const r = await sb.from("config_sim").select("*");
    if (r.error) return console.warn(r.error);
    r.data.forEach(x => cfg[`${x.equipe}|${x.setor}`] = x);
  }

  // Lê setores e colaboradores do banco e monta o mesmo formato do dados.json
  async function buscarDados() {
    const [s, c] = await Promise.all([
      sb.from("setores").select("*"),
      sb.from("colaboradores").select("*").order("id")
    ]);
    if (s.error || c.error) throw (s.error || c.error);
    const eq = {};
    s.data.forEach(r => (eq[r.equipe] ??= { equipe: r.equipe, setores: [] }).setores.push(
      { setor: r.setor, gestor: r.gestor, meta: r.meta, total_turno: r.total_turno, colaboradores: [] }));
    c.data.forEach(r => eq[r.equipe]?.setores.find(x => x.setor === r.setor)?.colaboradores.push(
      { id: r.id, numero: r.numero, cargo: r.cargo, nome: r.nome, status: r.status, admissao: r.admissao || "", dt_saida: r.dt_saida || "", observacoes: r.observacoes || "" }));
    return { data_conferencia: new Date().toLocaleDateString("pt-BR"), equipes: Object.values(eq).sort((a, b) => a.equipe.localeCompare(b.equipe)) };
  }

  // Substitui o fetch do dados.json
  window.loadData = async function () {
    await garantirLogin();
    const dados = await buscarDados();
    await Promise.all([carregarFaltas(), carregarConfig()]);
    return dados;
  };

  // Recarrega o cadastro do banco e redesenha a tela
  async function recarregar() {
    if (!appData) return;
    try {
      appData = await buscarDados();
      renderAll();
    } catch (e) { console.warn("Não foi possível atualizar o cadastro.", e); }
  }

  // Depois do carregamento local, aplica a configuração compartilhada da equipe
  const baseLoad = window.loadMachineSettings;
  window.loadMachineSettings = function () {
    baseLoad();
    const t = cfg[`${selectedTeam}|T`], e = cfg[`${selectedTeam}|E`];
    if (t) {
      priorities = { ...priorities, ...t.prioridades };
      machineModes = { ...machineModes, ...t.modos };
      machinePackers = { ...machinePackers, ...t.embaladores };
    }
    if (e) SIM.setExt(e.prioridades, e.modos);
  };

  /* ---------- Escrita das faltas e prioridades (chamada pelo melhorias.js) ---------- */
  window.onSimSave = async () => {
    const atual = new Set(SIM.faltas);
    const add = [...atual].filter(n => !remoto.has(n)), del = [...remoto].filter(n => !atual.has(n));
    remoto = atual;
    if (add.length) await sb.from("faltas").upsert(add.map(nome => ({ data: hoje(), equipe: selectedTeam, nome })));
    if (del.length) await sb.from("faltas").delete().eq("data", hoje()).in("nome", del);
    const x = SIM.ext();
    await sb.from("config_sim").upsert([
      { equipe: selectedTeam, setor: "T", prioridades: priorities, modos: machineModes, embaladores: machinePackers },
      { equipe: selectedTeam, setor: "E", prioridades: x.prio, modos: x.mode }
    ]);
  };

  /* ============================================================
     GESTÃO DE EQUIPES -> BANCO
     ============================================================ */
  let editId = null; // id do colaborador que está sendo editado (null = novo)

  function acharPorId(id) {
    for (const s of getTeam()?.setores || []) {
      const emp = s.colaboradores.find(c => c.id === id);
      if (emp) return { emp, setor: s };
    }
    return null;
  }

  // Envolve o openAddModal: guarda o id e corrige o botão "+ Adicionar"
  // (o app.js original passa o evento do clique como se fosse um colaborador)
  const baseOpen = window.openAddModal;
  window.openAddModal = function (emp = null, si = null, ei = null) {
    if (emp instanceof Event) emp = null;
    baseOpen(emp, si, ei);
    editId = emp?.id ?? null;
  };

  // Substitui o salvar do formulário: grava no banco e recarrega
  window.addEmployeeFromForm = async function (ev) {
    ev.preventDefault();
    const botao = ev.currentTarget.querySelector('[type="submit"]');
    const team = getTeam();
    const setor = getSetor(selectedTeam, $("#new-setor")?.value);
    if (!team || !setor) { alert("Selecione um setor válido."); return; }

    const cargo = $("#new-cargo")?.value?.trim() || "";
    const nome = $("#new-nome")?.value?.trim() || "";
    if (!cargo || !nome) { alert("Preencha o cargo e o nome do colaborador."); return; }

    const antigo = editId ? acharPorId(editId) : null;
    if (editId && !antigo) { alert("Este registro foi alterado por outra pessoa. Feche e abra de novo."); return; }

    // Se a data antiga estava em outro formato e o campo de data ficou vazio, mantém a antiga
    const manter = (novo, velho) =>
      novo || (velho && !/^\d{4}-\d{2}-\d{2}$/.test(velho) ? velho : "");

    const linha = {
      equipe: team.equipe, setor: setor.setor, cargo, nome,
      status: $("#new-status")?.value || "Ativo",
      admissao: manter($("#new-admissao")?.value || "", antigo?.emp.admissao),
      dt_saida: manter($("#new-dt-saida")?.value || "", antigo?.emp.dt_saida),
      observacoes: $("#new-obs")?.value?.trim() || ""
    };
    if (!antigo || antigo.setor.setor !== setor.setor) {
      linha.numero = Math.max(0, ...setor.colaboradores.map(c => Number(c.numero) || 0)) + 1;
    }

    botao.disabled = true;
    try {
      const r = antigo
        ? await sb.from("colaboradores").update(linha).eq("id", editId).select()
        : await sb.from("colaboradores").insert(linha).select();
      if (r.error || !r.data?.length) {
        alert("Não foi possível salvar: " + (r.error?.message || "sem permissão."));
        return;
      }
      editId = null;
      closeAddModal();
      $("#form-add-colab")?.reset();
      await recarregar();
    } catch (e) {
      alert("Erro de conexão ao salvar. Tente novamente.");
      console.warn(e);
    } finally {
      botao.disabled = false;
    }
  };

  // Excluir colaborador e Salvar setor: interceptamos o clique antes do app.js
  document.addEventListener("click", async ev => {
    const del = ev.target.closest(".delete-employee");
    const sec = ev.target.closest(".save-sector-config");
    if (!del && !sec) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();

    const team = getTeam();
    if (!team) return;

    try {
      if (del) {
        const emp = team.setores[Number(del.dataset.sector)]?.colaboradores[Number(del.dataset.employee)];
        if (!emp) return;
        if (!confirm(`Excluir ${emp.nome || "este registro"} da equipe ${selectedTeam}? Esta ação não pode ser desfeita.`)) return;
        const r = await sb.from("colaboradores").delete().eq("id", emp.id).select();
        if (r.error || !r.data?.length) {
          alert("Não foi possível excluir: " + (r.error?.message || "registro não encontrado."));
          return;
        }
        await recarregar();
      } else {
        const i = Number(sec.dataset.sectorSave);
        const setor = team.setores[i];
        if (!setor) return;
        const dados = {
          gestor: $(`[data-sector-manager="${i}"]`)?.value.trim() || "",
          meta: Number($(`[data-sector-meta="${i}"]`)?.value || 0),
          total_turno: Number($(`[data-sector-shift="${i}"]`)?.value || 0)
        };
        const r = await sb.from("setores").update(dados).eq("equipe", team.equipe).eq("setor", setor.setor).select();
        if (r.error || !r.data?.length) {
          alert("Não foi possível salvar o setor: " + (r.error?.message || "registro não encontrado."));
          return;
        }
        await recarregar();
        alert("Setor salvo.");
      }
    } catch (e) {
      alert("Erro de conexão. Tente novamente.");
      console.warn(e);
    }
  }, true); // true = captura o clique antes dos botões do app.js

  /* ---------- Tempo real: o que um marca, os outros veem ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    sb.channel("sim")
      .on("postgres_changes", { event: "*", schema: "public", table: "faltas" },
        async () => { await carregarFaltas(); renderAll(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "config_sim" },
        async () => { await carregarConfig(); loadMachineSettings(); renderAll(); })
      .subscribe();

    // Cadastro: quando alguém adiciona, edita ou exclui, todos veem
    let timer;
    const agendar = () => { clearTimeout(timer); timer = setTimeout(recarregar, 400); };
    sb.channel("cadastro")
      .on("postgres_changes", { event: "*", schema: "public", table: "colaboradores" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "setores" }, agendar)
      .subscribe();
  });

  /* ---------- Botão Sair ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const btnLogout = document.getElementById("logout-btn");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        if (!confirm("Deseja realmente sair?")) return;
        await sb.auth.signOut();
        location.reload();
      });
    }
  });

  // Verifica a cada 5 minutos se a sessão ainda é válida e do domínio correto
  setInterval(async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      location.reload();
      return;
    }
    const email = session.user?.email?.toLowerCase() || "";
    if (!email.endsWith("@ajover.com")) {
      await sb.auth.signOut();
      location.reload();
    }
  }, 5 * 60 * 1000);
})();
