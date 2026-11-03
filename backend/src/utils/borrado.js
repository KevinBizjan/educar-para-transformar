// Respuesta común a los borrados del panel: si lo que se quiere eliminar tiene registros que dependen de él
// (pagos, facturas, inscripciones, notas...), la base lo impide con una violación de clave foránea (23503).
// Eso no es un error del servidor: se avisa con un 409 claro, sin mostrar los nombres internos de la base,
// y no se pierde ningún dato.
const { responderErrorInterno } = require('./errores');

const responderErrorDeBorrado = (res, err, quien) => {
    if (err && err.code === '23503') {
        return res.status(409).json({ message: `No se puede eliminar ${quien}: tiene registros asociados (por ejemplo pagos, facturas, inscripciones o notas) que se perderían.` });
    }
    return responderErrorInterno(res, err);
};

module.exports = { responderErrorDeBorrado };
