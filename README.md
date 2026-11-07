# Portal de copropiedades

Aplicación web para un servicio técnico de shuts de basura, con backend en Supabase. Roles:

- **Cliente (enlace público)**: registra su copropiedad.
- **Técnico**: registra visitas con fotos, diagnóstico y cotización, y luego la entrega.
- **Oficial**: ve sus trabajos asignados, sin precios, y descarga su carnet.
- **Administrador**: gestiona personal, copropiedades y precios, confirma cotizaciones con descuento, emite cuentas de cobro y consulta todo.

Los documentos y las fotos llegan a una carpeta de Google Drive y al correo del administrador mediante el script de `nube/Codigo.gs`.

## Requisitos

- [Node.js](https://nodejs.org/) 20.19 o superior (probado con Node 24)

## Ejecutar localmente

```bash
npm install
npm run dev
```

Abrir http://localhost:5173

## Compilar para producción

```bash
npm run build
npm run preview
```

`npm run build` genera la carpeta `dist/`, que es un sitio estático: puede publicarse en cualquier hosting estático (GitHub Pages, Netlify, Vercel, un servidor Nginx, etc.). El build usa rutas relativas, así que funciona tanto en la raíz de un dominio como en una subcarpeta.

## Publicación

El repositorio incluye un workflow de GitHub Actions (`.github/workflows/deploy.yml`) que compila y publica la app en GitHub Pages en cada push a `main`.

## Tecnologías

- React 19 + Vite
- Supabase (Postgres, Auth, Storage, Edge Functions)
- jsPDF para los documentos en PDF

## Estructura

```
src/App.jsx          Rutas por rol
src/components/      Pantallas
src/lib/             Conexión, PDF, fotos y borradores
supabase/migrations/ Esquema, permisos y lógica de servidor
supabase/functions/  usuarios (cuentas) y avisos (Drive y correo)
nube/Codigo.gs       Script de Google del cliente
```
