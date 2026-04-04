export const OBJECTS = [
  { id: 1, name: "Licuadora", emoji: "\ud83e\udeda", category: "Cocina" },
  { id: 2, name: "Microondas", emoji: "\ud83d\udce1", category: "Cocina" },
  { id: 3, name: "Televisor", emoji: "\ud83d\udcfa", category: "Sala" },
  { id: 4, name: "Computadora", emoji: "\ud83d\udcbb", category: "Oficina" },
  { id: 5, name: "Celular", emoji: "\ud83d\udcf1", category: "Tecnolog\u00eda" },
  { id: 6, name: "Heladera", emoji: "\ud83e\uddca", category: "Cocina" },
  { id: 7, name: "Lavarropas", emoji: "\ud83e\udee7", category: "Lavadero" },
  { id: 8, name: "L\u00e1mpara", emoji: "\ud83d\udca1", category: "Sala" },
  { id: 9, name: "Silla", emoji: "\ud83e\ude91", category: "Comedor" },
  { id: 10, name: "Mesa", emoji: "\ud83e\udeb5", category: "Comedor" },
  { id: 11, name: "Cama", emoji: "\ud83d\udecf\ufe0f", category: "Dormitorio" },
  { id: 12, name: "Sof\u00e1", emoji: "\ud83d\udecb\ufe0f", category: "Sala" },
  { id: 13, name: "Horno", emoji: "\ud83d\udd25", category: "Cocina" },
  { id: 14, name: "Ventilador", emoji: "\ud83c\udf00", category: "Sala" },
  { id: 15, name: "Cafetera", emoji: "\u2615", category: "Cocina" },
  { id: 16, name: "Tostadora", emoji: "\ud83c\udf5e", category: "Cocina" },
  { id: 17, name: "Aspiradora", emoji: "\ud83e\uddf9", category: "Limpieza" },
  { id: 18, name: "Plancha", emoji: "\ud83d\udc54", category: "Lavadero" },
  { id: 19, name: "Radio", emoji: "\ud83d\udcfb", category: "Sala" },
  { id: 20, name: "Escritorio", emoji: "\ud83d\uddc4\ufe0f", category: "Oficina" },
];

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
