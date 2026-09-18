// Lógica propia de Mi Disponibilidad (V9: disponibilidad por fecha exacta).
// Ya no existe una plantilla que se repita (ni semanal ni mensual): cada
// fecha del mes en curso y los 2 siguientes se configura por separado, en
// disponibilidad_fechas/{AAAA-MM-DD} (ver fetchDisponibilidadRango/
// fetchDisponibilidadFecha en fb-psico.js, compartido con index.js,
// agenda.js e indicadores.js). Una fecha sin doc (o sin bloques) queda
// cerrada — así se cubre tanto vacaciones como "este lunes es distinto del
// otro lunes", sin nada que replicar automáticamente.
import {
  dbPsico,
  DISPONIBILIDAD_COLLECTION,
  DISPONIBILIDAD_FECHAS_COLLECTION,
  DISPONIBILIDAD_MESES_CONFIGURABLES,
  claveMes,
  fetchDisponibilidadRango
} from "./fb-psico.js";
import { doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

var MESES_LARGOS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

var MODALIDAD_STYLES = {
  presencial: { label: "Presencial", dot: "bg-secondary", classes: "bg-secondary text-on-secondary" },
  virtual: { label: "Video", dot: "bg-secondary-fixed border border-secondary", classes: "bg-secondary-fixed border border-secondary text-on-secondary-fixed-variant" },
  llamada: { label: "Llamada", dot: "bg-tertiary-fixed border border-on-tertiary-fixed-variant", classes: "bg-tertiary-fixed border border-on-tertiary-fixed-variant text-on-tertiary-fixed-variant" },
  emergencia: { label: "Emergencia", dot: "hatched-bg border border-outline-variant", classes: "hatched-bg border border-outline-variant text-on-surface-variant" }
};

var HOY = new Date();

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatISO(fecha) {
  return fecha.getFullYear() + "-" + pad2(fecha.getMonth() + 1) + "-" + pad2(fecha.getDate());
}

var HOY_ISO = formatISO(HOY);

// Mes en curso + los 2 siguientes: las únicas 3 pestañas configurables.
// Cualquier otra fecha (pasada o más adelante) simplemente no tiene doc —
// index.js/agenda.js no dejan reservar ahí de todas formas.
var MESES_CONFIGURABLES = Array.from({ length: DISPONIBILIDAD_MESES_CONFIGURABLES }, function (_, offset) {
  var fecha = new Date(HOY.getFullYear(), HOY.getMonth() + offset, 1);
  return { anio: fecha.getFullYear(), mes: fecha.getMonth(), clave: claveMes(fecha.getFullYear(), fecha.getMonth()) };
});

var estadoDisponibilidad = new Map(); // fechaISO -> bloques[]
var mesSeleccionadoIndex = 0; // 0 = mes en curso (siempre la pestaña inicial)

function mesActivo() {
  return MESES_CONFIGURABLES[mesSeleccionadoIndex];
}

function crearIdBloque() {
  return "b" + Date.now() + Math.floor(Math.random() * 1000);
}

// --- Pestañas de mes ---
var mesTabsContenedor = document.getElementById("mes-tabs");

function renderMesTabs() {
  mesTabsContenedor.innerHTML = "";
  MESES_CONFIGURABLES.forEach(function (m, index) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = MESES_LARGOS[m.mes];
    btn.className =
      index === mesSeleccionadoIndex
        ? "px-4 py-2.5 text-body-md font-semibold bg-secondary text-on-secondary"
        : "px-4 py-2.5 text-body-md font-semibold text-on-surface-variant hover:bg-surface-container-low transition-all";
    btn.addEventListener("click", function () {
      if (mesSeleccionadoIndex === index) return;
      mesSeleccionadoIndex = index;
      renderMesTabs();
      renderCalendario();
    });
    mesTabsContenedor.appendChild(btn);
  });
}

