// Directorio de Contratas.
// A diferencia de pacientes.js (MIBSAC), aquí NO hay reserva pública, NI
// agenda, NI ficha externa de firebase-config.js: la identidad de cada
// persona (nombre, empresa, área, cargo) viene directo de las filas
// importadas por Excel (js/importador-contratas.js), en la colección plana
// "contratas_registros" — se agrupan aquí por DNI en el cliente.
import {
  dbPsico,
  CONTRATAS_COLLECTION,
  CONTRATAS_CASOS_COLLECTION,
  CONFIGURACION_COLLECTION,
  MODALIDADES,
  esCasoActivoContratas
} from "./fb-psico.js";
import { cargarAreas } from "./org-estructura.js";
import { cargarCie10 } from "./cie10.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const UMBRAL_SEGUIMIENTO_DEFAULT = 30;

// Catálogos editables de Configuración (Derivación y Acciones), reutilizados
// por el editor de atenciones (igual criterio que js/importador-contratas.js).
const DERIVACIONES_DEFAULT = ["No requerida", "Psiquiatría", "Psicologia", "Neuropsicologia"];
const ACCIONES_DEFAULT = [
  "Recomendaciones compartidas verbalmente",
  "Envío de material psicoeducativo digital",
  "Pruebas psicométricas aplicadas"
];

async function obtenerCatalogos() {
  try {
    const snap = await getDoc(doc(dbPsico, CONFIGURACION_COLLECTION, "catalogos"));
    if (snap.exists()) {
      const data = snap.data();
      return {
        derivaciones: Array.isArray(data.derivaciones) && data.derivaciones.length ? data.derivaciones : DERIVACIONES_DEFAULT,
        acciones: Array.isArray(data.acciones) && data.acciones.length ? data.acciones : ACCIONES_DEFAULT
      };
    }
  } catch (err) {
    console.warn("No se pudo cargar el catálogo; se usan las opciones por defecto:", err);
  }
  return { derivaciones: DERIVACIONES_DEFAULT, acciones: ACCIONES_DEFAULT };
}

const searchInput = document.getElementById("search-input");
const empresaFilter = document.getElementById("empresa-filter");
const contratasList = document.getElementById("contratas-list");
const statPersonas = document.getElementById("stat-personas");
const statEmpresas = document.getElementById("stat-empresas");
const statRiesgo = document.getElementById("stat-riesgo");

let registros = [];
// DNI -> lista de atenciones completas (con id de documento), más reciente
// primero — lo usa el modal de Historial/Editar; "registros" solo guarda el
// resumen por persona que pinta el directorio.
let atencionesPorDni = new Map();

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
    porDni.get(data.dni).push({ id: d.id, ...data });
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

async function fetchCasosInfo() {
  const snap = await getDocs(collection(dbPsico, CONTRATAS_CASOS_COLLECTION));
  const info = new Map();
  snap.forEach((d) => info.set(d.id, d.data()));
  return info;
}

// Mismo umbral que indicadores-contratas.js (configuracion/general): define
// tanto cuándo alertar un caso de riesgo sin atender como, para un caso
// normal, cuándo se considera cerrado por inactividad (ver
// esCasoActivoContratas en fb-psico.js).
async function fetchUmbralSeguimiento() {
  try {
    const snap = await getDoc(doc(dbPsico, CONFIGURACION_COLLECTION, "general"));
    const valor = snap.exists() ? Number(snap.data().umbralSeguimientoDias) : NaN;
    return Number.isInteger(valor) && valor > 0 ? valor : UMBRAL_SEGUIMIENTO_DEFAULT;
  } catch (err) {
    console.warn("No se pudo cargar el umbral de seguimiento; se usa el valor por defecto:", err);
    return UMBRAL_SEGUIMIENTO_DEFAULT;
  }
}

