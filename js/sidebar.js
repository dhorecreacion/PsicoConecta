// Sidebar de navegación única para las vistas del psicólogo (V3-V9).
// Cada página solo declara <div id="sidebar-root" data-active="clave"></div>;
// este script arma el mismo menú en todas para que no queden versiones
// distintas (items, orden o estilos) por archivo.
//
// En pantallas chicas (< lg) el sidebar queda oculto fuera de pantalla y se
// abre con el botón hamburguesa (ver #app-sidebar / .sidebar-open en
// css/common.css); desde lg siempre está visible, como antes.
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

var NAV_ITEMS = [
  { key: "agenda", label: "Agenda del día", href: "agenda.html", icon: "calendar_today" },
  { key: "pacientes", label: "Consultantes", href: "pacientes.html", icon: "groups" },
  { key: "contratas", label: "Contratas", href: "contratas.html", icon: "apartment" },
  { key: "disponibilidad", label: "Mi Disponibilidad", href: "disponibilidad.html", icon: "event_available" },
  { key: "indicadores", label: "Indicadores", href: "indicadores.html", icon: "analytics" },
  { key: "configuracion", label: "Configuración", href: "configuracion.html", icon: "settings" }
];

var ACTIVE_CLASSES = "flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 border-secondary bg-secondary/10 text-on-primary font-semibold transition-all";
var INACTIVE_CLASSES = "flex items-center gap-3 px-3 py-2.5 rounded-lg text-on-primary/70 hover:text-on-primary hover:bg-primary-fixed-variant/20 transition-colors";

function navLinkHtml(item, activeKey) {
  var classes = item.key === activeKey ? ACTIVE_CLASSES : INACTIVE_CLASSES;
  return (
    '<a href="' + item.href + '" class="' + classes + '" title="' + item.label + '">' +
      '<span class="material-symbols-outlined text-[20px] flex-shrink-0">' + item.icon + "</span>" +
      '<span class="font-body-md text-body-md sidebar-label">' + item.label + "</span>" +
    "</a>"
  );
}

// ---------- Contraer/expandir (solo aplica desde el breakpoint lg — en
// móvil el sidebar sigue siendo un drawer que se abre completo). El estado
// se guarda en localStorage para que no vuelva a expandirse al navegar a
// otra página del sistema (cada página carga sidebar.js de cero). ----------
var SIDEBAR_COLLAPSE_KEY = "sidebarColapsado";

function sidebarColapsado() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function aplicarEstadoColapsado(colapsado) {
  document.documentElement.classList.toggle("sidebar-collapsed", colapsado);
}

// Se aplica ya, antes de esperar a DOMContentLoaded (este módulo se ejecuta
// diferido, justo después de parsear el HTML), para minimizar el parpadeo
// de un sidebar expandido que luego se contrae.
aplicarEstadoColapsado(sidebarColapsado());

function abrirSidebar() {
  document.getElementById("app-sidebar").classList.add("sidebar-open");
  document.getElementById("sidebar-backdrop").classList.remove("hidden");
}

function cerrarSidebar() {
  document.getElementById("app-sidebar").classList.remove("sidebar-open");
  document.getElementById("sidebar-backdrop").classList.add("hidden");
}

function renderSidebar() {
  var root = document.getElementById("sidebar-root");
  if (!root) return;

  var activeKey = root.getAttribute("data-active") || "";
  var links = NAV_ITEMS.map(function (item) {
    return navLinkHtml(item, activeKey);
  }).join("");
  var colapsado = sidebarColapsado();

  root.outerHTML =
    // Botón hamburguesa: solo visible antes de "lg", abre el sidebar.
    '<button type="button" id="sidebar-open-btn" class="lg:hidden fixed top-3 left-3 z-[60] p-2 rounded-full bg-primary text-on-primary shadow-lg">' +
      '<span class="material-symbols-outlined">menu</span>' +
    "</button>" +
    // Fondo oscuro detrás del sidebar cuando está abierto en móvil.
    '<div id="sidebar-backdrop" class="hidden lg:hidden fixed inset-0 bg-black/40 z-40"></div>' +
    '<aside id="app-sidebar" class="fixed left-0 top-0 h-full w-[240px] lg:w-[var(--sidebar-w)] bg-primary flex flex-col py-gutter px-4 border-r border-outline-variant z-50 overflow-x-hidden">' +
      '<div class="sidebar-header mb-8 px-2 flex items-center justify-between gap-2">' +
        '<h1 class="font-headline-md text-headline-md font-bold text-on-primary tracking-tight sidebar-label truncate">Psicología Ocupacional</h1>' +
        '<button type="button" id="sidebar-close-btn" class="lg:hidden flex-shrink-0 p-1 text-on-primary/70 hover:text-on-primary">' +
          '<span class="material-symbols-outlined">close</span>' +
        "</button>" +
        '<button type="button" id="sidebar-collapse-btn" class="hidden lg:flex flex-shrink-0 p-1 rounded-full text-on-primary/70 hover:text-on-primary hover:bg-primary-fixed-variant/20 transition-colors" title="' +
          (colapsado ? "Expandir menú" : "Contraer menú") +
        '">' +
          '<span class="material-symbols-outlined text-[20px]" id="sidebar-collapse-icon">' + (colapsado ? "chevron_right" : "chevron_left") + "</span>" +
        "</button>" +
      "</div>" +
      '<nav class="flex-1 space-y-1">' + links + "</nav>" +
      '<div class="sidebar-footer mt-auto pt-4 border-t border-on-primary/10 space-y-1">' +
        '<a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-on-primary/70 hover:text-on-primary transition-colors" id="sidebar-logout-link" title="Cerrar Sesión">' +
          '<span class="material-symbols-outlined text-[20px] flex-shrink-0">logout</span>' +
          '<span class="font-body-md sidebar-label">Cerrar Sesión</span>' +
        "</a>" +
      "</div>" +
    "</aside>";

  document.getElementById("sidebar-open-btn").addEventListener("click", abrirSidebar);
  document.getElementById("sidebar-close-btn").addEventListener("click", cerrarSidebar);
  document.getElementById("sidebar-backdrop").addEventListener("click", cerrarSidebar);

  document.getElementById("sidebar-collapse-btn").addEventListener("click", function () {
    var nuevoEstado = !sidebarColapsado();
    aplicarEstadoColapsado(nuevoEstado);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, nuevoEstado ? "1" : "0");
    } catch (err) {
      console.warn("No se pudo guardar la preferencia del sidebar:", err);
    }
    this.title = nuevoEstado ? "Expandir menú" : "Contraer menú";
    document.getElementById("sidebar-collapse-icon").textContent = nuevoEstado ? "chevron_right" : "chevron_left";
  });

  // Al navegar a otra vista desde el menú (en móvil), no hace falta cerrar
  // a mano: la página siguiente arranca con el sidebar cerrado de nuevo.

  document.getElementById("sidebar-logout-link").addEventListener("click", async function (e) {
    e.preventDefault();
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
    }
    window.location.href = "index.html";
  });
}

document.addEventListener("DOMContentLoaded", renderSidebar);