// --- Cargar el rango completo (mes en curso .. fin del 2do mes siguiente)
// de una sola vez: solo trae las fechas que ya tienen doc guardado. ---
async function fetchDisponibilidad() {
  var primero = MESES_CONFIGURABLES[0];
  var ultimo = MESES_CONFIGURABLES[MESES_CONFIGURABLES.length - 1];
  var fechaInicioISO = formatISO(new Date(primero.anio, primero.mes, 1));
  var fechaFinISO = formatISO(new Date(ultimo.anio, ultimo.mes + 1, 0));
  return fetchDisponibilidadRango(fechaInicioISO, fechaFinISO);
}

async function guardarBloquesFecha(fechaISO, bloques) {
  var ref = doc(dbPsico, DISPONIBILIDAD_FECHAS_COLLECTION, fechaISO);
  if (bloques.length === 0) {
    await deleteDoc(ref);
    estadoDisponibilidad.delete(fechaISO);
  } else {
    await setDoc(ref, { fecha: fechaISO, bloques: bloques });
    estadoDisponibilidad.set(fechaISO, bloques);
  }
}

// --- Calendario del mes activo ---
var calendarGrid = document.getElementById("calendar-days-grid");

function diasEnMes(anio, mes) {
  return new Date(anio, mes + 1, 0).getDate();
}

function renderCalendario() {
  var m = mesActivo();
  calendarGrid.innerHTML = "";

  var primerDiaSemana = (new Date(m.anio, m.mes, 1).getDay() + 6) % 7; // 0 = lunes
  for (var i = 0; i < primerDiaSemana; i++) {
    calendarGrid.appendChild(document.createElement("div"));
  }

  var totalDias = diasEnMes(m.anio, m.mes);
  for (var dia = 1; dia <= totalDias; dia++) {
    var fechaISO = m.clave + "-" + pad2(dia);
    var bloques = estadoDisponibilidad.get(fechaISO) || [];
    var esPasado = fechaISO < HOY_ISO;
    var esHoy = fechaISO === HOY_ISO;

    var celda = document.createElement("button");
    celda.type = "button";
    celda.disabled = esPasado;
    celda.dataset.fecha = fechaISO;

    var base = "relative flex flex-col items-center justify-start gap-1 rounded-lg border p-2 min-h-[4.5rem] transition-all text-left";
    if (esPasado) {
      base += " border-outline-variant/40 bg-surface-container-lowest opacity-40 cursor-not-allowed";
    } else if (bloques.length > 0) {
      base += " border-secondary bg-secondary/5 hover:bg-secondary/10 cursor-pointer";
    } else {
      base += " border-dashed border-outline-variant hover:border-secondary/50 hover:bg-surface cursor-pointer";
    }
    celda.className = base;

    var numero = document.createElement("span");
    numero.className = "font-label-md text-label-md font-bold " + (esHoy ? "text-secondary underline decoration-2 underline-offset-4" : "text-on-surface");
    numero.textContent = String(dia);
    celda.appendChild(numero);

    if (bloques.length > 0) {
      var dots = document.createElement("div");
      dots.className = "flex flex-wrap gap-1";
      var modalidadesUnicas = Array.from(new Set(bloques.map(function (b) { return b.modalidad; })));
      modalidadesUnicas.slice(0, 4).forEach(function (modalidad) {
        var estilo = MODALIDAD_STYLES[modalidad] || MODALIDAD_STYLES.presencial;
        var dot = document.createElement("span");
        dot.className = "w-2.5 h-2.5 rounded-full " + estilo.dot;
        dots.appendChild(dot);
      });
      celda.appendChild(dots);

      var contador = document.createElement("span");
      contador.className = "text-[10px] text-on-surface-variant";
      contador.textContent = bloques.length + (bloques.length === 1 ? " bloque" : " bloques");
      celda.appendChild(contador);
    }

    if (!esPasado) {
      celda.addEventListener("click", function () {
        abrirModalFecha(this.dataset.fecha);
      });
    }

    calendarGrid.appendChild(celda);
  }
}