// ---------- Armado de registros ----------
async function cargarRegistros() {
  const [registrosPorDni, casosInfo, umbralSeguimientoDias] = await Promise.all([
    fetchRegistrosContratas(),
    fetchCasosInfo(),
    fetchUmbralSeguimiento()
  ]);
  atencionesPorDni = registrosPorDni;
  const ahora = new Date();

  return Array.from(registrosPorDni.entries()).map(([dni, lista]) => {
    const ultimo = lista[0];
    const fechaUltimo = timestampToDate(ultimo.registradoEn);
    const activo = esCasoActivoContratas(ultimo, casosInfo.get(dni), umbralSeguimientoDias, ahora);

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
      cerrado: !activo
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

  const historialBtn = document.createElement("button");
  historialBtn.type = "button";
  historialBtn.className =
    "w-full md:w-auto px-4 py-2 border border-outline-variant text-on-surface-variant text-label-md font-semibold rounded-lg hover:bg-surface-container-low transition-all flex items-center justify-center gap-2";
  historialBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">history</span>';
  historialBtn.appendChild(document.createTextNode("Ver historial"));
  historialBtn.addEventListener("click", () => abrirHistorial(registro));
  acciones.appendChild(historialBtn);

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
// "Casos Activos" en indicadores-contratas.html. "registro.cerrado" ya
// refleja tanto un cierre manual como uno automático por inactividad (ver
// esCasoActivoContratas en fb-psico.js), así que el botón actúa igual en
// ambos casos: al cerrar queda cerrado hasta que se reabra a mano; al
// reabrir se guarda "reabiertoEn" para reiniciar el plazo de inactividad
// (si no, un caso normal sin atención nueva volvería a cerrarse solo de
// inmediato).
async function toggleCaso(registro, boton) {
  const nuevoValor = !registro.cerrado;
  const verbo = nuevoValor ? "cerrar" : "reabrir";
  if (!window.confirm(`¿Seguro que quieres ${verbo} el caso de ${registro.nombre || "DNI " + registro.dni}?`)) return;

  boton.disabled = true;
  try {
    const datos = nuevoValor
      ? { cerrado: true, actualizadoEn: serverTimestamp() }
      : { cerrado: false, reabiertoEn: serverTimestamp(), actualizadoEn: serverTimestamp() };
    await setDoc(doc(dbPsico, CONTRATAS_CASOS_COLLECTION, registro.dni), datos, { merge: true });
    registro.cerrado = nuevoValor;
    renderLista();
  } catch (err) {
    console.error("Error al actualizar el estado del caso:", err);
    alert("No se pudo guardar el cambio.");
    boton.disabled = false;
  }
}

// ---------- Modal: Historial de atenciones ----------
const historialModal = document.getElementById("historial-modal");
const historialClose = document.getElementById("historial-close");
const historialPersona = document.getElementById("historial-persona");
const historialLista = document.getElementById("historial-lista");

function abrirHistorial(registro) {
  historialPersona.textContent = (registro.nombre || "Sin nombre") + " · DNI " + registro.dni;
  renderHistorialLista(registro.dni);
  historialModal.classList.remove("hidden");
}

function cerrarHistorial() {
  historialModal.classList.add("hidden");
}

function renderHistorialLista(dni) {
  const lista = atencionesPorDni.get(dni) || [];
  historialLista.innerHTML = "";

  if (lista.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "text-body-md text-on-surface-variant";
    vacio.textContent = "Esta persona no tiene atenciones registradas.";
    historialLista.appendChild(vacio);
    return;
  }

  lista.forEach((atencion) => {
    const fila = document.createElement("div");
    fila.className = "flex items-center justify-between gap-3 p-3 bg-surface-container-low rounded-lg border border-outline-variant/30";

    const info = document.createElement("div");
    info.className = "min-w-0";

    const fechaEl = document.createElement("p");
    fechaEl.className = "text-body-md font-semibold text-primary";
    fechaEl.textContent = formatFecha(timestampToDate(atencion.registradoEn)) + (atencion.hora ? " · " + atencion.hora : "");

    const subEl = document.createElement("p");
    subEl.className = "text-label-md text-on-surface-variant truncate";
    const modalidadLabel = atencion.modalidad && MODALIDADES[atencion.modalidad] ? MODALIDADES[atencion.modalidad].label : null;
    subEl.textContent = [atencion.area, modalidadLabel].filter(Boolean).join(" · ") || "—";

    info.appendChild(fechaEl);
    info.appendChild(subEl);

    const editarBtn = document.createElement("button");
    editarBtn.type = "button";
    editarBtn.className =
      "px-3 py-1.5 border border-outline-variant text-primary text-label-md font-semibold rounded-lg hover:bg-surface-container-lowest transition-all flex items-center gap-1 flex-shrink-0";
    editarBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">edit</span>';
    editarBtn.appendChild(document.createTextNode("Editar"));
    editarBtn.addEventListener("click", () => abrirEditar(atencion));

    fila.appendChild(info);
    fila.appendChild(editarBtn);
    historialLista.appendChild(fila);
  });
}

historialClose.addEventListener("click", cerrarHistorial);

// ---------- Modal: Editar atención (todos los campos de una fila importada) ----------
const editarModal = document.getElementById("editar-modal");
const editarClose = document.getElementById("editar-close");
const editarCancelar = document.getElementById("editar-cancelar");
const editarGuardar = document.getElementById("editar-guardar");
const editarError = document.getElementById("editar-error");
const editarDni = document.getElementById("editar-dni");
const editarNombre = document.getElementById("editar-nombre");
const editarSexo = document.getElementById("editar-sexo");
const editarEmpresa = document.getElementById("editar-empresa");
const editarArea = document.getElementById("editar-area");
const editarCargo = document.getElementById("editar-cargo");
const editarFecha = document.getElementById("editar-fecha");
const editarHora = document.getElementById("editar-hora");
const editarModalidad = document.getElementById("editar-modalidad");
const editarFrecuencia = document.getElementById("editar-frecuencia");
const editarPrioridad = document.getElementById("editar-prioridad");
const editarAptitud = document.getElementById("editar-aptitud");
const editarDerivacion = document.getElementById("editar-derivacion");
const editarRiesgo = document.getElementById("editar-riesgo");
const editarMotivo = document.getElementById("editar-motivo");
const editarObservaciones = document.getElementById("editar-observaciones");
const editarRecomendaciones = document.getElementById("editar-recomendaciones");
const editarEvolucion = document.getElementById("editar-evolucion");
const editarDiagnosticos = document.getElementById("editar-diagnosticos");
const editarResultados = document.getElementById("editar-resultados");
const editarAccionesCheckboxes = document.getElementById("editar-acciones-checkboxes");

let atencionEnEdicion = null;

// Catálogos del formulario: se cargan una sola vez (no cambian seguido).
// "area" es lista cerrada (data/org-estructura.json); "derivacion"/"acciones"
// son el catálogo editable de configuracion.html, igual que en el importador.
async function poblarCatalogosFormulario() {
  const [areas, catalogos] = await Promise.all([cargarAreas(), obtenerCatalogos()]);

  areas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    editarArea.appendChild(option);
  });

  editarDerivacion.innerHTML = "";
  catalogos.derivaciones.forEach((derivacion) => {
    const option = document.createElement("option");
    option.value = derivacion;
    option.textContent = derivacion;
    editarDerivacion.appendChild(option);
  });

  Object.entries(MODALIDADES).forEach(([clave, meta]) => {
    const option = document.createElement("option");
    option.value = clave;
    option.textContent = meta.label;
    editarModalidad.appendChild(option);
  });

  editarAccionesCheckboxes.innerHTML = "";
  catalogos.acciones.forEach((texto) => {
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 cursor-pointer group";
    const checkbox = document.createElement("input");
    checkbox.className = "w-5 h-5 rounded border-outline-variant text-secondary focus:ring-secondary";
    checkbox.type = "checkbox";
    checkbox.value = texto;
    const span = document.createElement("span");
    span.className = "text-body-md group-hover:text-primary transition-colors";
    span.textContent = texto;
    label.appendChild(checkbox);
    label.appendChild(span);
    editarAccionesCheckboxes.appendChild(label);
  });
}

function abrirEditar(atencion) {
  atencionEnEdicion = atencion;
  editarError.classList.add("hidden");

  editarDni.value = atencion.dni;
  editarNombre.value = atencion.nombre || "";
  editarSexo.value = atencion.sexo || "";
  editarEmpresa.value = atencion.empresa || "";
  editarArea.value = atencion.area || "";
  editarCargo.value = atencion.cargo || "";
  editarFecha.value = atencion.fecha || "";
  editarHora.value = atencion.hora || "";
  editarModalidad.value = atencion.modalidad || "";
  editarFrecuencia.value = atencion.frecuencia || "";
  editarPrioridad.value = atencion.prioridad || "medium";
  editarAptitud.value = atencion.aptitud || "";
  editarDerivacion.value = atencion.derivacion || "No requerida";
  editarRiesgo.checked = !!atencion.riesgo;
  editarMotivo.value = atencion.motivoConsulta || "";
  editarObservaciones.value = atencion.observaciones || "";
  editarRecomendaciones.value = atencion.recomendaciones || "";
  editarEvolucion.value = atencion.evolucion || "";
  editarDiagnosticos.value = (atencion.diagnosticos || []).map((d) => d.codigo).join("; ");
  editarResultados.value = atencion.resultadosPruebas || "";

  const accionesActuales = new Set((atencion.accionesRealizadas || []).map((a) => normalizar(a)));
  editarAccionesCheckboxes.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = accionesActuales.has(normalizar(cb.value));
  });

  editarModal.classList.remove("hidden");
}

