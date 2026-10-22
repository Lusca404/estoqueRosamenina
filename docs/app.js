import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit, doc, updateDoc, deleteDoc, runTransaction, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (s) => document.querySelector(s);
const brl = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ADMIN_EMAIL = "lojarosameninabelem@gmail.com";
let isAdmin = false;
let produtos = [];
let vendasCache = [];
let editId = null;
let fotoAtual = "";
const ICONE_FOTO = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>';
const thumb = (src, cls = "") => `<div class="thumb ${cls}">${src ? `<img src="${src}" alt="">` : ICONE_FOTO}</div>`;
let unsubs = [];

function aviso(msg, erro = false) {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = "aviso" + (erro ? " erro-aviso" : "");
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.hidden = true), 3200);
}

// Preço aplicado conforme a forma de pagamento (produtos antigos sem valor no crédito usam o preço normal)
const precoVenda = (p, pag) => (pag === "Crédito" && p.precoCredito != null ? p.precoCredito : p.preco);
const pagamentoAtual = () => document.querySelector('input[name="pag"]:checked')?.value;

const nomeUsuario = (u) => u.displayName || u.email.split("@")[0];

/* ---------- Login ---------- */
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-erro").hidden = true;
  try {
    await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#senha").value);
  } catch {
    $("#login-erro").textContent = "E-mail ou senha incorretos. Confira e tente de novo.";
    $("#login-erro").hidden = false;
  }
});
$("#sair").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  unsubs.forEach((u) => u());
  unsubs = [];
  $("#login").hidden = !!user;
  $("#app").hidden = !user;
  isAdmin = !!user && user.email?.toLowerCase() === ADMIN_EMAIL;
  document.body.classList.toggle("admin", isAdmin);
  produtos = [];
  vendasCache = [];
  if (!user) return;
  $("#usuario-nome").textContent = nomeUsuario(user);
  $("#ola-nome").textContent = nomeUsuario(user);
  ir("home");
  unsubs.push(
    onSnapshot(query(collection(db, "produtos"), orderBy("nome")), (snap) => {
      produtos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderProdutos();
      renderSelect();
      renderVendas(vendasCache);
    }));
  if (isAdmin) unsubs.push(
    onSnapshot(query(collection(db, "vendas"), orderBy("data", "desc"), limit(100)), (snap) => {
      vendasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderVendas(vendasCache);
    })
  );
});

/* ---------- Navegação ---------- */
function ir(nome) {
  if (nome === "historico" && !isAdmin) nome = "home";
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== "aba-" + nome));
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ir]");
  if (b) ir(b.dataset.ir);
});

/* ---------- Produtos ---------- */
// Reduz a foto no navegador e guarda como texto no Firestore (não precisa do Firebase Storage, que é pago)
function reduzirImagem(file, max = 480) {
  return new Promise((ok, erro) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = erro;
    img.src = url;
  });
}
function setFoto(src) {
  fotoAtual = src;
  $("#p-preview").innerHTML = src ? `<img src="${src}" alt="">` : ICONE_FOTO;
  $("#p-foto-rm").hidden = !src;
}
$("#p-foto").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { setFoto(await reduzirImagem(f)); } catch { aviso("Não foi possível ler essa imagem.", true); }
  e.target.value = "";
});
$("#p-foto-rm").addEventListener("click", () => setFoto(""));

function resetForm() {
  editId = null;
  $("#produto-form").reset();
  setFoto("");
  $("#l-qtd").hidden = false;
  $("#p-qtd").required = true;
  $("#form-titulo").textContent = "Novo produto";
  $("#p-salvar").textContent = "Adicionar produto";
  $("#p-cancelar").hidden = true;
}
function editar(id) {
  const p = produtos.find((x) => x.id === id);
  if (!p) return;
  editId = id;
  $("#p-nome").value = p.nome;
  $("#p-preco").value = p.preco;
  $("#p-credito").value = p.precoCredito ?? p.preco;
  $("#p-qtd").value = p.qtd;
  $("#p-desc").value = p.descricao || "";
  setFoto(p.foto || "");
  $("#l-qtd").hidden = !isAdmin;
  $("#p-qtd").required = isAdmin;
  $("#form-titulo").textContent = "Editar produto";
  $("#p-salvar").textContent = "Salvar alterações";
  $("#p-cancelar").hidden = false;
  $("#produto-form").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("#p-cancelar").addEventListener("click", resetForm);

$("#produto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = {
    nome: $("#p-nome").value.trim(),
    preco: parseFloat($("#p-preco").value),
    precoCredito: parseFloat($("#p-credito").value),
    descricao: $("#p-desc").value.trim(),
    foto: fotoAtual,
  };
  // quem não é administradora não altera a quantidade de um produto já cadastrado
  if (!editId || isAdmin) dados.qtd = parseInt($("#p-qtd").value, 10);
  try {
    if (editId) await updateDoc(doc(db, "produtos", editId), dados);
    else await addDoc(collection(db, "produtos"), dados);
    aviso(editId ? "Produto atualizado." : "Produto adicionado.");
    resetForm();
  } catch { aviso("Não foi possível salvar o produto. A foto pode estar grande demais.", true); }
});

