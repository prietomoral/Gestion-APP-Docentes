/**
 * Función principal para servir la página web.
 * Se ejecuta cuando se accede a la URL del Web App.
 * Carga la plantilla HTML 'Index', la evalúa y le pone un título.
 * 
 * @returns {HtmlOutput} Página HTML principal del web app.
 */
function doGet() {
  // Crear la plantilla a partir del archivo HTML 'Index'
  const plantilla = HtmlService.createTemplateFromFile('Index');
  
  // Evaluar la plantilla para generar el contenido final
  const salidaHtml = plantilla.evaluate();
  
  // Configurar el título de la pestaña/navegador
  salidaHtml.setTitle('Gestión de asuntos particulares de docentes');
  
  return salidaHtml;
}

/**
 * Función auxiliar para incluir contenido HTML de otros archivos.
 * Esto permite dividir el HTML en partes (parciales) y reutilizarlas.
 * 
 * @param {string} nombre - Nombre del archivo HTML (sin extensión) a incluir.
 * @returns {string} Contenido HTML del archivo solicitado.
 */
function incluir(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/**
 * Devuelve el contenido HTML del formulario de solicitud.
 * Se usa para cargar dinámicamente la parte del formulario.
 * 
 * @returns {string} Código HTML del formulario.
 */
function getFormularioHtml() {
  return HtmlService.createHtmlOutputFromFile('Formulario').getContent();
}

/**
 * Devuelve el contenido HTML del panel de gestión o administración.
 * Se usa para cargar dinámicamente la parte del panel.
 * 
 * @returns {string} Código HTML del panel.
 */
function getPanelHtml() {
  return HtmlService.createHtmlOutputFromFile('Panel').getContent();
}



function contarDiasAprobados(email) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Solicitudes');
  const datos = hoja.getDataRange().getValues();
  let total = 0;

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    if (fila[6] === email && fila[3] === 'Aprobado') {
      total++;
    }
  }

  return total;
}

function obtenerEmailUsuario() {
  return Session.getActiveUser().getEmail();
}

function esDireccion() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Direccion");
  if (!hoja) return false;

  const datos = hoja.getRange("A:A").getValues().flat().filter(c => c);
  const emailUsuario = Session.getActiveUser().getEmail();
  return datos.includes(emailUsuario);
}


function obtenerNombreUsuario() {
  const email = Session.getActiveUser().getEmail();
  if (!email) return "Usuario desconocido";

  try {
    const usuario = AdminDirectory.Users.get(email);
    if (usuario.name && usuario.name.fullName) {
      return usuario.name.fullName;
    }
  } catch (e) {
    Logger.log("Error al obtener el nombre desde Admin Directory: " + e.message);
  }

  // Fallback: usar el correo
  let nombre = email.split("@")[0].replace(/\./g, " ");
  nombre = nombre.replace(/\b\w/g, c => c.toUpperCase());
  return nombre;
}


function obtenerAnoEscolar() {
  const hoy = new Date();
  const year = hoy.getFullYear();
  const month = hoy.getMonth() + 1;
  if (month >= 9) {
    return year + "-" + (year + 1);
  } else {
    return (year - 1) + "-" + year;
  }
}

function enviarSolicitud(fechaSolicitada, comentario) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Solicitudes");
  const email = Session.getActiveUser().getEmail();
  const nombre = obtenerNombreUsuario();
  const anoEscolar = obtenerAnoEscolar();

  const fecha = new Date(fechaSolicitada);
  fecha.setHours(0,0,0,0);

  validarFechaNoPasada(fecha);
  validarAntelacion(fecha);
  validarMaxAntelacion(fecha);  // <-- Validación máxima de 3 meses añadida
  validarNoFinDeSemana(fecha);
  validarDuplicado(fecha, email, anoEscolar, hoja);
  validarLimiteDias(fecha, email, anoEscolar, hoja);

  const resultado = esFechaPermitida(fecha);
  if (!resultado.valido) {
    throw new Error("❌ No se puede solicitar ese día: " + resultado.motivo);
  }

  if (comentario && comentario.length > 200) {
    throw new Error("❌ El comentario no puede superar los 200 caracteres.");
  }

  hoja.appendRow([new Date(), nombre, fecha, "Pendiente", comentario || "", anoEscolar, email]);
}





