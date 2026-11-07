// Informes tipo carta con el membrete del cliente (ver los modelos en Materiales/).
// Solo se generan en el servidor porque llevan la firma, que no debe llegar a los navegadores.
// `marca` = { cabecera: Uint8Array JPEG, fondo: Uint8Array JPEG, firma: Uint8Array PNG }
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const TZ = "America/Bogota";
const X = 85, ANCHO = 442, ARRIBA = 100, ABAJO = 672, ALTO_LINEA = 14.5;
const OSCURO = [30, 30, 30], NARANJA = [237, 125, 49], AZUL = [5, 99, 193];

const t = (s) => String(s ?? "")
  .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, "...").replace(/[^\n\x20-\xFF]/g, "");

// Una fecha sin hora ("2026-10-19") se toma a mediodía UTC para que no cambie de día en Colombia
const aFecha = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`) : new Date(d));
export const dinero = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
export const numero = (n) => String(n).padStart(3, "0");
export const fechaISO = (d) => aFecha(d).toLocaleDateString("en-CA", { timeZone: TZ });
export const fechaCO = (d) => aFecha(d).toLocaleDateString("es-CO", { timeZone: TZ });
const fechaCarta = (d) => {
  const f = aFecha(d);
  const mes = f.toLocaleDateString("es-CO", { timeZone: TZ, month: "long" });
  const dia = f.toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric" });
  return `Medellín, ${mes} ${dia} de ${f.toLocaleDateString("es-CO", { timeZone: TZ, year: "numeric" })}`;
};
const nombreArchivo = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "");

function membrete({ doc, marca }) {
  doc.addImage(marca.fondo, "JPEG", 23, 123, 566, 552, "fondo");
  doc.addImage(marca.cabecera, "JPEG", 30, 22, 560, 56, "cabecera");
  doc.setDrawColor(...NARANJA).setLineWidth(1.2).line(62, 699, 578, 699);
  doc.setFont("times", "normal").setFontSize(10);
  doc.setTextColor(...AZUL).text("www.cprado2001.com", 146, 716);
  doc.setTextColor(...OSCURO).text("CELULAR 3117397041 - 3113808379", 260, 716);
  doc.text("Teléfono: 3431745    Calle 12 # 73 184", 259, 730);
  doc.text("Medellín Antioquia", 287, 744);
}

function nuevaCarta(marca) {
  const c = { doc: new jsPDF({ unit: "pt", format: "letter", compress: true }), marca, y: ARRIBA + 8 };
  membrete(c);
  return c;
}

function espacio(c, alto) {
  if (c.y + alto <= ABAJO) return;
  c.doc.addPage();
  membrete(c);
  c.y = ARRIBA + 8;
}

function parrafo(c, texto, { negrita = false, tam = 11, justificar = true, despues = 10 } = {}) {
  const { doc } = c;
  const fuente = () => doc.setFont("helvetica", negrita ? "bold" : "normal").setFontSize(tam).setTextColor(...OSCURO);
  fuente();
  t(texto).split(/\n+/).filter((p) => p.trim()).forEach((p) => {
    const lineas = doc.splitTextToSize(p.trim(), ANCHO);
    while (lineas.length) {
      espacio(c, ALTO_LINEA);
      fuente(); // el membrete de una página nueva cambia la fuente
      const caben = Math.max(1, Math.floor((ABAJO - c.y) / ALTO_LINEA));
      const tramo = lineas.splice(0, caben);
      if (justificar && tramo.length > 1) doc.text(tramo.join(" "), X, c.y + 10, { align: "justify", maxWidth: ANCHO, lineHeightFactor: ALTO_LINEA / tam });
      else tramo.forEach((l, i) => doc.text(l, X, c.y + 10 + i * ALTO_LINEA));
      c.y += tramo.length * ALTO_LINEA;
    }
  });
  c.y += despues;
}

function saludo(c, fecha, cop) {
  parrafo(c, fechaCarta(fecha), { justificar: false, despues: 18 });
  parrafo(c, "Señores.", { justificar: false, despues: 0 });
  parrafo(c, cop.nombre, { negrita: true, justificar: false, despues: 0 });
  if (cop.administrador) parrafo(c, `Administrador: ${cop.administrador}`, { justificar: false, despues: 0 });
  parrafo(c, "Ciudad.", { justificar: false, despues: 16 });
  parrafo(c, "Respetados Señores.", { justificar: false, despues: 10 });
}

function fotos(c, lista, leyenda) {
  const { doc } = c;
  const validas = lista.filter(Boolean);
  const anchoMax = validas.length === 1 ? 325 : 215, altoMax = validas.length === 1 ? 244 : 170, gap = 12;
  for (let i = 0; i < validas.length; i += 2) {
    const fila = validas.slice(i, validas.length === 1 ? i + 1 : i + 2).map((bytes) => {
      try {
        const p = doc.getImageProperties(bytes);
        const esc = Math.min(anchoMax / p.width, altoMax / p.height);
        return { bytes, w: p.width * esc, h: p.height * esc };
      } catch { return null; }
    }).filter(Boolean);
    if (!fila.length) continue;
    const alto = Math.max(...fila.map((f) => f.h));
    espacio(c, alto + 10);
    let x = X;
    fila.forEach((f) => {
      doc.addImage(f.bytes, "JPEG", x, c.y, f.w, f.h, undefined, "FAST");
      x += f.w + gap;
    });
    c.y += alto + 10;
  }
  if (leyenda && validas.length) parrafo(c, leyenda, { tam: 9.5, justificar: false, despues: 10 });
}

function trabajos(c, lineas) {
  lineas.forEach((l) => {
    const cant = Number(l.cantidad) > 1 ? ` (cantidad: ${l.cantidad})` : "";
    parrafo(c, `- ${String(l.concepto).replace(/\s*\n\s*/g, "; ")}${cant}`, { justificar: false, despues: 3 });
  });
  c.y += 8;
}

function despedida(c) {
  espacio(c, 120); // el bloque no se parte y puede bajar hasta justo encima de la línea del pie
  parrafo(c, "Cordialmente.", { justificar: false, despues: 2 });
  const { doc } = c;
  doc.addImage(c.marca.firma, "PNG", X - 4, c.y, 100, 93, "firma");
  c.y += 92;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...OSCURO).text("Carlos A. Prado.", X, c.y + 10);
  doc.setFont("helvetica", "normal").text("71.749.150", X, c.y + 10 + ALTO_LINEA);
  c.y += 2 * ALTO_LINEA;
}

const salida = (c, nombre) => ({ nombre: `${nombreArchivo(nombre)}.pdf`, bytes: new Uint8Array(c.doc.output("arraybuffer")) });

// Informe de visita: diagnóstico, fotos y recomendación, sin precios (modelo "INFORME DE VISITA R")
export function cartaVisita(cot, cop, fotosVisita, marca) {
  const c = nuevaCarta(marca);
  saludo(c, cot.creado_en, cop);
  const ubicacion = `Torre ${cot.torre}, piso ${cot.piso}`;
  if (cot.diagnostico) {
    parrafo(c, `De acuerdo a la visita realizada a la copropiedad (${ubicacion}), encontramos lo siguiente:`);
    parrafo(c, cot.diagnostico);
  } else {
    parrafo(c, `De acuerdo a la visita realizada a la copropiedad (${ubicacion}), identificamos los trabajos que se relacionan a continuación.`);
  }
  if (cot.recomendacion) parrafo(c, `Recomendamos: ${cot.recomendacion}`, { negrita: true });
  fotos(c, fotosVisita);
  parrafo(c, "Trabajos identificados:", { negrita: true, justificar: false, despues: 4 });
  trabajos(c, cot.trabajos || cot.lineas);
  parrafo(c, `Referencia: cotización N.° ${numero(cot.numero)}. Visita realizada por ${cot.tecnico_nombre}.`, { tam: 9.5, justificar: false });
  despedida(c);
  return salida(c, `Informe de visita ${numero(cot.numero)} - ${cop.nombre}`);
}

function tablaValores(c, lineas, campo, pie) {
  autoTable(c.doc, {
    startY: c.y,
    margin: { left: X, right: 612 - X - ANCHO, top: ARRIBA + 8, bottom: 792 - ABAJO },
    head: [["Concepto", "Cant.", "Valor unitario", "Subtotal"]],
    body: lineas.map((l) => [t(l.concepto), String(l.cantidad), dinero(l[campo]), dinero(l[campo] * l.cantidad)]),
    foot: pie.map(([etiqueta, valor]) => [t(etiqueta), "", "", dinero(valor)]),
    showFoot: "lastPage",
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, textColor: OSCURO, lineColor: [120, 120, 120], lineWidth: 0.4, cellPadding: 4, fillColor: false },
    headStyles: { fillColor: OSCURO, textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [235, 235, 235], textColor: OSCURO, fontStyle: "bold" },
    columnStyles: { 1: { halign: "center", cellWidth: 36 }, 2: { halign: "right", cellWidth: 82 }, 3: { halign: "right", cellWidth: 82 } },
    didParseCell: (d) => { if (d.column.index >= 2) d.cell.styles.halign = "right"; },
    willDrawPage: (d) => { if (d.pageNumber > 1) membrete(c); },
  });
  c.y = c.doc.lastAutoTable.finalY + 12;
}

// Cotización para el cliente, con los precios calculados en el servidor
export function cartaCotizacion(cot, cliente, cop, marca) {
  const c = nuevaCarta(marca);
  saludo(c, cot.creado_en, cop);
  parrafo(c, `Atendiendo su solicitud, y de acuerdo a la visita técnica realizada, presentamos la cotización N.° ${numero(cot.numero)}, así:`);
  const descuento = cliente.descuento_valor > 0
    ? [["Subtotal", cliente.subtotal], [`Descuento (${cliente.descuento_pct} %)`, -cliente.descuento_valor]]
    : [];
  tablaValores(c, cliente.lineas, "valor_cliente", [...descuento, ["Total cotización", cliente.total ?? cliente.total_cliente]]);
  parrafo(c, "Valores en pesos colombianos (COP).", { tam: 9.5, justificar: false, despues: 14 });
  despedida(c);
  return salida(c, `Cotizacion ${numero(cot.numero)}${cliente.version ? ` v${cliente.version}` : ""} - ${cop.nombre}`);
}

// Pago del servicio al técnico: documento interno, nunca se adjunta al correo ni lleva firma
export function cartaCotizacionTecnico(cot, cop, marca) {
  const c = nuevaCarta(marca);
  parrafo(c, fechaCarta(cot.creado_en), { justificar: false, despues: 14 });
  parrafo(c, "DOCUMENTO INTERNO - NO COMPARTIR CON EL CLIENTE", { negrita: true, justificar: false, despues: 12 });
  parrafo(c, `Cotización del técnico N.° ${numero(cot.numero)} - ${cop.nombre}`, { negrita: true, justificar: false, despues: 0 });
  parrafo(c, `Técnico: ${cot.tecnico_nombre}. Ubicación de referencia: torre ${cot.torre}, piso ${cot.piso}.`, { justificar: false, despues: 12 });
  tablaValores(c, cot.lineas, "valor_tecnico", [["Total a pagar al técnico", cot.total_tecnico]]);
  parrafo(c, "Valores en pesos colombianos (COP).", { tam: 9.5, justificar: false });
  return salida(c, `Cotizacion tecnico ${numero(cot.numero)} - ${cop.nombre}`);
}

// Informe de entrega: trabajos, fotos de antes y reparaciones (modelo "INFORME SHUT reparaciones")
export function cartaEntrega(cot, ent, cop, antes, despues, marca) {
  const c = nuevaCarta(marca);
  saludo(c, ent.fecha_entrega, cop);
  parrafo(c, `Atendiendo su solicitud de la cotización N.° ${numero(cot.numero)} enviada y aprobada, presentamos informe técnico de los trabajos realizados en la copropiedad, así:`);
  trabajos(c, cot.trabajos || cot.lineas);
  if (ent.observaciones) parrafo(c, ent.observaciones);
  if (antes.filter(Boolean).length) {
    parrafo(c, "ESTADO INICIAL.", { negrita: true, justificar: false, despues: 6 });
    fotos(c, antes);
  }
  if (despues.filter(Boolean).length) {
    espacio(c, 220);
    parrafo(c, "REPARACIONES.", { negrita: true, justificar: false, despues: 6 });
    fotos(c, despues);
  }
  if (ent.garantia_meses > 0) {
    const meses = ent.garantia_meses === 1 ? "1 mes" : `${ent.garantia_meses} meses`;
    parrafo(c, `Garantía: ${meses} sobre la mano de obra, a partir de la fecha de entrega (${fechaCO(ent.fecha_entrega)}).`);
  }
  parrafo(c, [`Técnico responsable: ${ent.tecnico_nombre}.`, ent.recibido_por && `Recibido por: ${ent.recibido_por}.`].filter(Boolean).join(" "), { tam: 9.5, justificar: false, despues: 12 });
  despedida(c);
  return salida(c, `Informe de entrega ${numero(ent.numero)} - ${cop.nombre}`);
}

// Hoja de vida de la copropiedad (lo que se diligenció en el registro)
export function cartaHojaVida(cop, tecnico, marca) {
  const c = nuevaCarta(marca);
  parrafo(c, fechaCarta(cop.creado_en), { justificar: false, despues: 18 });
  parrafo(c, `HOJA DE VIDA - ${cop.nombre} (${cop.anio})`, { negrita: true, justificar: false, despues: 12 });
  [["Copropiedad", cop.nombre], ["NIT", cop.nit], ["Dirección", cop.direccion], ["Administrador", cop.administrador],
    ["Correo electrónico", cop.email], ["Celular del administrador", cop.cel_admin], ["Teléfono de portería", cop.tel_porteria],
    ["Técnico asignado", tecnico || "(sin asignar)"], ["Fecha de registro", fechaCO(cop.creado_en)]]
    .forEach(([k, v]) => {
      parrafo(c, k, { negrita: true, tam: 9.5, justificar: false, despues: 0 });
      parrafo(c, v || "-", { justificar: false, despues: 8 });
    });
  return salida(c, `Hoja de vida - ${cop.nombre}`);
}
