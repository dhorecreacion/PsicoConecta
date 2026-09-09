// Tablero de Indicadores de Contratas — espejo de js/indicadores.js (MIBSAC),
// pero mucho más simple porque Contratas NO tiene reserva pública, NI
// agenda/disponibilidad, NI ficha externa de firebase-config.js: toda la
// información sale de "contratas_registros" (fb-psico), cargada una vez al
// mes por Excel (contratas.html / js/importador-contratas.js).
//
// Por eso NO existen aquí: % Participación, % Capacidad Utilizada, Citas No
// Asistidas/Reprogramadas, Atenciones a Familiares, Motivos de Inasistencia
// (todo eso depende de historial_citas, que Contratas no tiene) ni Edad y
// Género (depende de la ficha externa, que Contratas tampoco tiene). A
// cambio, "Atenciones por Empresa" es nueva (no existe en MIBSAC), porque
// "empresa" es la dimensión propia de Contratas — el equivalente a "área".
import { dbPsico, MODALIDADES, CONFIGURACION_COLLECTION, CONTRATAS_COLLECTION, CONTRATAS_CASOS_COLLECTION } from "./fb-psico.js";
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const UMBRAL_SEGUIMIENTO_DEFAULT = 30;

const PRIORIDAD_META = {
  high: { label: "Alta", color: "#ba1a1a" },
  medium: { label: "Media", color: "#0058be" },
  low: { label: "Baja", color: "#c5c6cd" }
};

const APTITUD_META = {
  apto: { label: "Apto", color: "#2e7d32" },
  restricciones: { label: "Restricciones", color: "#f59e0b" },
  no_apto: { label: "No apto", color: "#ba1a1a" }
};

// ---------- Utilidades (mismas que indicadores.js) ----------
function timestampToDate(timestamp) {
  return timestamp && typeof timestamp.toDate === "function" ? timestamp.toDate() : null;
}

