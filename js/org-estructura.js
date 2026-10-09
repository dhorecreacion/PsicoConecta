// Catálogo de Áreas de la organización (data/org-estructura.json): lista de
// { Direccion, Area, Seccion }. Para Contratas solo se usa el campo "Area"
// (lista cerrada de valores válidos para el campo "area" de cada registro) —
// a diferencia de MIBSAC, donde el área viene de la ficha social, en
// Contratas se escribe a mano (al importar o al editar), así que debe quedar
// restringida a este diccionario en vez de texto libre.
// Se carga una sola vez por página y se cachea en memoria, igual que cie10.js.
let areasPromise = null;

export function cargarAreas() {
  if (!areasPromise) {
    areasPromise = fetch("data/org-estructura.json")
      .then((resp) => {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      })
      .then((filas) => {
        const areas = new Set();
        (filas || []).forEach((fila) => {
          if (fila && fila.Area) areas.add(fila.Area);
        });
        return Array.from(areas).sort((a, b) => a.localeCompare(b, "es"));
      })
      .catch((err) => {
        console.error("No se pudo cargar el catálogo de áreas (data/org-estructura.json):", err);
        return [];
      });
  }
  return areasPromise;
}
