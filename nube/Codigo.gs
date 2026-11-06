// Portal Cprado2001: recibe los informes del portal, los guarda en Drive y envía el aviso por correo.
// Se instala una sola vez en la cuenta de Google del administrador (pasos en la pestaña Admin del portal).
// No contiene datos del negocio: la clave se genera al ejecutar configurar().

var NOMBRE_CARPETA = 'Portal Cprado2001';

// Ejecutar una vez desde el editor: pide permisos, crea la carpeta y muestra la clave.
function configurar() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) {
    props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  var raiz = carpetaRaiz_();
  Logger.log('CLAVE para pegar en el portal: ' + props.getProperty('TOKEN'));
  Logger.log('Carpeta en Drive: ' + raiz.getUrl());
  Logger.log('Correos que puede enviar hoy: ' + MailApp.getRemainingDailyQuota());
}

function doGet() {
  return salida_({ ok: true, servicio: 'portal-cprado2001' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000); // uno a la vez, para no crear carpetas repetidas
    var p = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || p.token !== token) return salida_({ ok: false, error: 'La clave no coincide con la del script de Google.' });

    var raiz = carpetaRaiz_();
    var carpeta = raiz;
    (p.carpeta || []).forEach(function (nombre) { carpeta = subcarpeta_(carpeta, nombre); });

    var adjuntos = [];
    (p.archivos || []).forEach(function (a) {
      var blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, a.nombre);
      // Si es un reintento, el archivo ya puede estar: no se duplica
      if (!carpeta.getFilesByName(a.nombre).hasNext()) carpeta.createFile(blob);
      if (a.adjuntar) adjuntos.push(blob);
    });

    if (p.con_correo) {
      var cache = CacheService.getScriptCache();
      var llave = 'enviado_' + p.id;
      if (!cache.get(llave)) {
        MailApp.sendEmail({
          to: p.para,
          subject: p.asunto,
          htmlBody: String(p.html).replace(/\{\{CARPETA\}\}/g, carpeta.getUrl()),
          attachments: adjuntos,
          name: 'Portal Cprado2001',
        });
        cache.put(llave, '1', 21600);
      }
    }
    return salida_({ ok: true, carpeta_url: carpeta.getUrl(), raiz_url: raiz.getUrl() });
  } catch (err) {
    return salida_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Se recuerda por su id: la carpeta se puede mover o renombrar sin perder la conexión
function carpetaRaiz_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CARPETA_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (ignorado) { /* borrada: se crea de nuevo */ }
  }
  var nueva = DriveApp.createFolder(NOMBRE_CARPETA);
  props.setProperty('CARPETA_ID', nueva.getId());
  return nueva;
}

function subcarpeta_(padre, nombre) {
  var limpio = String(nombre).replace(/[\\\/]+/g, ' ').trim() || 'Sin nombre';
  var it = padre.getFoldersByName(limpio);
  return it.hasNext() ? it.next() : padre.createFolder(limpio);
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
