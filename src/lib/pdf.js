// Generación de documentos PDF (todas las descargas de la app).
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { cop, fechaCO, fechaHoraCO, numeroCot, slug } from "./util.js";

const C = {
  oscuro: [31, 42, 36],
  acento: [200, 98, 47],
  claro: [244, 245, 243],
  fila: [248, 249, 247],
  gris: [107, 117, 111],
  grisClaro: [190, 198, 192],
  linea: [226, 229, 225],
  blanco: [255, 255, 255],
};
const M = 16;            // margen lateral (mm)
const PIE = 18;          // espacio reservado al pie de página
const MARCA = "SERVICIO TÉCNICO · SHUTS DE BASURA";

// Las fuentes estándar de PDF solo cubren Latin-1: se normalizan guiones largos, comillas, etc.
const t = (s) => String(s ?? "")
  .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, "...").replace(/[^\n\x20-\xFF]/g, "");

const nuevoDoc = (formato = "a4") => {
  const doc = new jsPDF({ unit: "mm", format: formato, compress: true });
  doc.setFont("helvetica", "normal");
  doc.setLineHeightFactor(1.3);
  return doc;
};
const ancho = (doc) => doc.internal.pageSize.getWidth();
const alto = (doc) => doc.internal.pageSize.getHeight();

function encabezado(doc, { titulo, subtitulo, etiqueta, valor, fecha }) {
  const W = ancho(doc);
  doc.setFillColor(...C.oscuro).rect(0, 0, W, 36, "F");
  doc.setFillColor(...C.acento).rect(0, 36, W, 1.4, "F");

  doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...C.grisClaro);
  doc.text(t(MARCA), M, 12, { charSpace: 0.5 });
  doc.setFontSize(19).setTextColor(...C.blanco);
  doc.text(t(titulo), M, 23);
  if (subtitulo) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...C.grisClaro);
    const lineas = doc.splitTextToSize(t(subtitulo), W - 2 * M - 58);
    doc.text(lineas.length > 1 ? `${lineas[0].replace(/\s+\S*$/, "")}...` : lineas[0], M, 30);
  }

  if (etiqueta) {
    const bw = 52, bx = W - M - bw;
    doc.setFillColor(...C.acento).roundedRect(bx, 9, bw, 17, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(...C.blanco);
    doc.text(t(etiqueta), bx + bw / 2, 14.5, { align: "center", charSpace: 0.4 });
    doc.setFontSize(15).text(t(valor), bx + bw / 2, 22.5, { align: "center" });
  }
  if (fecha) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...C.grisClaro);
    doc.text(t(fecha), W - M, 31.5, { align: "right" });
  }
  return 48;
}

// Si no cabe un bloque de `h` mm, pasa a una página nueva
function asegurarEspacio(doc, y, h) {
  if (y + h <= alto(doc) - PIE) return y;
  doc.addPage();
  return 20;
}

function seccion(doc, y, titulo) {
  y = asegurarEspacio(doc, y, 18);
  doc.setFillColor(...C.acento).rect(M, y - 3.6, 1.4, 5, "F");
  doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...C.oscuro);
  doc.text(t(titulo), M + 4, y);
  return y + 5;
}

// Cuadrícula de datos etiqueta/valor dentro de una tarjeta
function datos(doc, y, pares, columnas = 2) {
  const W = ancho(doc);
  const pad = 5, gap = 6;
  const colW = (W - 2 * M - 2 * pad - gap * (columnas - 1)) / columnas;
  const filas = [];
  for (let i = 0; i < pares.length; i += columnas) filas.push(pares.slice(i, i + columnas));

  doc.setFontSize(10);
  const altos = filas.map((fila) => Math.max(...fila.map(([, v]) => doc.splitTextToSize(t(v || "-"), colW).length)) * 4.6 + 6.5);
  const total = altos.reduce((a, b) => a + b, 0) + pad * 2 - 2;
  y = asegurarEspacio(doc, y, total);

  doc.setFillColor(...C.claro).roundedRect(M, y, W - 2 * M, total, 2.5, 2.5, "F");
  let yy = y + pad + 2;
  filas.forEach((fila, i) => {
    fila.forEach(([etiqueta, valor], j) => {
      const x = M + pad + j * (colW + gap);
      doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(...C.gris);
      doc.text(t(etiqueta).toUpperCase(), x, yy, { charSpace: 0.3 });
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...C.oscuro);
      doc.text(doc.splitTextToSize(t(valor || "-"), colW), x, yy + 4.8);
    });
    yy += altos[i];
  });
  return y + total + 8;
}

function tablaLineas(doc, y, lineas, campoValor) {
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 20, bottom: PIE + 2 },
    head: [["Concepto", "Cant.", "Valor unitario", "Subtotal"]],
    body: lineas.map((l) => [t(l.concepto), String(l.cantidad), cop(l[campoValor]), cop(l[campoValor] * l.cantidad)]),
    theme: "plain",
    styles: {
      font: "helvetica", fontSize: 9, textColor: C.oscuro, valign: "middle",
      cellPadding: { top: 2.8, bottom: 2.8, left: 3, right: 3 },
      lineColor: C.linea, lineWidth: { bottom: 0.2 },
    },
    headStyles: { fillColor: C.oscuro, textColor: C.blanco, fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: C.fila },
    columnStyles: {
      1: { halign: "center", cellWidth: 16 },
      2: { halign: "right", cellWidth: 32 },
      3: { halign: "right", cellWidth: 34, fontStyle: "bold" },
    },
    didParseCell: (d) => { if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = d.column.index === 1 ? "center" : "right"; },
  });
  return doc.lastAutoTable.finalY + 6;
}

