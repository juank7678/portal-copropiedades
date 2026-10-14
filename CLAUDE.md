# Portal de copropiedades — notas para el agente

App React + Vite (GitHub Pages: https://juank7678.github.io/portal-copropiedades/, repo juank7678/portal-copropiedades)
con backend Supabase. Todas las descargas son PDF (`src/lib/pdf.js`, cargado bajo demanda vía `src/lib/descargar.js`).

## Arquitectura
- `supabase/migrations/*.sql`: tablas, RLS, RPC `registrar_copropiedad` (pública) y `crear_cotizacion` (técnico asignado).
  El precio al cliente (factor 1.45 en `ajustes_privados`) se calcula en el servidor y se guarda en `cotizaciones_cliente`,
  que solo el admin puede leer.
- `supabase/functions/usuarios`: Edge Function (verify_jwt = false, autentica dentro) para crear/gestionar cuentas.
  El admin inicial se crea desde la app con un código de un solo uso cuyo hash va en `ajustes_privados.codigo_inicial_hash`.
- Login por usuario: se mapea a `usuario@portal.invalid` en Supabase Auth.
- Frontend: `src/App.jsx` (rutas por hash: `#/registro` es el formulario público), `src/components/*`.
- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local` en local; en el workflow de GitHub Actions).

## Estado (2026-10-14)
Código completo y compilando. PENDIENTE: el proyecto Supabase vive en la cuenta juank7678pptt@gmail.com (organización
distinta a la del conector anterior). Pasos que faltan:
1. Con el conector de Supabase con acceso a esa organización: aplicar la migración, desplegar la función `usuarios`
   (verify_jwt false), generar el código inicial y guardar su hash, crear `.env.local` y poner las variables en el workflow.
2. Probar el flujo completo (registro, admin, técnico, PDFs) y revisar `get_advisors` (security).
3. Commit + push (despliega a GitHub Pages). Recomendar al usuario desactivar "Allow new users to sign up" en Auth.