$("#busca").addEventListener("input", renderProdutos);

function renderResumo() {
  if (!isAdmin) return;
  const baixo = produtos.filter((p) => p.qtd > 0 && p.qtd <= 3).length;
  const zero = produtos.filter((p) => p.qtd <= 0).length;
  $("#r-total").textContent = produtos.length;
  $("#r-pecas").textContent = produtos.reduce((s, p) => s + p.qtd, 0);
  $("#r-valor").textContent = brl(produtos.reduce((s, p) => s + p.qtd * p.preco, 0));
  $("#r-baixo").textContent = baixo;
  $("#r-zero").textContent = zero;
  $("#r-baixo").classList.toggle("alerta", baixo > 0);
  $("#r-zero").classList.toggle("alerta", zero > 0);
}

function renderProdutos() {
  renderResumo();
  $("#info-produtos").textContent = !isAdmin ? "Cadastrar e editar produtos" : produtos.length ? `${produtos.length} cadastrados · ${produtos.reduce((s, p) => s + p.qtd, 0)} peças em estoque` : "Cadastrar e controlar o estoque";
  const termo = $("#busca").value.toLowerCase();
  const lista = produtos.filter((p) => p.nome.toLowerCase().includes(termo));
  $("#lista-produtos").innerHTML = lista.length
    ? lista.map((p) => `
      <div class="item">
        <div class="prod">${thumb(p.foto)}
          <div><b>${esc(p.nome)}</b><small>${brl(p.preco)} · no crédito ${brl(p.precoCredito ?? p.preco)}</small>${p.descricao ? `<span class="desc">${esc(p.descricao)}</span>` : ""}</div>
        </div>
        <div class="acoes">
          ${isAdmin ? `<button class="mini" data-ajuste="-1" data-id="${p.id}" aria-label="Diminuir estoque">−</button>
          <span class="qtd ${p.qtd <= 3 ? "baixo" : ""}">${p.qtd}</span>
          <button class="mini" data-ajuste="1" data-id="${p.id}" aria-label="Aumentar estoque">+</button>` : ""}
          <button class="mini ed" data-edit="${p.id}">Editar</button>
          ${isAdmin ? `<button class="mini del" data-del="${p.id}">Excluir</button>` : ""}
        </div>
      </div>`).join("")
    : `<p class="vazio">Nenhum produto por aqui. Adicione o primeiro acima.</p>`;
}

$("#lista-produtos").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (!isAdmin && (b.dataset.ajuste || b.dataset.del)) return;
  try {
    if (b.dataset.edit) {
      editar(b.dataset.edit);
    } else if (b.dataset.ajuste) {
      const p = produtos.find((x) => x.id === b.dataset.id);
      if (p.qtd + Number(b.dataset.ajuste) < 0) return;
      await updateDoc(doc(db, "produtos", b.dataset.id), { qtd: increment(Number(b.dataset.ajuste)) });
    } else if (b.dataset.del && confirm("Excluir este produto?")) {
      await deleteDoc(doc(db, "produtos", b.dataset.del));
      if (editId === b.dataset.del) resetForm();
    }
  } catch { aviso("Não foi possível atualizar o produto.", true); }
});