function totalDestacado(doc, y, etiqueta, valor) {
  const W = ancho(doc);
  y = asegurarEspacio(doc, y, 20);
  const bw = 92, bx = W - M - bw;
  doc.setFillColor(...C.oscuro).roundedRect(bx, y, bw, 15, 2.5, 2.5, "F");
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...C.grisClaro);
  doc.text(t(etiqueta).toUpperCase(), bx + 6, y + 9.4, { charSpace: 0.4 });
  doc.setFontSize(14).setTextColor(...C.blanco);
  doc.text(cop(valor), bx + bw - 6, y + 9.8, { align: "right" });
  return y + 23;
}

function nota(doc, y, texto) {
  y = asegurarEspacio(doc, y, 10);
  doc.setFont("helvetica", "italic").setFontSize(8.5).setTextColor(...C.gris);
  doc.text(doc.splitTextToSize(t(texto), ancho(doc) - 2 * M), M, y);
  return y + 8;
}

// Fotos en cuadrícula de 2 columnas, ajustadas sin deformar
function fotosGrid(doc, y, fotos) {
  const W = ancho(doc);
  const gap = 6, colW = (W - 2 * M - gap) / 2, celdaH = 66;
  fotos.forEach((f, i) => {
    const col = i % 2;
    if (col === 0) y = asegurarEspacio(doc, y, celdaH + 10);
    const x = M + col * (colW + gap);
    doc.setFillColor(...C.claro).roundedRect(x, y, colW, celdaH, 2, 2, "F");
    try {
      const p = doc.getImageProperties(f.dataUrl);
      const esc = Math.min((colW - 4) / p.width, (celdaH - 4) / p.height);
      const w = p.width * esc, h = p.height * esc;
      doc.addImage(f.dataUrl, "JPEG", x + (colW - w) / 2, y + (celdaH - h) / 2, w, h, undefined, "FAST");
    } catch {
      doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(...C.gris);
      doc.text("Imagen no disponible", x + colW / 2, y + celdaH / 2, { align: "center" });
    }
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...C.gris);
    const pie = [`Foto ${i + 1}`, f.torre ? `Torre ${f.torre}, Piso ${f.piso}` : ""].filter(Boolean).join(" · ");
    doc.text(t(pie), x, y + celdaH + 4.5);
    if (col === 1 || i === fotos.length - 1) y += celdaH + 10;
  });
  return y + 2;
}

function piePagina(doc) {
  const n = doc.getNumberOfPages();
  const W = ancho(doc), H = alto(doc);
  const generado = `Portal de copropiedades · Generado el ${fechaHoraCO(new Date())}`;
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...C.linea).setLineWidth(0.3).line(M, H - 12, W - M, H - 12);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...C.gris);
    doc.text(t(generado), M, H - 7.5);
    doc.text(`Página ${i} de ${n}`, W - M, H - 7.5, { align: "right" });
  }
}

// ---------- Documentos ----------

export function pdfHojaVida(c, tecnicoNombre) {
  const doc = nuevoDoc();
  let y = encabezado(doc, {
    titulo: "Hoja de vida", subtitulo: c.nombre, etiqueta: "AÑO", valor: String(c.anio),
    fecha: `Registrada el ${fechaCO(c.creado_en)}`,
  });
  y = seccion(doc, y, "Datos de la copropiedad");
  y = datos(doc, y, [
    ["Nombre de la copropiedad", c.nombre],
    ["Año", String(c.anio)],
    ["Dirección", c.direccion],
    ["Fecha de registro", fechaCO(c.creado_en)],
  ]);
  y = seccion(doc, y, "Contacto");
  y = datos(doc, y, [
    ["Administrador", c.administrador],
    ["Correo electrónico", c.email],
    ["Celular del administrador", c.cel_admin],
    ["Teléfono de portería", c.tel_porteria],
  ]);
  y = seccion(doc, y, "Servicio técnico");
  datos(doc, y, [["Técnico asignado", tecnicoNombre || "(sin asignar)"]], 1);
  piePagina(doc);
  return { doc, nombre: `${slug(c.nombre)}-${c.anio}-hoja-de-vida.pdf` };
}

