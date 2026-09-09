// Importador de Contratas (contratas.html).
// A diferencia de js/importador.js (MIBSAC), aquí NO hay columna "tipo"
// (todo es un registro de atención, no hay concepto de "cita" agendada), NI
// columnas "familiar*"/"asistio" (no aplican sin reserva pública), y SÍ hay
// columnas de identidad (nombre, empresa, area, cargo) porque no existe una
// ficha externa de la que completarlas — Contratas se alimenta solo de este
// Excel, una vez al mes.
//
// Genera una plantilla Excel (una hoja de datos + una hoja de guía), lee el
// archivo llenado, valida cada fila y escribe en Firestore (proyecto
// fb-psico), colección plana "contratas_registros" (sin anidar bajo un doc
// por DNI, porque no hay un doc "vigente" tipo pacientes/{dni} que
// sobreescribir). El ID de cada fila es determinístico (dni-fecha-hora-n):
// reimportar el mismo archivo sobreescribe en vez de duplicar.
import { dbPsico, CONTRATAS_COLLECTION, CONFIGURACION_COLLECTION } from "./fb-psico.js";
import { cargarCie10 } from "./cie10.js";
import {
  doc,
  getDoc,
  writeBatch,
  Timestamp,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COLUMNAS = [
  "dni", "nombre", "empresa", "area", "cargo", "fecha", "hora", "modalidad",
  "motivo", "riesgo", "frecuencia", "prioridad", "derivacion", "aptitud",
  "observaciones", "recomendaciones", "evolucion", "diagnosticos", "acciones", "resultados"
];

const PRIORIDADES = { baja: "low", media: "medium", alta: "high", low: "low", medium: "medium", high: "high" };
const APTITUDES = { apto: "apto", restricciones: "restricciones", "apto con restricciones": "restricciones", "no apto": "no_apto", no_apto: "no_apto" };
const MODALIDADES_ALIAS = { presencial: "presencial", virtual: "virtual", video: "virtual", llamada: "llamada", telefono: "llamada", "teléfono": "llamada" };

// Mismos catálogos editables de Configuración que usa MIBSAC (Derivación y
// Acciones son del mismo psicólogo, atienda a quien atienda).
const DERIVACIONES_DEFAULT = ["No requerida", "Psiquiatría", "Psicologia", "Neuropsicologia"];
const ACCIONES_DEFAULT = [
  "Recomendaciones compartidas verbalmente",
  "Envío de material psicoeducativo digital",
  "Pruebas psicométricas aplicadas"
];

function normalizarTexto(texto) {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function construirMapaCatalogo(lista) {
  const mapa = {};
  lista.forEach((texto) => {
    mapa[normalizarTexto(texto)] = texto;
  });
  return mapa;
}

let derivacionesValidas = construirMapaCatalogo(DERIVACIONES_DEFAULT);
let accionesValidas = construirMapaCatalogo(ACCIONES_DEFAULT);

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

const importToggle = document.getElementById("import-toggle");
const importBody = document.getElementById("import-body");
const importChevron = document.getElementById("import-chevron");
const downloadTemplateBtn = document.getElementById("download-template-btn");
const importFile = document.getElementById("import-file");
const importStatus = document.getElementById("import-status");
const importErrors = document.getElementById("import-errors");
const importWarnings = document.getElementById("import-warnings");
const importBtn = document.getElementById("import-btn");

let registrosValidos = [];

importToggle.addEventListener("click", () => {
  importBody.classList.toggle("hidden");
  importChevron.textContent = importBody.classList.contains("hidden") ? "expand_more" : "expand_less";
});

function sheetJsDisponible() {
  if (typeof XLSX === "undefined") {
    mostrarEstado("No se pudo cargar el componente de Excel. Revisa tu conexión a internet y recarga la página.", true);
    return false;
  }
  return true;
}

function hojaConAnchos(filas, columnas) {
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja["!cols"] = columnas.map((col) => ({ wch: Math.max(col.length + 2, 14) }));
  return hoja;
}

// Filas de ejemplo: datos ficticios de dos empresas contratistas distintas.
const FILAS_EJEMPLO = [
  ["10000001", "Marco Quispe Huamán", "Contrata Andina SAC", "Mantenimiento", "Técnico", "2026-05-13", "18:00", "virtual", "Refiere estrés por carga laboral.", "no", "Semanal", "media", "", "apto", "", "Se brindan recomendaciones para el manejo del estrés.", "", "", "", ""],
  ["10000002", "Rosa Delia Flores", "Servicios Generales del Sur EIRL", "Limpieza", "Operaria", "2026-06-03", "10:00", "llamada", "Refiere afectación emocional por situación familiar.", "no", "a demanda", "media", "Psicologia", "no apto", "", "Se recomienda seguimiento en próxima visita a campo.", "", "F43.2", "", "En proceso de cierre."],
  ["10000003", "Jhon Torres Vega", "Contrata Andina SAC", "Mantenimiento", "Supervisor", "2026-06-10", "08:00", "presencial", "Sesión de seguimiento; se registran avances.", "no", "Mensual", "baja", "", "apto", "Asiste puntualmente y muestra buena disposición.", "", "", "", "", ""]
];

// ---------- Plantilla Excel ----------
downloadTemplateBtn.addEventListener("click", async () => {
  if (!sheetJsDisponible()) return;

  const filasDatos = [COLUMNAS, ...FILAS_EJEMPLO];
  const catalogos = await obtenerCatalogos();

  const filasGuia = [
    ["Columna", "¿Obligatorio?", "Qué poner"],
    ["dni", "SÍ", "8 a 12 letras/números (DNI o carné de extranjería)."],
    ["nombre", "SÍ", "Nombre completo del trabajador de la contrata (aquí no hay ficha externa de la que completarlo)."],
    ["empresa", "SÍ", "Nombre de la empresa contratista."],
    ["area", "No", "Área o proceso dentro de la contrata."],
    ["cargo", "No", "Cargo del trabajador."],
    ["fecha", "SÍ", "Fecha real: 2026-05-14 o 14/05/2026."],
    ["hora", "No", "Formato 10:30 (si se deja vacío, se asume 12:00)."],
    ["modalidad", "No", "presencial, virtual (o video), llamada."],
    ["motivo", "No", "Texto libre: motivo de consulta."],
    ["riesgo", "No", "si / no. Los riesgos históricos NO encienden ninguna alerta automática."],
    ["frecuencia", "No", "Semanal, Quincenal, Mensual, A demanda."],
    ["prioridad", "No", "baja / media / alta (vacío = media)."],
    ["derivacion", "No", catalogos.derivaciones.join(", ") + " (vacío = No requerida). Debe ser una de estas opciones exactas: son las mismas del catálogo editable en Configuración."],
    ["aptitud", "No", "apto / restricciones / no_apto."],
    ["observaciones", "No", "Texto libre: observaciones registradas durante la atención."],
    ["recomendaciones", "No", "Texto libre: recomendaciones brindadas."],
    ["evolucion", "No", "Texto libre: evolución y respuesta a la intervención."],
    ["diagnosticos", "No", "Cualquier código del catálogo CIE-10, con o sin punto (F41.1 o F411), separados por ; — el nombre se completa al importar buscándolo en el catálogo local (data/cie10.json). Puede quedar vacío."],
    ["acciones", "No", "Una o más, separadas por ; — deben ser del catálogo editable en Configuración: " + catalogos.acciones.join(", ") + "."],
    ["resultados", "No", "Texto libre. Ej.: BDI-II: 24 puntos."],
    [],
    ["Nota", "", "Una fila = una atención. Si subes el mismo archivo dos veces, se sobreescribe (no se duplica)."],
    ["Nota", "", "Las filas de ejemplo son ficticias — bórralas y reemplázalas por los datos reales antes de subir el archivo."]
  ];

  const libro = XLSX.utils.book_new();
  const hojaDatos = hojaConAnchos(filasDatos, COLUMNAS);
  const hojaGuia = XLSX.utils.aoa_to_sheet(filasGuia);
  hojaGuia["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 95 }];

  XLSX.utils.book_append_sheet(libro, hojaDatos, "Contratas");
  XLSX.utils.book_append_sheet(libro, hojaGuia, "Guía");
  XLSX.writeFile(libro, "plantilla-contratas.xlsx");
});

// ---------- Códigos CIE-10 (igual que importador.js) ----------
function normalizarCodigoCie10(texto) {
  const limpio = texto.toUpperCase().replace(/[.\s]/g, "");
  return limpio.length > 3 ? limpio.slice(0, 3) + "." + limpio.slice(3) : limpio;
}

function esCodigoCie10Valido(codigoNormalizado) {
  return /^[A-Z]\d{2}(\.[\dA-Z]{1,2})?$/.test(codigoNormalizado);
}

async function resolverEtiquetasCie10(codigos) {
  const catalogo = await cargarCie10();
  const etiquetas = new Map();
  const noEncontrados = [];

  codigos.forEach((codigo) => {
    const nombre = catalogo[codigo];
    if (nombre) {
      etiquetas.set(codigo, `${codigo} - ${nombre}`);
    } else {
      etiquetas.set(codigo, codigo);
      noEncontrados.push(codigo);
    }
  });

  return { etiquetas, noEncontrados };
}

// ---------- Validación por fila ----------
function parseFecha(fechaTexto, horaTexto) {
  let iso = null;
  const isoMatch = fechaTexto.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const latMatch = fechaTexto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (isoMatch) iso = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  else if (latMatch) iso = `${latMatch[3]}-${latMatch[2].padStart(2, "0")}-${latMatch[1].padStart(2, "0")}`;
  if (!iso) return null;

  const fecha = new Date(`${iso}T${horaTexto || "12:00"}:00`);
  return Number.isNaN(fecha.getTime()) ? null : { iso, fecha };
}

function crearLectorCeldas(celdas, indices) {
  return (col) => {
    if (indices[col] < 0) return "";
    const celda = celdas[indices[col]];
    return celda === undefined || celda === null ? "" : String(celda).trim();
  };
}

function limpiarDni(valorDni) {
  return valorDni.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function esDniValido(dniLimpio) {
  return /^[A-Z0-9]{8,12}$/.test(dniLimpio);
}

function claveHora(hora) {
  return (hora || "1200").replace(":", "");
}

function validarFila(celdas, indices, numeroFila) {
  const valor = crearLectorCeldas(celdas, indices);

  const dni = limpiarDni(valor("dni"));
  if (!esDniValido(dni)) {
    return { error: `Fila ${numeroFila}: documento inválido ("${valor("dni")}"). Debe tener de 8 a 12 letras/números.` };
  }

  const nombre = valor("nombre");
  if (!nombre) {
    return { error: `Fila ${numeroFila}: falta el nombre.` };
  }

  const empresa = valor("empresa");
  if (!empresa) {
    return { error: `Fila ${numeroFila}: falta la empresa.` };
  }

  const horaMatch = valor("hora").match(/(\d{1,2}):(\d{2})/);
  const hora = horaMatch ? `${horaMatch[1].padStart(2, "0")}:${horaMatch[2]}` : "";

  const fechaParseada = parseFecha(valor("fecha"), hora);
  if (!fechaParseada) return { error: `Fila ${numeroFila}: fecha inválida ("${valor("fecha")}"). Usa AAAA-MM-DD o DD/MM/AAAA.` };

  const prioridadTexto = valor("prioridad").toLowerCase();
  if (prioridadTexto && !PRIORIDADES[prioridadTexto]) {
    return { error: `Fila ${numeroFila}: prioridad "${valor("prioridad")}" no válida (baja / media / alta).` };
  }

  const modalidadTexto = valor("modalidad").toLowerCase();
  if (modalidadTexto && !MODALIDADES_ALIAS[modalidadTexto]) {
    return { error: `Fila ${numeroFila}: modalidad "${valor("modalidad")}" no válida (presencial / virtual / llamada).` };
  }

  const aptitudTexto = valor("aptitud").toLowerCase();
  if (aptitudTexto && !APTITUDES[aptitudTexto]) {
    return { error: `Fila ${numeroFila}: aptitud "${valor("aptitud")}" no válida (apto / restricciones / no_apto).` };
  }

  const derivacionTexto = normalizarTexto(valor("derivacion"));
  if (derivacionTexto && !derivacionesValidas[derivacionTexto]) {
    return {
      error: `Fila ${numeroFila}: derivación "${valor("derivacion")}" no válida (${Object.values(derivacionesValidas).join(" / ")}).`
    };
  }

  const codigosDiagnostico = valor("diagnosticos").split(";").map((c) => c.trim()).filter(Boolean);
  const diagnosticos = [];
  for (const crudo of codigosDiagnostico) {
    const codigo = normalizarCodigoCie10(crudo);
    if (!esCodigoCie10Valido(codigo)) {
      return { error: `Fila ${numeroFila}: "${crudo}" no parece un código CIE-10 (ej.: F41.1 o F411).` };
    }
    diagnosticos.push({ codigo, label: codigo });
  }

  const accionesTexto = valor("acciones").split(";").map((a) => a.trim()).filter(Boolean);
  const acciones = [];
  for (const cruda of accionesTexto) {
    const canonica = accionesValidas[normalizarTexto(cruda)];
    if (!canonica) {
      return {
        error: `Fila ${numeroFila}: acción "${cruda}" no válida (${Object.values(accionesValidas).join(" / ")}).`
      };
    }
    acciones.push(canonica);
  }

  const riesgo = ["si", "sí", "1", "true"].includes(valor("riesgo").toLowerCase());

  return {
    registro: {
      dni,
      fechaISO: fechaParseada.iso,
      horaISO: claveHora(hora),
      data: {
        nombre,
        empresa,
        area: valor("area"),
        cargo: valor("cargo"),
        riesgo,
        prioridad: PRIORIDADES[prioridadTexto] || "medium",
        modalidad: MODALIDADES_ALIAS[modalidadTexto] || null,
        frecuencia: valor("frecuencia"),
        motivoConsulta: valor("motivo"),
        observaciones: valor("observaciones"),
        recomendaciones: valor("recomendaciones"),
        evolucion: valor("evolucion"),
        aptitud: APTITUDES[aptitudTexto] || null,
        derivacion: derivacionTexto ? derivacionesValidas[derivacionTexto] : "No requerida",
        diagnosticos,
        accionesRealizadas: acciones,
        resultadosPruebas: valor("resultados"),
        importado: true,
        fecha: fechaParseada.iso,
        hora: hora || null,
        registradoEn: Timestamp.fromDate(fechaParseada.fecha)
      }
    },
    advertencias: []
  };
}

// ---------- Lectura y validación del archivo ----------
importFile.addEventListener("change", () => {
  const archivo = importFile.files[0];
  if (!archivo || !sheetJsDisponible()) return;

  const lector = new FileReader();
  lector.onload = async () => {
    let filas;
    try {
      const libro = XLSX.read(lector.result, { type: "array", cellDates: false });
      const nombreHoja = libro.SheetNames.includes("Contratas") ? "Contratas" : libro.SheetNames[0];
      filas = XLSX.utils.sheet_to_json(libro.Sheets[nombreHoja], { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" });
    } catch (err) {
      console.error("Error al leer el archivo:", err);
      mostrarEstado("No se pudo leer el archivo. ¿Es un Excel (.xlsx) o CSV válido?", true);
      return;
    }

    importErrors.innerHTML = "";
    importErrors.classList.add("hidden");
    importBtn.classList.add("hidden");
    registrosValidos = [];

    const filasConDatos = filas.filter((fila) => fila.some((celda) => String(celda).trim() !== ""));
    if (filasConDatos.length < 2) {
      mostrarEstado("El archivo no tiene filas de datos.", true);
      return;
    }

    const encabezados = filasConDatos[0].map((h) => String(h).trim().toLowerCase());
    const indices = {};
    COLUMNAS.forEach((col) => {
      indices[col] = encabezados.indexOf(col);
    });

    if (indices.dni < 0 || indices.fecha < 0 || indices.nombre < 0 || indices.empresa < 0) {
      mostrarEstado('El encabezado debe incluir al menos "dni", "nombre", "empresa" y "fecha" (usa la hoja "Contratas" de la plantilla).', true);
      return;
    }

    const catalogosVigentes = await obtenerCatalogos();
    derivacionesValidas = construirMapaCatalogo(catalogosVigentes.derivaciones);
    accionesValidas = construirMapaCatalogo(catalogosVigentes.acciones);

    const errores = [];
    const advertencias = [];
    for (let i = 1; i < filasConDatos.length; i++) {
      const resultado = validarFila(filasConDatos[i], indices, i + 1);
      if (resultado.error) {
        errores.push(resultado.error);
        continue;
      }
      registrosValidos.push(resultado.registro);
      if (resultado.advertencias && resultado.advertencias.length) advertencias.push(...resultado.advertencias);
    }

    const codigosUnicos = Array.from(new Set(registrosValidos.flatMap((r) => r.data.diagnosticos.map((d) => d.codigo))));
    if (codigosUnicos.length > 0) {
      const { etiquetas, noEncontrados } = await resolverEtiquetasCie10(codigosUnicos);
      registrosValidos.forEach((r) => {
        r.data.diagnosticos.forEach((d) => {
          d.label = etiquetas.get(d.codigo) || d.codigo;
        });
      });
      if (noEncontrados.length > 0) {
        advertencias.push(
          `Los códigos "${noEncontrados.join('", "')}" no están en el catálogo CIE-10 local (data/cie10.json) — se guardaron solo con el código, sin nombre.`
        );
      }
    }

    if (errores.length > 0) {
      importErrors.classList.remove("hidden");
      errores.slice(0, 15).forEach((e) => {
        const p = document.createElement("p");
        p.textContent = e;
        importErrors.appendChild(p);
      });
      if (errores.length > 15) {
        const p = document.createElement("p");
        p.textContent = `…y ${errores.length - 15} errores más.`;
        importErrors.appendChild(p);
      }
    }

    if (importWarnings) {
      importWarnings.innerHTML = "";
      if (advertencias.length > 0) {
        importWarnings.classList.remove("hidden");
        advertencias.slice(0, 15).forEach((a) => {
          const p = document.createElement("p");
          p.textContent = a;
          importWarnings.appendChild(p);
        });
      } else {
        importWarnings.classList.add("hidden");
      }
    }

    if (registrosValidos.length > 0) {
      const detalles = [];
      if (errores.length) detalles.push(`${errores.length} filas con error serán ignoradas`);
      if (advertencias.length) detalles.push(`${advertencias.length} con avisos (revisa abajo)`);
      mostrarEstado(`${registrosValidos.length} registros listos para importar` + (detalles.length ? ` (${detalles.join("; ")}).` : "."), false);
      importBtn.textContent = `Importar ${registrosValidos.length} registros`;
      importBtn.classList.remove("hidden");
    } else {
      mostrarEstado("Ninguna fila pasó la validación. Corrige los errores y vuelve a subir el archivo.", true);
    }
  };
  lector.readAsArrayBuffer(archivo);
});

function mostrarEstado(mensaje, esError) {
  importStatus.textContent = mensaje;
  importStatus.className = "text-body-md font-semibold " + (esError ? "text-error" : "text-primary");
  importStatus.classList.remove("hidden");
}

// ---------- Escritura por lotes (colección plana, ID determinístico) ----------
importBtn.addEventListener("click", async () => {
  if (registrosValidos.length === 0) return;

  importBtn.disabled = true;
  const LOTE = 400;

  try {
    const secuencia = new Map();
    for (let inicio = 0; inicio < registrosValidos.length; inicio += LOTE) {
      const grupo = registrosValidos.slice(inicio, inicio + LOTE);
      const batch = writeBatch(dbPsico);

      grupo.forEach((registro) => {
        const clave = `${registro.dni}-${registro.fechaISO}-${registro.horaISO}`;
        const n = (secuencia.get(clave) || 0) + 1;
        secuencia.set(clave, n);
        const idDoc = `${clave}-${n}`;
        batch.set(doc(dbPsico, CONTRATAS_COLLECTION, idDoc), { dni: registro.dni, ...registro.data });
      });

      mostrarEstado(`Importando… ${Math.min(inicio + LOTE, registrosValidos.length)} de ${registrosValidos.length}`, false);
      await batch.commit();
    }

    mostrarEstado(`Importación completa: ${registrosValidos.length} registros guardados. Actualizando directorio…`, false);
    importBtn.classList.add("hidden");
    importFile.value = "";
    registrosValidos = [];
    window.dispatchEvent(new Event("contratas-importado"));
  } catch (err) {
    console.error("Error al importar Contratas:", err);
    mostrarEstado("Error al importar: " + (err.message || "revisa la consola."), true);
  } finally {
    importBtn.disabled = false;
  }
});
