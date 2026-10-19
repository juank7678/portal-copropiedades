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
- Flujo de una cotización (estado derivado en `estadoCotizacion`, `src/lib/util.js`): cotizada → aprobada (admin,
  `aprobar_cotizacion`) → entregada (técnico, `crear_entrega`, tabla `entregas` con fotos "después") → cobrada
  (admin, `crear_cuenta_cobro`, una cuenta puede agrupar varias cotizaciones) → pagada. Las cuentas de cobro guardan
  copia de los datos del cliente y del emisor (tabla `emisor`, solo admin); anular conserva el consecutivo.
- Migración `20261019000000_entregas_y_cobros` aplicada el 2026-10-19 (probada con transacción revertida; secuencias
  reiniciadas después). Para probar contra el proyecto real, usar transacciones revertidas: ya hay datos reales.
- Frontend: `src/App.jsx` (rutas por hash: `#/registro` es el formulario público), `src/components/*`.
- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local` en local; en el workflow de GitHub Actions).

## Estado (2026-10-14)
Supabase: proyecto `portal-copropiedades` (ref `gfmzotkzubbgsqzhkmic`, org "Juan Carlos Guerrero" de
juank7678pptt@gmail.com; el conector de Supabase se autorizó para esa org). Migración `init` aplicada, función `usuarios`
desplegada (verify_jwt false), variables en `.env.local` y en el workflow.
Flujo completo probado en local (admin inicial, técnico con foto, registro, asignación, visita con foto, los 4 PDF,
permisos de técnico y anónimo) y datos de prueba borrados. El código inicial vigente está en `CONFIGURACION-INICIAL.txt`
(ignorado por git); si se consume en pruebas, regenerar el hash en `ajustes_privados`.
Avisos de `get_advisors` revisados: son intencionales (RPC públicas que validan por dentro, `ajustes_privados` sin políticas).
Pendiente del usuario: desactivar "Allow new users to sign up" en Auth y crear el admin real con el código.