// Credencial tamaño 100 x 150 mm. `fotoCircular` es un PNG ya recortado en círculo (o null).
export function pdfIdentificacion(tec, fotoCircular, copNombre) {
  const doc = nuevoDoc([100, 150]);
  const W = 100;
  doc.setFillColor(...C.oscuro).rect(0, 0, W, 62, "F");
  doc.setFillColor(...C.acento).rect(0, 62, W, 1.2, "F");
  doc.setFont("helvetica", "bold").setFontSize(6.5).setTextColor(...C.grisClaro);
  doc.text(t(MARCA), W / 2, 11, { align: "center", charSpace: 0.4 });
  doc.setFontSize(11).setTextColor(...C.acento);
  doc.text("TÉCNICO AUTORIZADO", W / 2, 19, { align: "center", charSpace: 0.6 });
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...C.blanco);
  doc.text(doc.splitTextToSize(t(copNombre), W - 16), W / 2, 25.5, { align: "center" });

  const r = 21, cx = W / 2, cy = 60;
  doc.setFillColor(...C.blanco).circle(cx, cy, r + 1.6, "F");
  if (fotoCircular) {
    doc.addImage(fotoCircular, "PNG", cx - r, cy - r, 2 * r, 2 * r);
  } else {
    doc.setFillColor(...C.claro).circle(cx, cy, r, "F");
    doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...C.gris);
    const iniciales = t(tec.nombre).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");
    doc.text(iniciales, cx, cy + 3, { align: "center" });
  }

  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...C.oscuro);
  const nombre = doc.splitTextToSize(t(tec.nombre), W - 14);
  doc.text(nombre, W / 2, 92, { align: "center" });
  let y = 92 + nombre.length * 6.5 + 2;

  [["CÉDULA", tec.cedula], ["CELULAR", tec.celular]].forEach(([k, v]) => {
    doc.setFillColor(...C.claro).roundedRect(12, y, W - 24, 12, 2, 2, "F");
    doc.setFont("helvetica", "bold").setFontSize(6.5).setTextColor(...C.gris);
    doc.text(k, 17, y + 7.4, { charSpace: 0.4 });
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...C.oscuro);
    doc.text(t(v || "-"), W - 17, y + 7.6, { align: "right" });
    y += 15;
  });

  doc.setFillColor(...C.acento).rect(0, 140, W, 10, "F");
  doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...C.blanco);
  doc.text(`Emitida el ${fechaCO(new Date())}`, W / 2, 146, { align: "center" });
  return { doc, nombre: `identificacion_${slug(tec.nombre)}.pdf` };
}

// Cotización de pago al técnico (no incluye precios del cliente)
export function pdfCotizacionTecnico(cot, fotos = []) {
  const doc = nuevoDoc();
  let y = encabezado(doc, {
    titulo: "Cotización de servicio", subtitulo: cot.copropiedad_nombre,
    etiqueta: "COTIZACIÓN N.°", valor: numeroCot(cot.numero), fecha: fechaCO(cot.creado_en),
  });
  y = seccion(doc, y, "Datos de la visita");
  y = datos(doc, y, [
    ["Copropiedad", cot.copropiedad_nombre],
    ["Técnico", cot.tecnico_nombre],
    ["Fecha de la visita", fechaCO(cot.creado_en)],
    ["Ubicación de referencia", `Torre ${cot.torre}, Piso ${cot.piso}`],
  ]);
  y = seccion(doc, y, "Trabajos realizados");
  y = tablaLineas(doc, y, cot.lineas, "valor_tecnico");
  y = totalDestacado(doc, y, "Total a pagar", cot.total_tecnico);
  y = nota(doc, y, "Valores en pesos colombianos (COP).");
  if (fotos.length) {
    y = seccion(doc, y + 2, "Registro fotográfico");
    fotosGrid(doc, y, fotos);
  }
  piePagina(doc);
  return { doc, nombre: `cotizacion-${numeroCot(cot.numero)}-tecnico-${slug(cot.copropiedad_nombre)}.pdf` };
}

// Informe de visita + cotización para el cliente (precios con margen, calculados en el servidor)
export function pdfInformeCliente(cot, cliente, copropiedad, fotos = []) {
  const doc = nuevoDoc();
  let y = encabezado(doc, {
    titulo: "Informe de visita y cotización", subtitulo: cot.copropiedad_nombre,
    etiqueta: "COTIZACIÓN N.°", valor: numeroCot(cot.numero), fecha: fechaCO(cot.creado_en),
  });
  y = seccion(doc, y, "Datos de la visita");
  y = datos(doc, y, [
    ["Copropiedad", cot.copropiedad_nombre],
    ["Administrador", copropiedad?.administrador],
    ["Dirección", copropiedad?.direccion],
    ["Fecha de la visita", fechaCO(cot.creado_en)],
    ["Técnico", cot.tecnico_nombre],
    ["Ubicación de referencia", `Torre ${cot.torre}, Piso ${cot.piso}`],
  ]);
  y = seccion(doc, y, "Cotización");
  y = tablaLineas(doc, y, cliente.lineas, "valor_cliente");
  y = totalDestacado(doc, y, "Total cotización", cliente.total_cliente);
  y = nota(doc, y, "Valores en pesos colombianos (COP).");
  if (fotos.length) {
    y = seccion(doc, y + 2, "Registro fotográfico");
    fotosGrid(doc, y, fotos);
  }
  piePagina(doc);
  return { doc, nombre: `cotizacion-${numeroCot(cot.numero)}-${slug(cot.copropiedad_nombre)}.pdf` };
}