async function cargarYRenderizar() {
  try {
    estadoDisponibilidad = await fetchDisponibilidad();
    renderCalendario();
  } catch (err) {
    console.error("Error al cargar la disponibilidad:", err);
    calendarGrid.innerHTML = '<p class="col-span-full text-center text-body-md text-error py-6">No se pudo cargar el calendario.</p>';
  }
}

renderMesTabs();
cargarYRenderizar();

// ---------- Duración de cada cita (documento "config" en la colección
// "disponibilidad", global — no depende de la fecha). index.html y agenda.js
// generan las burbujas con este intervalo. ----------
var intervaloSelect = document.getElementById("intervalo-select");

async function cargarIntervalo() {
  try {
    var snap = await getDoc(doc(dbPsico, DISPONIBILIDAD_COLLECTION, "config"));
    var minutos = snap.exists() ? Number(snap.data().intervaloMinutos) : 30;
    if ([20, 30, 45, 60].includes(minutos)) intervaloSelect.value = String(minutos);
  } catch (err) {
    console.error("Error al cargar la duración de cita:", err);
  }
}

intervaloSelect.addEventListener("change", async function () {
  try {
    await setDoc(
      doc(dbPsico, DISPONIBILIDAD_COLLECTION, "config"),
      { intervaloMinutos: Number(intervaloSelect.value) },
      { merge: true }
    );
  } catch (err) {
    console.error("Error al guardar la duración de cita:", err);
    alert("No se pudo guardar la duración de cita.");
  }
});

cargarIntervalo();

// ---------- Modal: Bloques de una fecha ----------
var fechaModal = document.getElementById("fecha-modal");
var fechaModalTitle = document.getElementById("fecha-modal-title");
var fechaModalClose = document.getElementById("fecha-modal-close");
var fechaModalBloques = document.getElementById("fecha-modal-bloques");
var fechaModalAgregar = document.getElementById("fecha-modal-agregar");

var fechaActual = null;

function formatearFechaLarga(fechaISO) {
  var partes = fechaISO.split("-").map(Number);
  var fecha = new Date(partes[0], partes[1] - 1, partes[2]);
  var diasLargos = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return diasLargos[fecha.getDay()] + " " + partes[2] + " de " + MESES_LARGOS[partes[1] - 1].toLowerCase();
}

function renderBloquesFechaModal() {
  var bloques = estadoDisponibilidad.get(fechaActual) || [];
  fechaModalBloques.innerHTML = "";

  if (bloques.length === 0) {
    var vacio = document.createElement("p");
    vacio.className = "text-body-md text-on-surface-variant";
    vacio.textContent = "Sin bloques — este día queda cerrado.";
    fechaModalBloques.appendChild(vacio);
    return;
  }

  bloques
    .slice()
    .sort(function (a, b) { return a.horaInicio.localeCompare(b.horaInicio); })
    .forEach(function (bloque) {
      var estilo = MODALIDAD_STYLES[bloque.modalidad] || MODALIDAD_STYLES.presencial;
      var fila = document.createElement("div");
      fila.className =
        "flex items-center justify-between gap-2 rounded-lg p-3 cursor-pointer " + estilo.classes + (bloque.activo === false ? " opacity-30 grayscale" : "");
      fila.dataset.editBloque = bloque.id;

      var info = document.createElement("div");
      info.innerHTML =
        '<div class="text-label-md font-bold">' + estilo.label + "</div>" +
        '<div class="text-[11px] opacity-80">' + bloque.horaInicio + " - " + bloque.horaFin + "</div>";
      fila.appendChild(info);

      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "material-symbols-outlined text-[18px]";
      toggleBtn.textContent = "power_settings_new";
      toggleBtn.dataset.toggleBloque = bloque.id;
      fila.appendChild(toggleBtn);

      fechaModalBloques.appendChild(fila);
    });
}