function cerrarEditar() {
  editarModal.classList.add("hidden");
  atencionEnEdicion = null;
}

function mostrarErrorEditar(mensaje) {
  editarError.textContent = mensaje;
  editarError.classList.remove("hidden");
}

// Mismas reglas de código que js/importador-contratas.js: con o sin punto,
// el nombre se completa buscando en el catálogo local (data/cie10.json).
async function resolverDiagnosticos(codigosTexto) {
  const catalogo = await cargarCie10();
  const resultado = [];
  for (const crudo of codigosTexto) {
    const limpio = crudo.toUpperCase().replace(/[.\s]/g, "");
    const codigo = limpio.length > 3 ? limpio.slice(0, 3) + "." + limpio.slice(3) : limpio;
    if (!/^[A-Z]\d{2}(\.[\dA-Z]{1,2})?$/.test(codigo)) {
      throw new Error(`"${crudo}" no parece un código CIE-10 (ej.: F41.1 o F411).`);
    }
    const nombre = catalogo[codigo];
    resultado.push({ codigo, label: nombre ? `${codigo} - ${nombre}` : codigo });
  }
  return resultado;
}

editarClose.addEventListener("click", cerrarEditar);
editarCancelar.addEventListener("click", cerrarEditar);

editarGuardar.addEventListener("click", async () => {
  if (!atencionEnEdicion) return;
  editarError.classList.add("hidden");

  const nombre = editarNombre.value.trim();
  const empresa = editarEmpresa.value.trim();
  const fecha = editarFecha.value;
  if (!nombre || !empresa || !fecha) {
    mostrarErrorEditar("Nombre, empresa y fecha son obligatorios.");
    return;
  }

  const hora = editarHora.value || "";
  const fechaObj = new Date(`${fecha}T${hora || "12:00"}:00`);
  if (Number.isNaN(fechaObj.getTime())) {
    mostrarErrorEditar("Fecha u hora inválida.");
    return;
  }

  const codigosTexto = editarDiagnosticos.value.split(";").map((c) => c.trim()).filter(Boolean);
  let diagnosticos;
  try {
    diagnosticos = await resolverDiagnosticos(codigosTexto);
  } catch (err) {
    mostrarErrorEditar(err.message);
    return;
  }

  const acciones = Array.from(editarAccionesCheckboxes.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);

  editarGuardar.disabled = true;
  try {
    await setDoc(
      doc(dbPsico, CONTRATAS_COLLECTION, atencionEnEdicion.id),
      {
        dni: atencionEnEdicion.dni,
        nombre,
        sexo: editarSexo.value || null,
        empresa,
        area: editarArea.value || "",
        cargo: editarCargo.value.trim(),
        fecha,
        hora: hora || null,
        modalidad: editarModalidad.value || null,
        motivoConsulta: editarMotivo.value.trim(),
        riesgo: editarRiesgo.checked,
        frecuencia: editarFrecuencia.value || "",
        prioridad: editarPrioridad.value,
        derivacion: editarDerivacion.value,
        aptitud: editarAptitud.value || null,
        observaciones: editarObservaciones.value.trim(),
        recomendaciones: editarRecomendaciones.value.trim(),
        evolucion: editarEvolucion.value.trim(),
        diagnosticos,
        accionesRealizadas: acciones,
        resultadosPruebas: editarResultados.value.trim(),
        registradoEn: Timestamp.fromDate(fechaObj)
      },
      { merge: true }
    );
    cerrarEditar();
    cerrarHistorial();
    await inicializar();
  } catch (err) {
    console.error("Error al guardar la edición de Contratas:", err);
    mostrarErrorEditar("No se pudo guardar: " + (err.message || "revisa la consola."));
  } finally {
    editarGuardar.disabled = false;
  }
});

poblarCatalogosFormulario();

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
