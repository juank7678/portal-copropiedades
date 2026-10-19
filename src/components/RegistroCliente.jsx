import { useState } from "react";
import { mensajeError, supabase } from "../lib/supabase.js";
import { descargarPdf } from "../lib/descargar.js";
import { btnGhost, btnPrimary, card, disabled, errorText, fieldLabel, input, muted } from "../styles.js";
import { MARCA } from "../lib/marca.js";

const VACIO = { nombre: "", nit: "", administrador: "", direccion: "", email: "", celAdmin: "", telPorteria: "" };
const CAMPOS = [
  ["nombre", "Nombre de la copropiedad", "text"],
  ["nit", "NIT de la copropiedad (opcional)", "text"],
  ["administrador", "Nombre del administrador", "text"],
  ["direccion", "Dirección física de la copropiedad", "text"],
  ["email", "Correo electrónico", "email"],
  ["celAdmin", "Número de celular del administrador", "tel"],
  ["telPorteria", "Número telefónico de la portería", "tel"],
];

export default function RegistroCliente({ publico = false }) {
  const [form, setForm] = useState(VACIO);
  const [autoriza, setAutoriza] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const submit = async () => {
    setError("");
    if (!form.nombre.trim() || !form.administrador.trim()) {
      setError("Falta el nombre de la copropiedad o del administrador.");
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("El correo electrónico no es válido.");
      return;
    }
    if (!autoriza) {
      setError("Debes autorizar el tratamiento de datos personales para continuar.");
      return;
    }
    setEnviando(true);
    const { data, error: err } = await supabase.rpc("registrar_copropiedad", {
      p_nombre: form.nombre, p_administrador: form.administrador, p_direccion: form.direccion,
      p_email: form.email, p_cel_admin: form.celAdmin, p_tel_porteria: form.telPorteria, p_autoriza: autoriza, p_nit: form.nit,
    });
    setEnviando(false);
    if (err) { setError(mensajeError(err)); return; }
    setDone(data);
  };

  const descargar = () => descargarPdf("pdfHojaVida", done, null);

  if (done) {
    return (
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>Carpeta creada</h2>
        <p>Se creó la carpeta <b>{done.nombre} — {done.anio}</b> con la hoja de vida de la copropiedad.</p>
        <button style={btnPrimary} onClick={descargar}>Descargar hoja de vida (PDF)</button>
        <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => { setDone(null); setForm(VACIO); setAutoriza(false); }}>
          Registrar otra copropiedad
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ marginTop: 0 }}>Registro de copropiedad</h2>
      <p style={{ ...muted, fontSize: 14, marginTop: -8 }}>
        {publico ? "Diligencia los datos de tu copropiedad." : "Registra una copropiedad en nombre del cliente. El enlace público para clientes está en la pestaña Admin."}
      </p>
      {CAMPOS.map(([key, label, type]) => (
        <label key={key} style={fieldLabel}>
          {label}
          <input style={{ ...input, textTransform: key === "email" ? "none" : "uppercase" }} type={type} value={form[key]}
            maxLength={key === "direccion" ? 200 : key === "nit" ? 30 : 150}
            onChange={(e) => setForm({ ...form, [key]: key === "email" ? e.target.value : e.target.value.toUpperCase() })} />
        </label>
      ))}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#4a534d", margin: "4px 0 12px" }}>
        <input type="checkbox" checked={autoriza} onChange={(e) => setAutoriza(e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          Autorizo a {MARCA.nombre} (NIT {MARCA.nit}) a tratar los datos personales aquí suministrados para la gestión del
          servicio técnico (programación de visitas, cotizaciones, entregas, cobro y contacto), conforme a la Ley 1581 de 2012.
          Puedo consultar, actualizar o suprimir mis datos escribiendo a {MARCA.correo} o al {MARCA.telefono}.
        </span>
      </label>
      <button style={{ ...btnPrimary, ...disabled(enviando) }} type="button" onClick={submit} disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar y crear carpeta"}
      </button>
      {error && <p style={errorText}>{error}</p>}
    </div>
  );
}
