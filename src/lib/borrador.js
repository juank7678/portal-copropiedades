// Borrador de una visita o entrega en el celular: si la señal falla o el navegador se cierra, las fotos y el formulario no se pierden.
// Si el navegador no permite guardar (modo privado, sin espacio), la app sigue funcionando sin borrador.
const abrir = () => new Promise((resolve, reject) => {
  const r = indexedDB.open("portal-borradores", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("borradores");
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function operar(modo, fn) {
  try {
    const db = await abrir();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("borradores", modo);
        const r = fn(tx.objectStore("borradores"));
        tx.oncomplete = () => resolve(r.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

export const leerBorrador = (clave) => operar("readonly", (s) => s.get(clave));
export const guardarBorrador = (clave, datos) => operar("readwrite", (s) => s.put(datos, clave));
export const borrarBorrador = (clave) => operar("readwrite", (s) => s.delete(clave));
