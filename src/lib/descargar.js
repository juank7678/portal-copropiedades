// Carga el generador de PDF solo al momento de descargar (jsPDF es pesado para la carga inicial)
export async function descargarPdf(tipo, ...args) {
  const pdf = await import("./pdf.js");
  const { doc, nombre } = pdf[tipo](...args);
  doc.save(nombre);
}