// 1. Fecha no puede ser pasada
function validarFechaNoPasada(fecha) {
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  if (fecha < hoy) throw new Error("❌ No puedes solicitar días pasados.");
}

// 2. Antelación mínima 15 días
function validarAntelacion(fecha) {
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  const difDias = (fecha - hoy) / (1000*60*60*24);
  if (difDias < 15) throw new Error("❌ Debes solicitar al menos con 15 días de antelación.");
}

// 3. No solicitar en fin de semana
function validarNoFinDeSemana(fecha) {
  const diaSemana = fecha.getDay();
  if (diaSemana === 0 || diaSemana === 6) throw new Error("❌ La fecha solicitada no puede ser sábado ni domingo.");
}

// 4. No duplicados de fecha para el mismo docente y curso
function validarDuplicado(fecha, email, anoEscolar, hoja) {
  const datos = hoja.getDataRange().getValues();
  for (let i=1; i<datos.length; i++) {
    const fila = datos[i];
    if (fila[6] === email && fila[5] === anoEscolar) {
      const f = fila[2];
      if (f instanceof Date && f.getTime() === fecha.getTime()) {
        throw new Error("❌ Ya tienes una solicitud ese día.");
      }
    }
  }
}

// 5. Validar límites de días (3 lectivos, 1 no lectivo)
function validarLimiteDias(fecha, email, anoEscolar, hoja) {
  const datos = hoja.getDataRange().getValues();
  let lectivo = 0;
  let noLectivo = 0;
  for (let i=1; i<datos.length; i++) {
    const fila = datos[i];
    if (fila[6] === email && fila[5] === anoEscolar) {
      const f = fila[2];
      const estado = fila[3];
      if (estado !== "Pendiente" && estado !== "Denegado") {
        if (f instanceof Date) {
          const isWeekend = (f.getDay() === 0 || f.getDay() === 6);
          if (isWeekend) noLectivo++;
          else lectivo++;
        }
      }
    }
  }
  if (lectivo >= 3) throw new Error("❌ Ya alcanzaste los 3 días lectivos permitidos.");
  if (noLectivo >= 1) throw new Error("❌ Ya usaste tu día no lectivo permitido.");
}


// Nueva validación: no más de 3 meses (aprox) de antelación
function validarMaxAntelacion(fecha) {
  const hoy = new Date();
  hoy.setHours(0,0,0,0);

  const limite = new Date(hoy);
  limite.setMonth(limite.getMonth() + 3); // Suma 3 meses

  if (fecha > limite) {
    throw new Error("❌ No puedes solicitar días con más de 3 meses de antelación.");
  }
}

//Valida q no sea una excepcion 15 primeros dias lectivos o evaluaciones

function esFechaPermitida(fecha) {
  const hoja = SpreadsheetApp.getActive().getSheetByName("Excepciones");
  if (!hoja) return { valido: true };

  const excepciones = hoja.getDataRange().getValues().slice(1); // Excluye encabezado
  const fechaStr = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM-dd");

  for (let i = 0; i < excepciones.length; i++) {
    const [fechaExcepcion, motivo] = excepciones[i];
    if (!fechaExcepcion) continue;

    const fechaExStr = Utilities.formatDate(new Date(fechaExcepcion), Session.getScriptTimeZone(), "yyyy-MM-dd");

    if (fechaStr === fechaExStr) {
      return { valido: false, motivo: motivo || "Fecha restringida" };
    }
  }

  return { valido: true };
}


