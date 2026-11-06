// Firebase para el registro público inicial (V1 - index.html).
// Proyecto separado de firebase-config.js a propósito: la pantalla pública no
// autentica al trabajador, así que solo debe poder ESCRIBIR su DNI aquí. Los
// datos clínicos completos viven en el proyecto de firebase-config.js, que
// solo se lee desde las vistas del psicólogo (ya autenticado).
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  collectionGroup,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FB_PSICO_APP_NAME = "fb-psico";

const firebaseConfig = {
  apiKey: "AIzaSyC30C6vUPz7UJ9iSXXnmbbKIfHhf010fkk",
  authDomain: "conspsico-239e5.firebaseapp.com",
  projectId: "conspsico-239e5",
  storageBucket: "conspsico-239e5.firebasestorage.app",
  messagingSenderId: "605935156966",
  appId: "1:605935156966:web:54cda894a37849112b8527"
};

const app = getApps().some((a) => a.name === FB_PSICO_APP_NAME)
  ? getApp(FB_PSICO_APP_NAME)
  : initializeApp(firebaseConfig, FB_PSICO_APP_NAME);

export const dbPsico = getFirestore(app);
export const PACIENTES_COLLECTION = "pacientes";
export const DISPONIBILIDAD_COLLECTION = "disponibilidad";
export const HISTORIAL_CITAS_SUBCOLLECTION = "historial_citas";

// ---------- Citas (reservas) por fecha/hora ----------
// Antes pacientes/{dni} era UN SOLO documento con "la reserva vigente" de esa
// persona — se sobreescribía con cada reserva nueva. Eso rompía un caso real:
// reservar una cita para el colaborador Y otra para su familiar (que no tiene
// DNI propio, así que usa el mismo documento) el mismo día: la segunda
// pisaba a la primera sin aviso. Ahora cada cita es su propio documento en
// pacientes/{dni}/citas/{citaId}, así un mismo DNI puede tener varias citas
// vigentes a la vez. El documento pacientes/{dni} en sí ya no se usa para
// nada — sigue existiendo en Firestore por los datos viejos (ver
// fetchTodasLasCitas), pero ninguna vista nueva lo lee ni le escribe.
export const CITAS_SUBCOLLECTION = "citas";

// De varias citas de un mismo DNI, elige la más relevante para mostrarla
// como "la cita de esta persona": la pendiente (reservada/reprogramada) más
// próxima, o si no hay ninguna pendiente, la más reciente en general — para
// no dejar vacía una vista que solo puede mostrar una. Usado por
// pacientes.js (directorio, "próxima cita") y atencion.js (cuando no se
// sabe exactamente cuál cita se quiere, ej. la alerta de riesgo solo conoce
// el DNI, no un citaId puntual).
export function elegirCitaRepresentativa(citas) {
  if (!citas || citas.length === 0) return null;
  const ordenadas = citas
    .slice()
    .sort((a, b) => `${a.data.fecha || ""}${a.data.hora || ""}`.localeCompare(`${b.data.fecha || ""}${b.data.hora || ""}`));
  const pendientes = ordenadas.filter((c) => c.data.estado === "reservada" || c.data.estado === "reprogramada");
  return pendientes.length > 0 ? pendientes[0] : ordenadas[ordenadas.length - 1];
}