function abrirModalFecha(fechaISO) {
  fechaActual = fechaISO;
  fechaModalTitle.textContent = formatearFechaLarga(fechaISO);
  renderBloquesFechaModal();
  fechaModal.classList.remove("hidden");
}

function cerrarModalFecha() {
  fechaModal.classList.add("hidden");
  fechaActual = null;
  renderCalendario();
}

fechaModalClose.addEventListener("click", cerrarModalFecha);
fechaModal.addEventListener("click", function (e) {
  if (e.target === fechaModal) cerrarModalFecha();
});

fechaModalAgregar.addEventListener("click", function () {
  abrirModalBloque(null);
});

fechaModalBloques.addEventListener("click", async function (e) {
  var toggleBtn = e.target.closest("[data-toggle-bloque]");
  if (toggleBtn) {
    e.stopPropagation();
    var bloques = estadoDisponibilidad.get(fechaActual) || [];
    var bloque = bloques.find(function (b) { return b.id === toggleBtn.dataset.toggleBloque; });
    if (!bloque) return;
    bloque.activo = !bloque.activo;
    renderBloquesFechaModal();
    try {
      await guardarBloquesFecha(fechaActual, bloques);
    } catch (err) {
      console.error("Error al actualizar el bloque:", err);
      alert("No se pudo guardar el cambio.");
    }
    return;
  }

  var fila = e.target.closest("[data-edit-bloque]");
  if (fila) {
    abrirModalBloque(fila.dataset.editBloque);
  }
});

// ---------- Modal: Agregar / Editar bloque ----------
var bloqueModal = document.getElementById("bloque-modal");
var bloqueModalTitle = document.getElementById("bloque-modal-title");
var bloqueModalClose = document.getElementById("bloque-modal-close");
var bloqueModalidadOptions = document.getElementById("bloque-modalidad-options");
var bloqueHoraInicio = document.getElementById("bloque-hora-inicio");
var bloqueHoraFin = document.getElementById("bloque-hora-fin");
var bloqueModalError = document.getElementById("bloque-modal-error");
var bloqueModalDelete = document.getElementById("bloque-modal-delete");
var bloqueModalSave = document.getElementById("bloque-modal-save");

var modalBloqueIdActual = null;
var modalidadSeleccionada = null;

var MODALIDAD_OPTION_BASE = "modalidad-option flex items-center gap-2 p-3 rounded-lg border-2 transition-all";
var MODALIDAD_OPTION_INACTIVE = MODALIDAD_OPTION_BASE + " border-outline-variant hover:border-secondary";
var MODALIDAD_OPTION_ACTIVE = MODALIDAD_OPTION_BASE + " border-secondary bg-secondary/5";

var bloqueEnlaceWrap = document.getElementById("bloque-enlace-wrap");
var bloqueEnlace = document.getElementById("bloque-enlace");

function marcarModalidadSeleccionada(modalidad) {
  modalidadSeleccionada = modalidad;
  bloqueModalidadOptions.querySelectorAll("[data-modalidad]").forEach(function (btn) {
    btn.className = btn.dataset.modalidad === modalidad ? MODALIDAD_OPTION_ACTIVE : MODALIDAD_OPTION_INACTIVE;
  });
  // El enlace de reunión solo aplica a bloques de Video.
  bloqueEnlaceWrap.classList.toggle("hidden", modalidad !== "virtual");
}

bloqueModalidadOptions.querySelectorAll("[data-modalidad]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    marcarModalidadSeleccionada(btn.dataset.modalidad);
  });
});