function porcentaje(parte, total) {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

function setTexto(id, texto) {
  document.getElementById(id).textContent = texto;
}

function crearFilaBarra(etiqueta, valorTexto, anchoPct, colorClase) {
  const fila = document.createElement("div");
  fila.className = "space-y-2";

  const encabezado = document.createElement("div");
  encabezado.className = "flex justify-between text-label-md text-on-surface-variant font-semibold";
  const spanEtiqueta = document.createElement("span");
  spanEtiqueta.textContent = etiqueta;
  const spanValor = document.createElement("span");
  spanValor.textContent = valorTexto;
  encabezado.appendChild(spanEtiqueta);
  encabezado.appendChild(spanValor);

  const pista = document.createElement("div");
  pista.className = "h-2 w-full bg-surface-container-highest rounded-full overflow-hidden";
  const barra = document.createElement("div");
  barra.className = "h-full rounded-full " + colorClase;
  barra.style.width = Math.min(100, Math.max(0, anchoPct)) + "%";
  pista.appendChild(barra);

  fila.appendChild(encabezado);
  fila.appendChild(pista);
  return fila;
}

function mensajeVacio(contenedor, texto) {
  contenedor.innerHTML = "";
  const p = document.createElement("p");
  p.className = "text-body-md text-on-surface-variant";
  p.textContent = texto;
  contenedor.appendChild(p);
}

function crearColumnaMes(mesIdx, valor, maximo, esMesSeleccionado, sufijo) {
  const columna = document.createElement("div");
  columna.className = "flex flex-col items-center flex-1 h-full justify-end group min-w-0";

  const barra = document.createElement("div");
  barra.className =
    "w-full rounded-t-lg relative transition-all " +
    (esMesSeleccionado ? "bg-secondary shadow-md" : "bg-secondary/10 group-hover:bg-secondary/20");
  barra.style.height = valor > 0 ? Math.max(4, (valor / maximo) * 100) + "%" : "2px";

  const tooltip = document.createElement("div");
  tooltip.className =
    "absolute -top-6 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] px-2 py-1 rounded whitespace-nowrap";
  tooltip.textContent = valor + (sufijo || "");
  barra.appendChild(tooltip);

  const etiqueta = document.createElement("span");
  etiqueta.className = "mt-4 text-[11px] truncate " + (esMesSeleccionado ? "font-bold text-primary" : "text-on-surface-variant font-medium");
  etiqueta.textContent = MESES_CORTOS[mesIdx];

  columna.appendChild(barra);
  columna.appendChild(etiqueta);
  return columna;
}

// ---------- Carga de datos ----------
async function fetchRegistros() {
  const snap = await getDocs(collection(dbPsico, CONTRATAS_COLLECTION));
  const registros = [];
  snap.forEach((d) => registros.push({ dni: d.data().dni, data: d.data() }));
  return registros;
}

// Mismo umbral que Configuración usa para MIBSAC (configuracion/general):
// es el mismo psicólogo, el mismo criterio de "cuánto es demasiado tiempo
// sin atención".
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

async function fetchCasosCerrados() {
  const cerrados = new Set();
  try {
    const snap = await getDocs(collection(dbPsico, CONTRATAS_CASOS_COLLECTION));
    snap.forEach((d) => {
      if (d.data().cerrado) cerrados.add(d.id);
    });
  } catch (err) {
    console.warn("No se pudo cargar el estado de casos cerrados:", err);
  }
  return cerrados;
}

// Sin ficha externa: un caso deja de ser "activo" únicamente si el
// psicólogo lo cerró a mano.
function esCasoActivo(dni, casosCerrados) {
  return !(casosCerrados && casosCerrados.has(dni));
}

// ---------- Cálculo ----------
function calcularIndicadores(registros, mesSeleccionado, umbralSeguimientoDias, casosCerrados) {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const esGeneral = mesSeleccionado === "general";
  const mes = esGeneral ? null : mesSeleccionado;

  const dnisTotales = new Set();
  const dnisMes = new Set();
  let atencionesMes = 0;
  const registrosPorMes = Array.from({ length: 12 }, () => new Set());
  const ultimaPorDni = new Map();
  const conteoAreas = new Map();
  const conteoEmpresas = new Map();
  const conteoDiagnosticos = new Map();
  const conteoDerivaciones = new Map();
  const conteoModalidades = new Map();
  const diagPorArea = new Map();
  const aptitudMes = { apto: 0, restricciones: 0, no_apto: 0 };

  registros.forEach(({ dni, data }) => {
    dnisTotales.add(dni);
    const fecha = timestampToDate(data.registradoEn);
    const area = data.area || "Sin área registrada";
    const empresa = data.empresa || "Sin empresa registrada";

    if (fecha && fecha.getFullYear() === anio) {
      registrosPorMes[fecha.getMonth()].add(dni);
      if (esGeneral || fecha.getMonth() === mes) {
        atencionesMes++;
        dnisMes.add(dni);

        if (data.aptitud && Object.prototype.hasOwnProperty.call(aptitudMes, data.aptitud) && esCasoActivo(dni, casosCerrados)) {
          aptitudMes[data.aptitud]++;
        }

        conteoAreas.set(area, (conteoAreas.get(area) || 0) + 1);
        conteoEmpresas.set(empresa, (conteoEmpresas.get(empresa) || 0) + 1);

        (data.diagnosticos || []).forEach((diag) => {
          if (!diag || !diag.label) return;
          conteoDiagnosticos.set(diag.label, (conteoDiagnosticos.get(diag.label) || 0) + 1);
          if (!diagPorArea.has(area)) diagPorArea.set(area, new Map());
          const porArea = diagPorArea.get(area);
          porArea.set(diag.label, (porArea.get(diag.label) || 0) + 1);
        });

        if (data.derivacion) {
          conteoDerivaciones.set(data.derivacion, (conteoDerivaciones.get(data.derivacion) || 0) + 1);
        }

        const modalidadKey = data.modalidad && MODALIDADES[data.modalidad] ? data.modalidad : "sin_registro";
        conteoModalidades.set(modalidadKey, (conteoModalidades.get(modalidadKey) || 0) + 1);
      }
    }

    const previa = ultimaPorDni.get(dni);
    const fechaPrevia = previa ? timestampToDate(previa.registradoEn) : null;
    if (!previa || (fecha && (!fechaPrevia || fecha > fechaPrevia))) {
      ultimaPorDni.set(dni, data);
    }
  });

  let casosRiesgo = 0;
  const conteoPrioridades = new Map();
  const casosSinSeguimiento = [];
  ultimaPorDni.forEach((ultima, dni) => {
    const activo = esCasoActivo(dni, casosCerrados);

    if (ultima.riesgo && activo) casosRiesgo++;

    const prioridad = ultima.prioridad || "medium";
    conteoPrioridades.set(prioridad, (conteoPrioridades.get(prioridad) || 0) + 1);

    if (!activo) return;

    const requiereSeguimiento = ultima.riesgo || ultima.aptitud === "restricciones" || ultima.aptitud === "no_apto";
    if (!requiereSeguimiento) return;
    const fechaUltima = timestampToDate(ultima.registradoEn);
    if (!fechaUltima) return;
    const diasSinAtender = Math.floor((ahora - fechaUltima) / (1000 * 60 * 60 * 24));
    if (diasSinAtender > umbralSeguimientoDias) {
      casosSinSeguimiento.push({ dni, nombre: ultima.nombre || "", dias: diasSinAtender });
    }
  });
  casosSinSeguimiento.sort((a, b) => b.dias - a.dias);

  const diagnosticoTopPorArea = Array.from(diagPorArea.entries())
    .map(([area, mapa]) => {
      const top = Array.from(mapa.entries()).sort((a, b) => b[1] - a[1])[0];
      return { area, diagnostico: top[0], cuenta: top[1] };
    })
    .sort((a, b) => b.cuenta - a.cuenta)
    .slice(0, 6);

  let casosActivos = 0;
  dnisTotales.forEach((dni) => {
    if (esCasoActivo(dni, casosCerrados)) casosActivos++;
  });

  return {
    anio: anio,
    mes: mes,
    esGeneral: esGeneral,
    atencionesMes: atencionesMes,
    atendidosMes: dnisMes.size,
    casosActivos: casosActivos,
    casosRiesgo: casosRiesgo,
    casosSinSeguimiento: casosSinSeguimiento,
    registrosPorMes: registrosPorMes.map((set) => set.size),
    conteoAreas: conteoAreas,
    conteoEmpresas: conteoEmpresas,
    conteoPrioridades: conteoPrioridades,
    conteoDiagnosticos: conteoDiagnosticos,
    conteoDerivaciones: conteoDerivaciones,
    conteoModalidades: conteoModalidades,
    diagnosticoTopPorArea: diagnosticoTopPorArea,
    aptitudMes: aptitudMes
  };
}

// ---------- Render ----------
function renderKpis(ind) {
  document.getElementById("mes-selector").value = ind.esGeneral ? "general" : String(ind.mes);
  setTexto("periodo-anio", String(ind.anio));
  setTexto("kpi-atenciones-mes", String(ind.atencionesMes));
  setTexto("kpi-atendidos-mes", String(ind.atendidosMes));
  setTexto("kpi-casos-activos", String(ind.casosActivos));
  setTexto("riskValue", String(ind.casosRiesgo));
}

function renderChartMensual(ind) {
  const contenedor = document.getElementById("chart-mensual");
  setTexto("chart-anio", String(ind.anio));
  contenedor.innerHTML = "";

  const maximo = Math.max(...ind.registrosPorMes, 1);
  ind.registrosPorMes.forEach((valor, mesIdx) => {
    contenedor.appendChild(crearColumnaMes(mesIdx, valor, maximo, mesIdx === ind.mes, ""));
  });
}

function renderChartAreas(ind) {
  const contenedor = document.getElementById("chart-areas");
  contenedor.innerHTML = "";

  if (ind.atencionesMes === 0) {
    mensajeVacio(contenedor, "Aún no hay registros en el período elegido.");
    return;
  }

  Array.from(ind.conteoAreas.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .forEach(([area, cuenta]) => {
      const pct = porcentaje(cuenta, ind.atencionesMes);
      contenedor.appendChild(crearFilaBarra(area, cuenta + " (" + pct + "%)", pct, "bg-secondary"));
    });
}

function renderChartEmpresas(ind) {
  const contenedor = document.getElementById("chart-empresas");
  contenedor.innerHTML = "";

  if (ind.atencionesMes === 0) {
    mensajeVacio(contenedor, "Aún no hay registros en el período elegido.");
    return;
  }

  Array.from(ind.conteoEmpresas.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([empresa, cuenta]) => {
      const pct = porcentaje(cuenta, ind.atencionesMes);
      contenedor.appendChild(crearFilaBarra(empresa, cuenta + " (" + pct + "%)", pct, "bg-secondary"));
    });
}

function renderChartPrioridades(ind) {
  const donut = document.getElementById("chart-prioridades-donut");
  const leyenda = document.getElementById("chart-prioridades-legend");
  leyenda.innerHTML = "";

  const totalCasos = Array.from(ind.conteoPrioridades.values()).reduce((a, b) => a + b, 0);
  if (totalCasos === 0) {
    mensajeVacio(leyenda, "Aún no hay casos registrados.");
    setTexto("donut-center-value", "0");
    setTexto("donut-center-label", "Casos");
    return;
  }

  const orden = ["high", "medium", "low"];
  let acumulado = 0;
  const segmentos = [];
  let mayor = { label: "", pct: -1 };

  orden.forEach((clave) => {
    const cuenta = ind.conteoPrioridades.get(clave) || 0;
    if (cuenta === 0) return;
    const meta = PRIORIDAD_META[clave];
    const pct = (cuenta / totalCasos) * 100;
    segmentos.push(meta.color + " " + acumulado + "% " + (acumulado + pct) + "%");
    acumulado += pct;
    const pctRedondeado = porcentaje(cuenta, totalCasos);
    if (pctRedondeado > mayor.pct) mayor = { label: meta.label, pct: pctRedondeado };

    const fila = document.createElement("div");
    fila.className = "flex items-center gap-3";
    const punto = document.createElement("span");
    punto.className = "w-4 h-4 rounded flex-shrink-0";
    punto.style.backgroundColor = meta.color;
    const textos = document.createElement("div");
    textos.className = "flex-1 flex justify-between text-body-md font-medium";
    const nombre = document.createElement("span");
    nombre.textContent = "Prioridad " + meta.label;
    const valor = document.createElement("span");
    valor.textContent = cuenta + " (" + pctRedondeado + "%)";
    textos.appendChild(nombre);
    textos.appendChild(valor);
    fila.appendChild(punto);
    fila.appendChild(textos);
    leyenda.appendChild(fila);
  });

  donut.style.background = "conic-gradient(" + segmentos.join(", ") + ")";
  setTexto("donut-center-value", mayor.pct + "%");
  setTexto("donut-center-label", mayor.label);
}

function renderAptitudMes(ind) {
  const donut = document.getElementById("chart-aptitud-donut");
  const leyenda = document.getElementById("chart-aptitud-legend");
  leyenda.innerHTML = "";

  const total = ind.aptitudMes.apto + ind.aptitudMes.restricciones + ind.aptitudMes.no_apto;
  if (total === 0) {
    mensajeVacio(leyenda, "Sin determinaciones de aptitud en el período elegido.");
    donut.style.background = "none";
    setTexto("aptitud-donut-value", "0");
    setTexto("aptitud-donut-label", "Casos");
    return;
  }

  const orden = ["apto", "restricciones", "no_apto"];
  let acumulado = 0;
  const segmentos = [];

  orden.forEach((clave) => {
    const cuenta = ind.aptitudMes[clave];
    if (cuenta === 0) return;
    const meta = APTITUD_META[clave];
    const pct = (cuenta / total) * 100;
    segmentos.push(meta.color + " " + acumulado + "% " + (acumulado + pct) + "%");
    acumulado += pct;

    const fila = document.createElement("div");
    fila.className = "flex items-center gap-3";
    const punto = document.createElement("span");
    punto.className = "w-4 h-4 rounded flex-shrink-0";
    punto.style.backgroundColor = meta.color;
    const textos = document.createElement("div");
    textos.className = "flex-1 flex justify-between text-body-md font-medium";
    const nombre = document.createElement("span");
    nombre.textContent = meta.label;
    const valor = document.createElement("span");
    valor.textContent = cuenta + " (" + porcentaje(cuenta, total) + "%)";
    textos.appendChild(nombre);
    textos.appendChild(valor);
    fila.appendChild(punto);
    fila.appendChild(textos);
    leyenda.appendChild(fila);
  });

  donut.style.background = "conic-gradient(" + segmentos.join(", ") + ")";
  setTexto("aptitud-donut-value", String(total));
  setTexto("aptitud-donut-label", "Casos");
}

function renderDiagnosticos(ind) {
  const contenedor = document.getElementById("psychContent");
  contenedor.innerHTML = "";

  const totalMenciones = Array.from(ind.conteoDiagnosticos.values()).reduce((a, b) => a + b, 0);
  if (totalMenciones === 0) {
    mensajeVacio(contenedor, "Aún no hay diagnósticos registrados en el período elegido.");
    return;
  }

  Array.from(ind.conteoDiagnosticos.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .forEach(([label, cuenta], indice) => {
      const fila = document.createElement("div");
      fila.className = "flex items-center justify-between p-4 bg-surface-container-low rounded-lg border border-outline-variant/30";

      const izquierda = document.createElement("div");
      izquierda.className = "flex items-center gap-4 min-w-0";
      const numero = document.createElement("div");
      numero.className = "w-10 h-10 flex-shrink-0 rounded bg-white flex items-center justify-center font-bold text-secondary shadow-sm";
      numero.textContent = String(indice + 1).padStart(2, "0");
      const nombre = document.createElement("span");
      nombre.className = "font-body-md font-semibold truncate";
      nombre.textContent = label;
      izquierda.appendChild(numero);
      izquierda.appendChild(nombre);

      const pct = document.createElement("span");
      pct.className = "text-body-md font-bold text-secondary flex-shrink-0 ml-3";
      pct.textContent = porcentaje(cuenta, totalMenciones) + "%";

      fila.appendChild(izquierda);
      fila.appendChild(pct);
      contenedor.appendChild(fila);
    });
}

function renderDiagnosticosPorArea(ind) {
  const contenedor = document.getElementById("chart-diag-area");
  contenedor.innerHTML = "";

  if (ind.diagnosticoTopPorArea.length === 0) {
    mensajeVacio(contenedor, "Aún no hay suficientes datos en el período elegido.");
    return;
  }

  ind.diagnosticoTopPorArea.forEach(({ area, diagnostico, cuenta }) => {
    const fila = document.createElement("div");
    fila.className = "flex items-center justify-between gap-3 p-3 bg-surface-container-low rounded-lg border border-outline-variant/30";

    const izquierda = document.createElement("div");
    izquierda.className = "min-w-0";
    const areaEl = document.createElement("p");
    areaEl.className = "text-label-md font-bold text-on-surface-variant uppercase tracking-wide truncate";
    areaEl.textContent = area;
    const diagEl = document.createElement("p");
    diagEl.className = "text-body-md font-semibold truncate";
    diagEl.textContent = diagnostico;
    izquierda.appendChild(areaEl);
    izquierda.appendChild(diagEl);

    const cuentaEl = document.createElement("span");
    cuentaEl.className = "text-body-md font-bold text-secondary flex-shrink-0";
    cuentaEl.textContent = String(cuenta);

    fila.appendChild(izquierda);
    fila.appendChild(cuentaEl);
    contenedor.appendChild(fila);
  });
}

function renderCasosSinSeguimiento(ind) {
  const contenedor = document.getElementById("chart-seguimiento");
  contenedor.innerHTML = "";

  if (ind.casosSinSeguimiento.length === 0) {
    mensajeVacio(contenedor, "No hay casos pendientes de seguimiento.");
    return;
  }

  ind.casosSinSeguimiento.slice(0, 8).forEach((caso) => {
    const fila = document.createElement("div");
    fila.className = "flex items-center justify-between gap-3 p-3 bg-surface-container-low rounded-lg border border-outline-variant/30";

    const nombre = document.createElement("span");
    nombre.className = "text-body-md font-medium truncate";
    nombre.textContent = caso.nombre || "DNI " + caso.dni;

    const dias = document.createElement("span");
    dias.className = "text-label-md font-bold text-error flex-shrink-0";
    dias.textContent = caso.dias + " días";

    fila.appendChild(nombre);
    fila.appendChild(dias);
    contenedor.appendChild(fila);
  });
}

function renderModalidades(ind) {
  const contenedor = document.getElementById("chart-modalidades");
  contenedor.innerHTML = "";

  const total = Array.from(ind.conteoModalidades.values()).reduce((a, b) => a + b, 0);
  if (total === 0) {
    mensajeVacio(contenedor, "Aún no hay registros en el período elegido.");
    return;
  }

  const colores = { presencial: "bg-secondary", virtual: "bg-secondary/60", llamada: "bg-tertiary-fixed-dim", sin_registro: "bg-surface-container-highest" };

  Array.from(ind.conteoModalidades.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([clave, cuenta]) => {
      const etiqueta = clave === "sin_registro" ? "Sin registro" : MODALIDADES[clave].label;
      const pct = porcentaje(cuenta, total);
      contenedor.appendChild(crearFilaBarra(etiqueta, cuenta + " (" + pct + "%)", pct, colores[clave] || "bg-secondary"));
    });
}

function renderDerivaciones(ind) {
  const contenedor = document.getElementById("chart-derivaciones");
  contenedor.innerHTML = "";

  const total = Array.from(ind.conteoDerivaciones.values()).reduce((a, b) => a + b, 0);
  if (total === 0) {
    mensajeVacio(contenedor, "Aún no hay derivaciones registradas en el período elegido.");
    return;
  }

  Array.from(ind.conteoDerivaciones.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([derivacion, cuenta]) => {
      const pct = porcentaje(cuenta, total);
      const color = derivacion === "No requerida" ? "bg-surface-container-highest" : "bg-secondary";
      contenedor.appendChild(crearFilaBarra(derivacion, cuenta + " (" + pct + "%)", pct, color));
    });
}

function renderTodo(ind) {
  renderKpis(ind);
  renderChartMensual(ind);
  renderChartAreas(ind);
  renderChartEmpresas(ind);
  renderChartPrioridades(ind);
  renderAptitudMes(ind);
  renderDiagnosticos(ind);
  renderDiagnosticosPorArea(ind);
  renderCasosSinSeguimiento(ind);
  renderModalidades(ind);
  renderDerivaciones(ind);
}

// Exportar: usa la impresión del navegador (permite guardar como PDF el
// tablero tal como se ve), mismo criterio que MIBSAC.
document.getElementById("export-btn").addEventListener("click", () => window.print());

// ---------- Inicio ----------
let datosGlobales = null;
const mesSelector = document.getElementById("mes-selector");

function recalcularYRenderizar() {
  if (!datosGlobales) return;
  const mesSeleccionado = mesSelector.value === "general" ? "general" : Number(mesSelector.value);
  renderTodo(
    calcularIndicadores(datosGlobales.registros, mesSeleccionado, datosGlobales.umbralSeguimiento, datosGlobales.casosCerrados)
  );
}

mesSelector.addEventListener("change", recalcularYRenderizar);

async function inicializar() {
  try {
    const [registros, umbralSeguimiento, casosCerrados] = await Promise.all([
      fetchRegistros(),
      fetchUmbralSeguimiento(),
      fetchCasosCerrados()
    ]);

    datosGlobales = { registros, umbralSeguimiento, casosCerrados };
    mesSelector.value = "general";
    recalcularYRenderizar();
  } catch (err) {
    console.error("Error al cargar los indicadores de Contratas:", err);
    [
      "chart-mensual", "chart-areas", "chart-empresas", "chart-prioridades-legend",
      "psychContent", "chart-diag-area", "chart-seguimiento", "chart-derivaciones"
    ].forEach((id) => mensajeVacio(document.getElementById(id), "No se pudieron cargar los datos."));
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) inicializar();
});