// Todas las citas de todos los DNIs (agenda.js, pacientes.js), con su DNI y
// su citaId — necesarios para poder actualizar/reprogramar la cita correcta
// cuando una persona tiene más de una. La primera vez que se llama tras este
// cambio, migra en silencio (sin borrar nada) los documentos pacientes/{dni}
// viejos que todavía tengan una reserva (fecha+hora) y no se hayan migrado
// todavía — así ninguna cita que ya estaba vigente antes de este cambio
// desaparece de la agenda.
export async function fetchTodasLasCitas() {
  const citasSnap = await getDocs(collectionGroup(dbPsico, CITAS_SUBCOLLECTION));
  const citas = citasSnap.docs.map((d) => ({ dni: d.ref.parent.parent.id, citaId: d.id, data: d.data() }));

  const dnisConCitaNueva = new Set(citas.map((c) => c.dni));
  const pacientesSnap = await getDocs(collection(dbPsico, PACIENTES_COLLECTION));
  const porMigrar = [];
  pacientesSnap.forEach((d) => {
    const data = d.data();
    if (!data.fecha || !data.hora || dnisConCitaNueva.has(d.id)) return;
    porMigrar.push({ dni: d.id, data });
  });

  if (porMigrar.length === 0) return citas;

  await Promise.all(
    porMigrar.map(({ dni, data }) => addDoc(collection(dbPsico, PACIENTES_COLLECTION, dni, CITAS_SUBCOLLECTION), data))
  );
  const citasSnap2 = await getDocs(collectionGroup(dbPsico, CITAS_SUBCOLLECTION));
  return citasSnap2.docs.map((d) => ({ dni: d.ref.parent.parent.id, citaId: d.id, data: d.data() }));
}
// Ajustes generales del sistema, editables desde configuracion.html:
// configuracion/general (umbralSeguimientoDias) y configuracion/catalogos
// (derivaciones, acciones) — ver js/configuracion.js.
export const CONFIGURACION_COLLECTION = "configuracion";
// Estado de "caso" por DNI (cerrado manualmente por el psicólogo, ej. el
// trabajador ya no necesita seguimiento) — independiente de las citas y
// sesiones de ese DNI. Si no existe el documento, el caso se considera
// abierto. Usado por pacientes.js, atencion.js e indicadores.js (para
// "Casos Activos").
export const CASOS_COLLECTION = "casos";
export const DIAS_SEMANA = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

// ---------- Disponibilidad: mes en curso + 2 siguientes ----------
// Cuántos meses hacia adelante (incluido el actual) se configuran fecha por
// fecha en disponibilidad.html — ver DISPONIBILIDAD_FECHAS_COLLECTION más
// abajo. Cualquier mes fuera de este rango (histórico, o más adelante) usa
// fetchDisponibilidadPlantillaVieja() como aproximación en indicadores.js.
export const DISPONIBILIDAD_MESES_CONFIGURABLES = 3; // mes en curso + 2 siguientes

export function claveMes(anio, mes) {
  // mes: 0-11, igual que Date.getMonth().
  return `${anio}-${String(mes + 1).padStart(2, "0")}`;
}

// La plantilla semanal vieja (de la primera versión del sistema, antes de la
// disponibilidad por fecha exacta) — respaldo/aproximación para indicadores.js
// en cualquier mes fuera de los 3 configurables.
export async function fetchDisponibilidadPlantillaVieja() {
  const snapshots = await Promise.all(DIAS_SEMANA.map((dia) => getDoc(doc(dbPsico, DISPONIBILIDAD_COLLECTION, dia))));
  const resultado = {};
  DIAS_SEMANA.forEach((dia, i) => {
    resultado[dia] = snapshots[i].exists() ? snapshots[i].data().bloques || [] : [];
  });
  return resultado;
}

// ---------- Disponibilidad por fecha exacta (reemplaza la plantilla semanal) ----------
// Cada fecha configurable (mes en curso + 2 siguientes) es un doc propio,
// independiente de sus vecinas: "2026-09-16" puede tener bloques distintos
// de "2026-09-23" aunque ambos sean lunes, y una fecha sin doc (o con
// bloques: []) simplemente no es reservable — así se cubre tanto vacaciones
// (no configurar esa semana) como horarios que cambian de una semana a otra,
// sin una plantilla que se repita. El ID del doc es la fecha ISO
// ("AAAA-MM-DD"), y también se guarda en el campo "fecha" para poder hacer
// consultas por rango (fetchDisponibilidadRango).
export const DISPONIBILIDAD_FECHAS_COLLECTION = "disponibilidad_fechas";

