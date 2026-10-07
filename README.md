# Portal de copropiedades

Aplicación web para un servicio técnico de shuts de basura. Tiene tres pestañas:

- **Registro cliente**: la copropiedad diligencia sus datos y se genera su hoja de vida descargable en Excel.
- **Técnico**: el técnico asignado abre la copropiedad, toma fotos (marcadas con torre, piso y fecha), registra los trabajos realizados y genera el informe de visita y su cotización.
- **Admin**: directorio de técnicos (con foto e identificación descargable), asignación de técnicos, historial de visitas con la cotización al cliente (precio base + 45 %, redondeado) y edición de precios base. Incluye accesos para abrir correo y WhatsApp con el mensaje prellenado.

> **Modo prueba:** no hay backend. Los datos viven en memoria y se pierden al recargar o cerrar la pestaña.

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
- [SheetJS (xlsx)](https://sheetjs.com/) para exportar la hoja de vida en Excel (se instala desde el CDN oficial de SheetJS; la versión de npm está desactualizada)

## Estructura

```
index.html          Página base
src/main.jsx        Punto de entrada de React
src/App.jsx         Toda la aplicación (pestañas, lógica y estilos)
public/favicon.svg  Ícono
```
