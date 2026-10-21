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

let produtos = [];
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
  if (!user) return;
  $("#usuario-nome").textContent = nomeUsuario(user);
  $("#ola-nome").textContent = nomeUsuario(user);
  ir("home");
  unsubs.push(
    onSnapshot(query(collection(db, "produtos"), orderBy("nome")), (snap) => {
      produtos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderProdutos();
      renderSelect();
    }),
    onSnapshot(query(collection(db, "vendas"), orderBy("data", "desc"), limit(100)), (snap) => {
      renderVendas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })
  );
});

/* ---------- Navegação ---------- */
function ir(nome) {
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== "aba-" + nome));
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ir]");
  if (b) ir(b.dataset.ir);
});

/* ---------- Produtos ---------- */
$("#produto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await addDoc(collection(db, "produtos"), {
      nome: $("#p-nome").value.trim(),
      preco: parseFloat($("#p-preco").value),
      precoCredito: parseFloat($("#p-credito").value),
      descricao: $("#p-desc").value.trim(),
      qtd: parseInt($("#p-qtd").value, 10),
    });
    e.target.reset();
    aviso("Produto adicionado.");
  } catch { aviso("Não foi possível adicionar o produto.", true); }
});

$("#busca").addEventListener("input", renderProdutos);

function renderProdutos() {
  $("#info-produtos").textContent = produtos.length ? `${produtos.length} cadastrados · ${produtos.reduce((s, p) => s + p.qtd, 0)} peças em estoque` : "Cadastrar e controlar o estoque";
  const termo = $("#busca").value.toLowerCase();
  const lista = produtos.filter((p) => p.nome.toLowerCase().includes(termo));
  $("#lista-produtos").innerHTML = lista.length
    ? lista.map((p) => `
      <div class="item">
        <div><b>${esc(p.nome)}</b><small>${brl(p.preco)} · no crédito ${brl(p.precoCredito ?? p.preco)}</small>${p.descricao ? `<span class="desc">${esc(p.descricao)}</span>` : ""}</div>
        <div class="acoes">
          <button class="mini" data-ajuste="-1" data-id="${p.id}" aria-label="Diminuir estoque">−</button>
          <span class="qtd ${p.qtd <= 3 ? "baixo" : ""}">${p.qtd}</span>
          <button class="mini" data-ajuste="1" data-id="${p.id}" aria-label="Aumentar estoque">+</button>
          <button class="mini del" data-del="${p.id}">Excluir</button>
        </div>
      </div>`).join("")
    : `<p class="vazio">Nenhum produto por aqui. Adicione o primeiro acima.</p>`;
}

$("#lista-produtos").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.ajuste) {
      const p = produtos.find((x) => x.id === b.dataset.id);
      if (p.qtd + Number(b.dataset.ajuste) < 0) return;
      await updateDoc(doc(db, "produtos", b.dataset.id), { qtd: increment(Number(b.dataset.ajuste)) });
    } else if (b.dataset.del && confirm("Excluir este produto?")) {
      await deleteDoc(doc(db, "produtos", b.dataset.del));
    }
  } catch { aviso("Não foi possível atualizar o produto.", true); }
});

/* ---------- Venda ---------- */
function renderSelect() {
  const atual = $("#v-produto").value;
  $("#v-produto").innerHTML =
    `<option value="" disabled ${atual ? "" : "selected"}>Escolha um produto</option>` +
    produtos.map((p) => `<option value="${p.id}" ${p.qtd < 1 ? "disabled" : ""} ${p.id === atual ? "selected" : ""}>${esc(p.nome)} — ${brl(p.preco)} (${p.qtd} em estoque)</option>`).join("");
  atualizaTotal();
}
function atualizaTotal() {
  const p = produtos.find((x) => x.id === $("#v-produto").value);
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
        <div>
          <b>${esc(v.produto)} × ${v.qtd}</b>
          <small>${d} · por ${esc(v.vendedor)}</small><br>
          <span class="tag">${esc(v.pagamento)}</span><span class="tag">${esc(v.unidade)}</span>
          <span class="tag ${v.status === "pendente" ? "pend" : "pago"}">${v.status === "pendente" ? "A receber" : "Pago"}</span>
          ${v.obs ? `<br><small>${esc(v.obs)}</small>` : ""}
        </div>
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