// Trae solo las fechas que SÍ tienen doc dentro de [fechaInicioISO, fechaFinISO]
// (ambos incluidos). Devuelve un Map<fechaISO, bloques[]>; una fecha ausente
// del Map no tiene bloques configurados (no reservable).
export async function fetchDisponibilidadRango(fechaInicioISO, fechaFinISO) {
  const q = query(
    collection(dbPsico, DISPONIBILIDAD_FECHAS_COLLECTION),
    where("fecha", ">=", fechaInicioISO),
    where("fecha", "<=", fechaFinISO)
  );
  const snapshot = await getDocs(q);
  const resultado = new Map();
  snapshot.forEach((docSnap) => {
    resultado.set(docSnap.id, docSnap.data().bloques || []);
  });
  return resultado;
}

// Trae los bloques de UNA fecha puntual (agenda.js: modales de Reprogramar /
// Nueva Cita, donde solo hace falta consultar el día ya elegido).
export async function fetchDisponibilidadFecha(fechaISO) {
  const snap = await getDoc(doc(dbPsico, DISPONIBILIDAD_FECHAS_COLLECTION, fechaISO));
  return snap.exists() ? snap.data().bloques || [] : [];
}

// ---------- Contratas ----------
// Sistema separado de MIBSAC: personal de empresas contratistas, atendido
// solo mediante carga mensual de Excel (contratas.html / js/importador-
// contratas.js) — sin reserva pública, sin agenda, sin ficha externa de
// firebase-config.js (la identidad de cada persona viene del propio Excel).
// "contratas_registros" es una colección plana (no anidada bajo un doc por
// DNI, porque no existe un doc "vigente" tipo pacientes/{dni} que sobreescribir):
// cada documento es una fila importada (una atención). "contratas_casos"
// espeja "casos" (cerrar/reabrir a mano), mismo criterio.
export const CONTRATAS_COLLECTION = "contratas_registros";
export const CONTRATAS_CASOS_COLLECTION = "contratas_casos";

// ---------- Casos: requiere seguimiento / activo por inactividad ----------
// Compartido por MIBSAC (indicadores.js/pacientes.js, última SESIÓN) y
// Contratas (contratas.js/indicadores-contratas.js, último REGISTRO
// importado) — ambos guardan "riesgo"/"aptitud" con el mismo vocabulario.
// Un caso "requiere seguimiento" si quedó con riesgo o aptitud restringida/
// no apta: estos nunca se cierran solos por inactividad, necesitan que el
// psicólogo los revise y cierre a mano.
export function requiereSeguimientoPorRiesgoOAptitud(ultima) {
  return !!(ultima && (ultima.riesgo || ultima.aptitud === "restricciones" || ultima.aptitud === "no_apto"));
}
export const requiereSeguimientoContratas = requiereSeguimientoPorRiesgoOAptitud;

// Activo = no cerrado a mano, Y si no requiere seguimiento, con actividad
// (última atención o última reapertura manual) dentro del umbral de días de
// Configuración. Pasado ese plazo, un caso normal (sin riesgo/restricciones)
// se considera cerrado automáticamente SIN escribir nada en Firestore: en
// cuanto llega una atención nueva o se reabre a mano, vuelve a contar como
// activo por otro período completo. Recibe fechas ya resueltas (Date, no
// Timestamp) porque cada colección guarda su "última actividad" bajo un
// nombre de campo distinto (registradoEn en Contratas, guardadoEn en
// sesiones de MIBSAC).
export function esCasoActivoPorInactividad(requiereSeguimiento, fechaUltimaActividad, fechaReapertura, cerradoManual, umbralSeguimientoDias, ahora) {
  if (cerradoManual === true) return false;
  if (requiereSeguimiento) return true;

  const referencias = [fechaUltimaActividad, fechaReapertura].filter(Boolean);
  if (referencias.length === 0) return true;

  const masReciente = new Date(Math.max(...referencias.map((d) => d.getTime())));
  const dias = Math.floor((ahora - masReciente) / (1000 * 60 * 60 * 24));
  return dias <= umbralSeguimientoDias;
}

