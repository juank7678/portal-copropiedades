# Portal de copropiedades — notas para el agente

App React + Vite (GitHub Pages: https://juank7678.github.io/portal-copropiedades/, repo juank7678/portal-copropiedades)
con backend Supabase. Todas las descargas son PDF (`src/lib/pdf.js`, cargado bajo demanda vía `src/lib/descargar.js`).

## Arquitectura
- `supabase/migrations/*.sql`: tablas, RLS, RPC `registrar_copropiedad` (pública) y `crear_cotizacion` (técnico asignado).
  El precio al cliente (factor en `ajustes_privados`; su valor nunca se escribe en el repo, que es público) se calcula en el servidor y se guarda en `cotizaciones_cliente`,
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
- Pisos: 90-99 primero y luego 1-50 (`PISOS` en `src/lib/util.js`; torres 1-50 en `TORRES`). Migración
  `20261024000000_pisos_90_99` (aplicada el 2026-10-24) ajusta la validación de `crear_cotizacion`.
- Fotos: `dibujarReducida` (util.js) pinta sobre blanco y rechaza lienzos de un solo color (antes quedaban fotos negras).
  Las fotos de técnicos se guardan como `{id}-{timestamp}.jpg` y se borra la anterior.
- Avisos (migración `20261106000000_avisos_y_nube`): registro, visita y entrega dejan una fila en `avisos` por trigger; `pg_net` llama a la
  función `avisos` (verify_jwt false, cabecera `x-avisos-secreto`), que arma los PDF tipo carta (`documentos.js`, modelo en `Materiales/`,
  ignorada por git) y los manda al script de Google del cliente (`nube/Codigo.gs`): guarda en Drive (`Portal Cprado2001/COPROPIEDAD (año)/Visita 007 - fecha`)
  y envía el correo desde su Gmail. Cron cada 2 min (`avisos_reintentar`) reintenta. La URL y la clave del script se guardan desde la tarjeta
  "Correo y carpeta en la nube" (`Nube.jsx`). Cabecera y fondo del membrete en `public/membrete/`; la firma, solo en el bucket privado `marca`.
  El correo y la carpeta no llevan el valor del técnico para poder reenviarlos al cliente.
- Los `mailto:` de "Abrir correo" siguen: son para escribirle al cliente, y el PDF se adjunta a mano.
- Al probar funciones que usan secuencias (cotizaciones, entregas, cuentas), restaurar con `setval` aunque se revierta.
- Marca del cliente: Cprado2001 (datos en `src/lib/marca.js`; logo transparente como data URL en `src/lib/logo.js`,
  sacado de una imagen de 186 px, solo para fondos oscuros). Guía de uso para el cliente en Claude Docs:
  https://claude.ai/code/artifact/0775f080-ec60-47f0-8513-4ad97d2facbc
- Consultas (pestaña del admin, `src/components/Consultas.jsx`): carga todo en el navegador (por bloques de 1000),
  filtra por texto/fechas/técnico/estado, muestra totales y descarga la vista en PDF (`pdfReporte`). "Abrir carpeta"
  pasa a la pestaña Admin con esa copropiedad abierta (`PanelAdmin abrirId`). Carlos no usa Supabase: todo lo que
  necesite consultar debe estar aquí. Para probarla sin cuentas reales se montó con datos simulados.
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