function obtenerSolicitudesPendientes() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Solicitudes");
  const datos = hoja.getDataRange().getValues();
  const solicitudes = [];

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    if (fila[3] === "Pendiente") {
      // Asegurar que sean objetos Date para comparar
      const fechaSolicitadaObj = fila[2] instanceof Date ? fila[2] : new Date(fila[2]);
      const marcaTiempoObj = fila[0] instanceof Date ? fila[0] : new Date(fila[0]);

      solicitudes.push({
        fila: i + 1,
        usuario: fila[1],
        fechaSolicitadaObj,
        estado: fila[3],
        comentario: fila[4] || "",
        anoEscolar: fila[5] || "",
        email: fila[6] || "",
        marcaTiempoObj
      });
    }
  }

  // Ordenar por fechaSolicitadaObj y luego marcaTiempoObj, ascendente (más antiguo primero)
  solicitudes.sort((a, b) => {
    if (a.fechaSolicitadaObj.getTime() !== b.fechaSolicitadaObj.getTime()) {
      return a.fechaSolicitadaObj - b.fechaSolicitadaObj;
    }
    return a.marcaTiempoObj - b.marcaTiempoObj;
  });

  // Formatear fechas para salida y eliminar objetos Date innecesarios
  solicitudes.forEach(solicitud => {
    solicitud.fechaSolicitada = Utilities.formatDate(solicitud.fechaSolicitadaObj, Session.getScriptTimeZone(), "dd/MM/yyyy");
    solicitud.marcaTiempo = Utilities.formatDate(solicitud.marcaTiempoObj, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
    delete solicitud.fechaSolicitadaObj;
    delete solicitud.marcaTiempoObj;
  });

  return solicitudes;
}



function actualizarEstado(fila, nuevoEstado) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Solicitudes");
  hoja.getRange(fila, 4).setValue(nuevoEstado); // Columna D = Estado

  const datos = hoja.getRange(fila, 1, 1, 7).getValues()[0];
  const nombre = datos[1];           // Columna B = nombre
  const fechaPedida = datos[2];      // Columna C = fecha
  const emailSolicitante = datos[6]; // Columna G = email

  if (nuevoEstado === "Aprobado" || nuevoEstado === "Denegado") {
    crearEventoEnCalendario(fechaPedida, nombre, nuevoEstado);
    enviarCorreoNotificacion(emailSolicitante, nombre, fechaPedida, nuevoEstado);
  }

  return "ok"; // ✅ Esto evita el mensaje "null"
}

/**
 * Envía un correo notificando la aprobación o denegación de la solicitud.
 * @param {string} destinatario Email del solicitante
 * @param {string} nombreDocente Nombre del solicitante
 * @param {Date} fecha Fecha solicitada
 * @param {string} estado Estado nuevo ("Aprobado" o "Denegado")
 */
function enviarCorreoNotificacion(destinatario, nombreDocente, fecha, estado) {
  const asunto = `Notificación de solicitud de día de asuntos particulares: ${estado}`;
  const fechaFormateada = Utilities.formatDate(new Date(fecha), Session.getScriptTimeZone(), "dd/MM/yyyy");
  let cuerpo = `Hola ${nombreDocente},\n\n` +
               `Tu solicitud para el día ${fechaFormateada} ha sido ${estado.toLowerCase()}.\n\n`;

  if (estado === "Aprobado") {
    cuerpo += "Puedes considerarlo confirmado en tu calendario.\n\n¡Gracias!";
  } else if (estado === "Denegado") {
    cuerpo += "Si tienes dudas, contacta con la dirección.\n\nSaludos.";
  }

  MailApp.sendEmail(destinatario, asunto, cuerpo);
}


