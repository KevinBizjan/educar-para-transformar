// Respuesta común a un error inesperado del servidor (una consulta que falla, un valor que no debía faltar...).
// Al cliente solo le llega un mensaje genérico: el texto de la excepción puede traer nombres de tablas, columnas o
// restricciones de la base. El detalle completo queda en el log del servidor para poder diagnosticarlo.
const responderErrorInterno = (res, err) => {
    const pedido = res.req ? `${res.req.method} ${res.req.originalUrl}` : 'pedido';
    console.error(`Error inesperado en ${pedido}:`, err);
    return res.status(500).json({ message: 'Error en el servidor' });
};

module.exports = { responderErrorInterno };