function timestampADate(timestamp) {
  return timestamp && typeof timestamp.toDate === "function" ? timestamp.toDate() : null;
}

// Usado por contratas.js (directorio) e indicadores-contratas.js (KPIs),
// para que ambos coincidan siempre en qué casos están activos.
export function esCasoActivoContratas(ultima, infoCaso, umbralSeguimientoDias, ahora) {
  return esCasoActivoPorInactividad(
    requiereSeguimientoPorRiesgoOAptitud(ultima),
    timestampADate(ultima && ultima.registradoEn),
    timestampADate(infoCaso && infoCaso.reabiertoEn),
    !!(infoCaso && infoCaso.cerrado === true),
    umbralSeguimientoDias,
    ahora
  );
}

// Equivalente de MIBSAC: además se cierra de inmediato (sin importar
// actividad reciente) si la ficha de personal ya no está activa (ej.
// cesado) — Contratas no tiene este caso porque no depende de una ficha
// externa. Usado por indicadores.js (KPIs) y pacientes.js (directorio).
export function esCasoActivoMIBSAC(ultimaSesion, ficha, infoCaso, umbralSeguimientoDias, ahora) {
  if (ficha && ficha.activo === false) return false;
  return esCasoActivoPorInactividad(
    requiereSeguimientoPorRiesgoOAptitud(ultimaSesion),
    timestampADate(ultimaSesion && ultimaSesion.guardadoEn),
    timestampADate(infoCaso && infoCaso.reabiertoEn),
    !!(infoCaso && infoCaso.cerrado === true),
    umbralSeguimientoDias,
    ahora
  );
}

// Registra un evento inmutable del ciclo de vida de una cita (reservada,
// no_asistio, reprogramada, atendida) — a diferencia de pacientes/{dni}/citas
// (que refleja el estado actual de cada cita puntual y se actualiza en el
// mismo documento), esto acumula un historial real que nunca se pisa, para
// poder calcular indicadores de tendencia (ej. % de asistencia) sin depender
// solo del estado actual. Se llama desde index.js (reservada), agenda.js
// (no_asistio/reprogramada) y atencion.js (atendida); si falla, no debe
// bloquear la acción principal (ya se guardó lo importante en la cita),
// solo se registra el error.
export async function registrarHistorialCita(dni, datos) {
  await addDoc(collection(dbPsico, PACIENTES_COLLECTION, dni, HISTORIAL_CITAS_SUBCOLLECTION), {
    ...datos,
    registradoEn: serverTimestamp()
  });
}

// Modalidades de atención (mismo vocabulario en disponibilidad, reserva,
// agenda e indicadores). "emergencia" existe solo como bloqueo de agenda,
// nunca como cita reservable.
export const MODALIDADES = {
  presencial: { label: "Presencial", icon: "domain" },
  virtual: { label: "Video", icon: "videocam" },
  llamada: { label: "Llamada telefónica", icon: "call" }
};

// Motivos de inasistencia/reprogramación: catálogo fijo (no editable desde
// Configuración, a diferencia de Derivación/Acciones). Compartido por
// agenda.js (selects de los modales "No Asistió"/"Reprogramar") e
// importador.js (columna "motivo" de las filas tipo=cita de la plantilla).
export const MOTIVOS_INASISTENCIA = [
  "Motivos laborales",
  "Motivos de salud",
  "Motivos familiares",
  "Motivos personales",
  "Problemas de conectividad/comunicación",
  "Confusión con el horario",
  "Olvidó su cita",
  "No contestó",
  "Otros"
];