function crearEventoEnCalendario(fechaISO, nombreDocente, estado) {
  if (!estado) {
    throw new Error("El parámetro 'estado' es requerido y no puede ser vacío");
  }

  const CALENDAR_ID = "c_d231c3ae63f55eff5f8536bfbf197d2b9be889d103853371dc1abc1371f46280@group.calendar.google.com";

  const fecha = new Date(fechaISO);
  const fechaFin = new Date(fecha);
  fechaFin.setDate(fechaFin.getDate() + 1);  // Evento todo el día, fin al siguiente día

  let titulo, descripcion, colorId;
  const estadoNormalizado = estado.toLowerCase();

  if (estadoNormalizado === "aprobado") {
    titulo = `✅ AAPP Aprobado: ${nombreDocente}`;
    descripcion = "Solicitud de día de asuntos particulares APROBADA";
    colorId = "2";  // Verde oscuro
  } else if (estadoNormalizado === "denegado") {
    titulo = `❌ AAPP Denegado: ${nombreDocente}`;
    descripcion = "Solicitud de día de asuntos particulares DENEGADA";
    colorId = "6";  // Rojo claro
  } else {
    throw new Error("Estado inválido. Usa 'Aprobado' o 'Denegado'");
  }

  const evento = {
    summary: titulo,
    description: descripcion,
    start: {
      date: Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    },
    end: {
      date: Utilities.formatDate(fechaFin, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    },
    colorId: colorId,
  };

  Calendar.Events.insert(evento, CALENDAR_ID);
}

function obtenerMisSolicitudes() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Solicitudes");
  const email = Session.getActiveUser().getEmail();
  const datos = hoja.getDataRange().getValues();
  const solicitudes = [];

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    if (fila[6] === email) {
      const fechaSolicitada = fila[2] instanceof Date ? fila[2] : new Date(fila[2]);
      const marcaTiempo = fila[0] instanceof Date ? fila[0] : new Date(fila[0]);

      solicitudes.push({
        fechaSolicitada: fechaSolicitada,
        estado: fila[3],
        comentario: fila[4] || "",
        anoEscolar: fila[5] || "",
        marcaTiempo: marcaTiempo
      });
    }
  }

  // Ordenar por marcaTiempo descendente (más reciente primero)
  solicitudes.sort((a, b) => b.marcaTiempo - a.marcaTiempo);

  // Formatear fechas para devolver
  return solicitudes.map(solicitud => ({
    fechaSolicitada: Utilities.formatDate(solicitud.fechaSolicitada, Session.getScriptTimeZone(), "dd/MM/yyyy"),
    estado: solicitud.estado,
    comentario: solicitud.comentario,
    anoEscolar: solicitud.anoEscolar,
    marcaTiempo: Utilities.formatDate(solicitud.marcaTiempo, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss")
  }));
}


/**
 * Devuelve un array con las solicitudes pendientes cuya fecha está dentro de los próximos 15 días.
 */
function obtenerSolicitudesProximasAVencer() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Solicitudes");
  const datos = hoja.getDataRange().getValues();
  const hoy = new Date();
  const solicitudes = [];

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const estado = fila[3]; // Estado
    let fecha = fila[2];    // Fecha solicitada
    const nombre = fila[1]; // Usuario
    const email = fila[6];  // Email
    const comentario = fila[4]; // Comentarios

    if (!fecha || estado !== "Pendiente") continue;

    // Validamos la fecha
    if (typeof fecha === 'string') {
      const partes = fecha.split("/");
      if (partes.length === 3) {
        fecha = new Date(`${partes[2]}-${partes[1]}-${partes[0]}`);
      } else {
        continue;
      }
    }

    if (Object.prototype.toString.call(fecha) !== "[object Date]" || isNaN(fecha)) continue;

    const diffDias = Math.ceil((fecha - hoy) / (1000 * 60 * 60 * 24));

    if (diffDias >= 0 && diffDias <= 15) {
      solicitudes.push({
        nombre,
        email,
        fechaSolicitada: Utilities.formatDate(fecha, Session.getScriptTimeZone(), "dd/MM/yyyy"),
        comentario,
        diasRestantes: diffDias,
        fila: i + 1
      });
    }
  }

  return solicitudes;
}



/**
 * Envía un correo a los responsables con las solicitudes próximas a vencer.
 */
function avisarSolicitudesProximasAVencer() {
  const solicitudes = obtenerSolicitudesProximasAVencer();
  if (solicitudes.length === 0) return;

  const hojaDireccion = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Direccion");
  if (!hojaDireccion) return;

  const destinatarios = hojaDireccion.getRange("A:A").getValues().flat().filter(e => e);
  if (destinatarios.length === 0) return;

  let cuerpo = "📌 *ASUNTOS PARTICULARES - Solicitudes próximas a vencer (menos de 15 días de antelación)*\n\n";
  cuerpo += "Las siguientes solicitudes de días de asuntos particulares siguen *pendientes* y tienen fechas cercanas:\n\n";

  solicitudes.forEach((s, index) => {
    cuerpo += `${index + 1}. 🗓️ *${s.fechaSolicitada}* - ${s.nombre} (${s.email})\n`;
    if (s.comentario) 
        cuerpo += `   📝 Comentario: ${s.comentario}\n`;
   
  });

  cuerpo += "\nPuedes revisarlas desde el panel de gestión habitual.";

  const asunto = "📌 *ASUNTOS PARTICULARES - Solicitudes próximas a vencer (pendientes de revisión)";
  destinatarios.forEach(email => {
    MailApp.sendEmail({
      to: email,
      subject: asunto,
      body: cuerpo,
    });
  });
}

