/* ============================================================
   nuvem.js — liga o simulador ao Supabase
   Carregar DEPOIS do app.js e do melhorias.js.
   Faz: login, carrega equipes do banco, compartilha faltas do dia
   e prioridades/modos entre todos (com atualização em tempo real).
   ============================================================ */
"use strict";
const SUPABASE_URL = "https://igxhrsiqrgveqxxcytuf.supabase.co";
const SUPABASE_KEY = "sb_publishable_jz5XQpPvFUI42P-lxVWEyQ_zjLuS8g_";        // <- troque (chave PUBLISHABLE)

(() => {
  window.CLOUD = true; // avisa o melhorias.js para não usar as faltas locais
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const hoje = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
  let remoto = new Set();
  const cfg = {};

  /* ---------- Login ---------- */
  async function garantirLogin() {
    if ((await sb.auth.getSession()).data.session) return;
    await new Promise(ok => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:rgba(5,28,47,.78)";
      d.innerHTML = `<form style="background:#fff;padding:26px;border-radius:14px;display:grid;gap:10px;width:min(340px,90vw)">
        <b style="font-size:16px;color:#173b59">Entrar · Gestão de Mão de Obra</b>
        <input name="e" type="email" placeholder="E-mail" required style="padding:10px;border:1px solid #d4dfe7;border-radius:8px">
        <input name="s" type="password" placeholder="Senha" required style="padding:10px;border:1px solid #d4dfe7;border-radius:8px">
        <small class="err" style="color:#a23d3d"></small><button class="btn btn-primary">Entrar</button></form>`;
      document.body.append(d);
      d.querySelector("form").onsubmit = async ev => {
        ev.preventDefault();
        const f = ev.target;
        const r = await sb.auth.signInWithPassword({ email: f.e.value, password: f.s.value });
        if (r.error) { d.querySelector(".err").textContent = "E-mail ou senha inválidos."; return; }
        d.remove(); ok();
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

  // Substitui o fetch do dados.json: monta o mesmo formato a partir do banco
  window.loadData = async function () {
    await garantirLogin();
    const [s, c] = await Promise.all([
      sb.from("setores").select("*"),
      sb.from("colaboradores").select("*").order("id")
    ]);
    if (s.error || c.error) throw (s.error || c.error);
    const eq = {};
    s.data.forEach(r => (eq[r.equipe] ??= { equipe: r.equipe, setores: [] }).setores.push(
      { setor: r.setor, gestor: r.gestor, meta: r.meta, total_turno: r.total_turno, colaboradores: [] }));
    c.data.forEach(r => eq[r.equipe]?.setores.find(x => x.setor === r.setor)?.colaboradores.push(
      { numero: r.numero, cargo: r.cargo, nome: r.nome, status: r.status, admissao: r.admissao || "", dt_saida: r.dt_saida || "", observacoes: r.observacoes || "" }));
    await Promise.all([carregarFaltas(), carregarConfig()]);
    return { data_conferencia: new Date().toLocaleDateString("pt-BR"), equipes: Object.values(eq).sort((a, b) => a.equipe.localeCompare(b.equipe)) };
  };

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

  /* ---------- Escrita (chamada pelo melhorias.js a cada alteração) ---------- */
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

  /* ---------- Tempo real: o que um marca, os outros veem ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    sb.channel("sim")
      .on("postgres_changes", { event: "*", schema: "public", table: "faltas" },
        async () => { await carregarFaltas(); renderAll(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "config_sim" },
        async () => { await carregarConfig(); loadMachineSettings(); renderAll(); })
      .subscribe();
  });
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
})();