/* ---------- Venda ---------- */
function renderSelect() {
  const atual = $("#v-produto").value;
  $("#v-produto").innerHTML =
    `<option value="" disabled ${atual ? "" : "selected"}>Escolha um produto</option>` +
    produtos.map((p) => `<option value="${p.id}" ${p.qtd < 1 ? "disabled" : ""} ${p.id === atual ? "selected" : ""}>${esc(p.nome)} — ${brl(p.preco)} ${isAdmin ? ` (${p.qtd} em estoque)` : p.qtd < 1 ? " (esgotado)" : ""}</option>`).join("");
  atualizaTotal();
}
function atualizaTotal() {
  const p = produtos.find((x) => x.id === $("#v-produto").value);
  $("#v-prod-info").hidden = !p;
  if (p) $("#v-prod-info").innerHTML = `${thumb(p.foto)}<div><b>${esc(p.nome)}</b><small class="muted">${esc(p.descricao || "Sem descrição")}</small></div>`;
  $("#v-total").value = p ? brl(precoVenda(p, pagamentoAtual()) * (parseInt($("#v-qtd").value, 10) || 0)) : "";
}
$("#v-produto").addEventListener("change", atualizaTotal);
$("#v-qtd").addEventListener("input", atualizaTotal);
$("#v-pagamento").addEventListener("change", atualizaTotal);

$("#venda-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  const pid = $("#v-produto").value;
  const qtd = parseInt($("#v-qtd").value, 10);
  const pagamento = document.querySelector('input[name="pag"]:checked').value;
  const unidade = document.querySelector('input[name="unid"]:checked').value;
  if (!pid || qtd < 1) return aviso("Escolha o produto e a quantidade.", true);

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "produtos", pid);
      const snap = await tx.get(ref);
      const p = snap.data();
      if (!p || p.qtd < qtd) throw new Error("estoque");
      tx.update(ref, { qtd: p.qtd - qtd });
      tx.set(doc(collection(db, "vendas")), {
        produtoId: pid, produto: p.nome, precoUnit: precoVenda(p, pagamento), qtd,
        total: precoVenda(p, pagamento) * qtd, pagamento, unidade,
        status: pagamento === "Pagamento tardio" ? "pendente" : "pago",
        obs: $("#v-obs").value.trim(),
        vendedor: nomeUsuario(user), vendedorEmail: user.email, vendedorUid: user.uid,
        data: serverTimestamp(),
      });
    });
    e.target.reset();
    $("#v-qtd").value = 1;
    aviso("Venda registrada.");
  } catch (err) {
    aviso(err.message === "estoque" ? "Estoque insuficiente para essa quantidade." : "Não foi possível registrar a venda.", true);
  }
});

/* ---------- Histórico ---------- */
function renderVendas(vendas) {
  const pend = vendas.filter((v) => v.status === "pendente").length;
  $("#info-vendas").textContent = pend ? `${pend} ${pend === 1 ? "pagamento a receber" : "pagamentos a receber"}` : "Ver quem vendeu, como e onde";
  $("#lista-vendas").innerHTML = vendas.length
    ? vendas.map((v) => {
      const d = v.data?.toDate ? v.data.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "agora";
      return `
      <div class="item">
        <div class="prod">${thumb(produtos.find((x) => x.id === v.produtoId)?.foto)}<div>
          <b>${esc(v.produto)} × ${v.qtd}</b>
          <small>${d} · por ${esc(v.vendedor)}</small><br>
          <span class="tag">${esc(v.pagamento)}</span><span class="tag">${esc(v.unidade)}</span>
          <span class="tag ${v.status === "pendente" ? "pend" : "pago"}">${v.status === "pendente" ? "A receber" : "Pago"}</span>
          ${v.obs ? `<br><small>${esc(v.obs)}</small>` : ""}
        </div></div>
        <div class="acoes">
          <span class="valor">${brl(v.total)}</span>
          ${v.status === "pendente" ? `<button class="mini del" style="color:var(--ok)" data-receber="${v.id}">Marcar como pago</button>` : ""}
        </div>
      </div>`;
    }).join("")
    : `<p class="vazio">Nenhuma venda registrada ainda.</p>`;
}

$("#lista-vendas").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-receber]");
  if (!b) return;
  try {
    await updateDoc(doc(db, "vendas", b.dataset.receber), { status: "pago" });
    aviso("Pagamento confirmado.");
  } catch { aviso("Não foi possível atualizar a venda.", true); }
});
