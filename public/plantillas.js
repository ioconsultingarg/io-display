// Plantillas de zonas: la "cuadrícula" de cada pantalla.
// Lo usan el servidor (para validar), el admin (para elegir) y la TV (para dibujar).

// Qué puede mostrar una zona
export const TIPOS = {
  mixto: { nombre: "Noticias y avisos intercalados", rota: true },
  noticias: { nombre: "Solo noticias", rota: true },
  avisos: { nombre: "Solo avisos propios", rota: true },
  cola: { nombre: "A continuación (lo que viene en la principal)", rota: false },
  titulares: { nombre: "Titulares que corren", rota: false },
  fuentes: { nombre: "Fuentes citadas y progreso", rota: false },
};

const GRANDE = ["mixto", "noticias", "avisos"];
const LATERAL = ["cola", "avisos", "noticias", "mixto"];
const BARRA = ["fuentes", "titulares"];

export const PLANTILLAS = {
  tablero: {
    nombre: "Tablero",
    descripcion: "Principal, columna lateral y barra inferior.",
    orientacion: "horizontal",
    zonas: {
      principal: { nombre: "Principal", tipos: GRANDE, defecto: "mixto" },
      lateral: { nombre: "Columna lateral", tipos: LATERAL, defecto: "cola" },
      barra: { nombre: "Barra inferior", tipos: BARRA, defecto: "fuentes" },
    },
  },
  completa: {
    nombre: "Pantalla completa",
    descripcion: "Un solo contenido a toda la pantalla.",
    orientacion: "horizontal",
    zonas: {
      principal: { nombre: "Principal", tipos: GRANDE, defecto: "mixto" },
    },
  },
  "principal-barra": {
    nombre: "Principal con barra",
    descripcion: "Contenido grande y una barra de titulares abajo.",
    orientacion: "horizontal",
    zonas: {
      principal: { nombre: "Principal", tipos: GRANDE, defecto: "mixto" },
      barra: { nombre: "Barra inferior", tipos: BARRA, defecto: "titulares" },
    },
  },
  cuadricula: {
    nombre: "Cuadrícula 2×2",
    descripcion: "Cuatro contenidos a la vez.",
    orientacion: "horizontal",
    zonas: {
      z1: { nombre: "Arriba a la izquierda", tipos: GRANDE, defecto: "noticias" },
      z2: { nombre: "Arriba a la derecha", tipos: GRANDE, defecto: "avisos" },
      z3: { nombre: "Abajo a la izquierda", tipos: GRANDE, defecto: "avisos" },
      z4: { nombre: "Abajo a la derecha", tipos: GRANDE, defecto: "noticias" },
    },
  },
  vertical: {
    nombre: "Vertical (tótem)",
    descripcion: "Para pantallas paradas: principal arriba, lista y barra abajo.",
    orientacion: "vertical",
    zonas: {
      principal: { nombre: "Principal", tipos: GRANDE, defecto: "mixto" },
      lateral: { nombre: "Lista de abajo", tipos: LATERAL, defecto: "cola" },
      barra: { nombre: "Barra inferior", tipos: BARRA, defecto: "titulares" },
    },
  },
};

export function zonasPorDefecto(plantilla) {
  const p = PLANTILLAS[plantilla] || PLANTILLAS.tablero;
  return Object.fromEntries(Object.entries(p.zonas).map(([k, z]) => [k, z.defecto]));
}
