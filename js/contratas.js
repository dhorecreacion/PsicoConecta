// Directorio de Contratas.
// A diferencia de pacientes.js (MIBSAC), aquí NO hay reserva pública, NI
// agenda, NI ficha externa de firebase-config.js: la identidad de cada
// persona (nombre, empresa, área, cargo) viene directo de las filas
// importadas por Excel (js/importador-contratas.js), en la colección plana
// "contratas_registros" — se agrupan aquí por DNI en el cliente.
import { dbPsico, CONTRATAS_COLLECTION, CONTRATAS_CASOS_COLLECTION } from "./fb-psico.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const searchInput = document.getElementById("search-input");
const empresaFilter = document.getElementById("empresa-filter");
const contratasList = document.getElementById("contratas-list");
const statPersonas = document.getElementById("stat-personas");
const statEmpresas = document.getElementById("stat-empresas");
const statRiesgo = document.getElementById("stat-riesgo");

let registros = [];

// ---------- Utilidades ----------
function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function getInitials(fullName) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function timestampToDate(timestamp) {
  return timestamp && typeof timestamp.toDate === "function" ? timestamp.toDate() : null;
}

function formatFecha(date) {
  if (!date) return "—";
  return date.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- Carga de datos ----------
async function fetchRegistrosContratas() {
  const snap = await getDocs(collection(dbPsico, CONTRATAS_COLLECTION));
  const porDni = new Map();

  snap.forEach((d) => {
    const data = d.data();
    if (!data.dni) return;
    if (!porDni.has(data.dni)) porDni.set(data.dni, []);
    porDni.get(data.dni).push(data);
  });

  // Más reciente primero, para sacar nombre/empresa/área/riesgo del último
  // registro (por si la identidad cambió de una carga a otra).
  porDni.forEach((lista) => {
    lista.sort((a, b) => {
      const fa = timestampToDate(a.registradoEn);
      const fb = timestampToDate(b.registradoEn);
      return (fb ? fb.getTime() : 0) - (fa ? fa.getTime() : 0);
    });
  });

  return porDni;
}

async function fetchCasosCerrados() {
  const snap = await getDocs(collection(dbPsico, CONTRATAS_CASOS_COLLECTION));
  const cerrados = new Set();
  snap.forEach((d) => {
    if (d.data().cerrado) cerrados.add(d.id);
  });
  return cerrados;
}

// ---------- Armado de registros ----------
async function cargarRegistros() {
  const [registrosPorDni, casosCerrados] = await Promise.all([fetchRegistrosContratas(), fetchCasosCerrados()]);

  return Array.from(registrosPorDni.entries()).map(([dni, lista]) => {
    const ultimo = lista[0];
    const fechaUltimo = timestampToDate(ultimo.registradoEn);

    return {
      dni: dni,
      nombre: ultimo.nombre || "",
      empresa: ultimo.empresa || "",
      area: ultimo.area || "",
      cargo: ultimo.cargo || "",
      totalRegistros: lista.length,
      riesgo: !!ultimo.riesgo,
      prioridad: ultimo.prioridad || "",
      fechaUltimoRegistro: fechaUltimo,
      cerrado: casosCerrados.has(dni)
    };
  });
}

// ---------- Render (DOM APIs con textContent: los datos vienen de un Excel
// cargado a mano, nunca deben interpretarse como HTML) ----------
function crearBadge(texto, classes) {
  const span = document.createElement("span");
  span.className = "text-[11px] font-bold px-2 py-1 rounded uppercase tracking-wider " + classes;
  span.textContent = texto;
  return span;
}

function crearFilaContrata(registro) {
  const card = document.createElement("div");
  card.className =
    "group bg-surface-container-lowest border border-outline-variant rounded-xl flex overflow-hidden shadow-sm hover:shadow-md transition-shadow";

  const barra = document.createElement("div");
  barra.className = "w-2 flex-shrink-0 " + (registro.riesgo ? "bg-error" : "bg-green-500");
  card.appendChild(barra);

  const cuerpo = document.createElement("div");
  cuerpo.className = "p-4 sm:p-5 flex-1 flex flex-col md:flex-row md:items-center gap-4";
  card.appendChild(cuerpo);

  // Identidad: avatar + nombre + dni + empresa/área
  const identidad = document.createElement("div");
  identidad.className = "flex items-center gap-4 flex-1 min-w-0";
  cuerpo.appendChild(identidad);

  const avatar = document.createElement("div");
  avatar.className =
    "w-12 h-12 flex-shrink-0 rounded-full bg-secondary-fixed flex items-center justify-center text-secondary font-bold";
  avatar.textContent = registro.nombre ? getInitials(registro.nombre) : "?";
  identidad.appendChild(avatar);

  const textos = document.createElement("div");
  textos.className = "min-w-0";
  identidad.appendChild(textos);

  const nombreEl = document.createElement("h4");
  nombreEl.className = "font-headline-md text-headline-md truncate " + (registro.nombre ? "text-primary" : "text-on-surface-variant italic");
  nombreEl.textContent = registro.nombre || "Sin nombre";
  textos.appendChild(nombreEl);

  const subEl = document.createElement("p");
  subEl.className = "text-body-md text-on-surface-variant truncate";
  subEl.textContent =
    "DNI: " + registro.dni + (registro.empresa ? " · " + registro.empresa : "") + (registro.area ? " · " + registro.area : "");
  textos.appendChild(subEl);

  // Estado: badges
  const badges = document.createElement("div");
  badges.className = "flex flex-wrap items-center gap-2";
  cuerpo.appendChild(badges);

  if (registro.riesgo) badges.appendChild(crearBadge("Riesgo", "bg-error-container text-on-error-container"));
  if (registro.cerrado) badges.appendChild(crearBadge("Caso cerrado", "bg-surface-container-high text-on-surface-variant"));

  // Métricas: registros + última fecha
  const metricas = document.createElement("div");
  metricas.className = "flex gap-6 md:text-right";
  cuerpo.appendChild(metricas);

  const registrosCol = document.createElement("div");
  const registrosNum = document.createElement("p");
  registrosNum.className = "font-headline-md text-headline-md text-primary";
  registrosNum.textContent = String(registro.totalRegistros);
  const registrosLbl = document.createElement("p");
  registrosLbl.className = "text-label-md text-on-surface-variant";
  registrosLbl.textContent = "Registros";
  registrosCol.appendChild(registrosNum);
  registrosCol.appendChild(registrosLbl);
  metricas.appendChild(registrosCol);

  const fechasCol = document.createElement("div");
  const ultimaEl = document.createElement("p");
  ultimaEl.className = "text-body-md font-medium text-primary";
  ultimaEl.textContent = formatFecha(registro.fechaUltimoRegistro);
  const ultimaLbl = document.createElement("p");
  ultimaLbl.className = "text-label-md text-on-surface-variant";
  ultimaLbl.textContent = "Última atención";
  fechasCol.appendChild(ultimaEl);
  fechasCol.appendChild(ultimaLbl);
  metricas.appendChild(fechasCol);

  // Acción: cerrar/reabrir caso (no hay ficha de atención en vivo para Contratas)
  const acciones = document.createElement("div");
  acciones.className = "flex flex-col gap-2 md:items-end";
  cuerpo.appendChild(acciones);

  const casoBtn = document.createElement("button");
  casoBtn.type = "button";
  casoBtn.className =
    "w-full md:w-auto px-4 py-2 border border-outline-variant text-on-surface-variant text-label-md font-semibold rounded-lg hover:bg-surface-container-low transition-all flex items-center justify-center gap-2";
  casoBtn.innerHTML =
    '<span class="material-symbols-outlined text-[18px]">' + (registro.cerrado ? "restart_alt" : "task_alt") + "</span>";
  casoBtn.appendChild(document.createTextNode(registro.cerrado ? "Reabrir caso" : "Cerrar caso"));
  casoBtn.addEventListener("click", () => toggleCaso(registro, casoBtn));
  acciones.appendChild(casoBtn);

  return card;
}

// Cierra o reabre un caso a mano (colección "contratas_casos") — afecta a
// "Casos Activos" en indicadores-contratas.html.
async function toggleCaso(registro, boton) {
  const nuevoValor = !registro.cerrado;
  const verbo = nuevoValor ? "cerrar" : "reabrir";
  if (!window.confirm(`¿Seguro que quieres ${verbo} el caso de ${registro.nombre || "DNI " + registro.dni}?`)) return;

  boton.disabled = true;
  try {
    await setDoc(
      doc(dbPsico, CONTRATAS_CASOS_COLLECTION, registro.dni),
      { cerrado: nuevoValor, actualizadoEn: serverTimestamp() },
      { merge: true }
    );
    registro.cerrado = nuevoValor;
    renderLista();
  } catch (err) {
    console.error("Error al actualizar el estado del caso:", err);
    alert("No se pudo guardar el cambio.");
    boton.disabled = false;
  }
}

function renderLista() {
  const texto = normalizar(searchInput.value.trim());
  const empresa = empresaFilter.value;

  const filtrados = registros.filter((r) => {
    const coincideTexto = !texto || normalizar(r.dni).includes(texto) || normalizar(r.nombre).includes(texto);
    const coincideEmpresa = !empresa || r.empresa === empresa;
    return coincideTexto && coincideEmpresa;
  });

  contratasList.innerHTML = "";

  if (filtrados.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "text-body-md text-on-surface-variant p-4";
    vacio.textContent = registros.length === 0 ? "Todavía no hay contratas registradas." : "Sin resultados para esta búsqueda.";
    contratasList.appendChild(vacio);
    return;
  }

  filtrados.forEach((registro) => contratasList.appendChild(crearFilaContrata(registro)));
}

function renderStats() {
  statPersonas.textContent = String(registros.length);
  statEmpresas.textContent = String(new Set(registros.map((r) => r.empresa).filter(Boolean)).size);
  statRiesgo.textContent = String(registros.filter((r) => r.riesgo).length);
}

function poblarFiltroEmpresas() {
  while (empresaFilter.options.length > 1) empresaFilter.remove(1);

  const empresas = Array.from(new Set(registros.map((r) => r.empresa).filter(Boolean))).sort();
  empresas.forEach((empresa) => {
    const option = document.createElement("option");
    option.value = empresa;
    option.textContent = empresa;
    empresaFilter.appendChild(option);
  });
}

// ---------- Inicio ----------
async function inicializar() {
  try {
    registros = await cargarRegistros();
    registros.sort(
      (a, b) => (b.fechaUltimoRegistro ? b.fechaUltimoRegistro.getTime() : 0) - (a.fechaUltimoRegistro ? a.fechaUltimoRegistro.getTime() : 0)
    );
    renderStats();
    poblarFiltroEmpresas();
    renderLista();
  } catch (err) {
    console.error("Error al cargar el directorio de contratas:", err);
    contratasList.innerHTML = "";
    const errorEl = document.createElement("p");
    errorEl.className = "text-body-md text-error p-4";
    errorEl.textContent = "No se pudo cargar el directorio de contratas.";
    contratasList.appendChild(errorEl);
  }
}

searchInput.addEventListener("input", renderLista);
empresaFilter.addEventListener("change", renderLista);

// js/importador-contratas.js avisa cuando termina para recargar sin refrescar.
window.addEventListener("contratas-importado", inicializar);

inicializar();