function abrirModalBloque(bloqueId) {
  modalBloqueIdActual = bloqueId;
  bloqueModalError.classList.add("hidden");

  var bloquesDeLaFecha = estadoDisponibilidad.get(fechaActual) || [];
  var bloqueExistente = bloqueId
    ? bloquesDeLaFecha.find(function (b) { return b.id === bloqueId; })
    : null;

  if (bloqueExistente) {
    bloqueModalTitle.textContent = "Editar bloque";
    marcarModalidadSeleccionada(bloqueExistente.modalidad);
    bloqueHoraInicio.value = bloqueExistente.horaInicio;
    bloqueHoraFin.value = bloqueExistente.horaFin;
    bloqueEnlace.value = bloqueExistente.enlace || "";
    bloqueModalDelete.classList.remove("hidden");
  } else {
    bloqueModalTitle.textContent = "Agregar bloque";
    marcarModalidadSeleccionada("presencial");
    bloqueHoraInicio.value = "09:00";
    bloqueHoraFin.value = "10:00";
    bloqueEnlace.value = "";
    bloqueModalDelete.classList.add("hidden");
  }

  bloqueModal.classList.remove("hidden");
}

function cerrarModalBloque() {
  bloqueModal.classList.add("hidden");
  modalBloqueIdActual = null;
}

bloqueModalClose.addEventListener("click", cerrarModalBloque);
bloqueModal.addEventListener("click", function (e) {
  if (e.target === bloqueModal) cerrarModalBloque();
});

function mostrarErrorModal(mensaje) {
  bloqueModalError.textContent = mensaje;
  bloqueModalError.classList.remove("hidden");
}

bloqueModalSave.addEventListener("click", async function () {
  var horaInicio = bloqueHoraInicio.value;
  var horaFin = bloqueHoraFin.value;

  if (!modalidadSeleccionada) {
    mostrarErrorModal("Elige una modalidad.");
    return;
  }
  if (!horaInicio || !horaFin || horaInicio >= horaFin) {
    mostrarErrorModal("La hora de fin debe ser posterior a la de inicio.");
    return;
  }

  var enlace = modalidadSeleccionada === "virtual" ? bloqueEnlace.value.trim() : "";
  var bloquesDeLaFecha = (estadoDisponibilidad.get(fechaActual) || []).slice();

  if (modalBloqueIdActual) {
    var bloque = bloquesDeLaFecha.find(function (b) { return b.id === modalBloqueIdActual; });
    if (bloque) {
      bloque.modalidad = modalidadSeleccionada;
      bloque.horaInicio = horaInicio;
      bloque.horaFin = horaFin;
      bloque.enlace = enlace;
    }
  } else {
    bloquesDeLaFecha.push({
      id: crearIdBloque(),
      modalidad: modalidadSeleccionada,
      horaInicio: horaInicio,
      horaFin: horaFin,
      enlace: enlace,
      activo: true
    });
  }

  var originalText = bloqueModalSave.textContent;
  bloqueModalSave.disabled = true;
  bloqueModalSave.textContent = "Guardando...";

  try {
    await guardarBloquesFecha(fechaActual, bloquesDeLaFecha);
    renderBloquesFechaModal();
    cerrarModalBloque();
  } catch (err) {
    console.error("Error al guardar el bloque:", err);
    mostrarErrorModal("No se pudo guardar el bloque.");
  } finally {
    bloqueModalSave.disabled = false;
    bloqueModalSave.textContent = originalText;
  }
});

bloqueModalDelete.addEventListener("click", async function () {
  if (!modalBloqueIdActual) return;

  var bloquesDeLaFecha = (estadoDisponibilidad.get(fechaActual) || []).filter(function (b) {
    return b.id !== modalBloqueIdActual;
  });

  try {
    await guardarBloquesFecha(fechaActual, bloquesDeLaFecha);
    renderBloquesFechaModal();
    cerrarModalBloque();
  } catch (err) {
    console.error("Error al eliminar el bloque:", err);
    mostrarErrorModal("No se pudo eliminar el bloque.");
  }
});

// ---------- Vista previa pública: abre la página de reserva tal como la ve
// el trabajador, en otra pestaña ----------
document.getElementById("vista-previa-btn").addEventListener("click", function () {
  window.open("index.html", "_blank");
});
