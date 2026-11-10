// Respuestas a errores inesperados y a borrados bloqueados (HU13): nunca se le muestra al usuario el texto interno
// de la base, y un borrado con datos asociados es un 409, no un error del servidor. Sin base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { responderErrorInterno } = require('../src/utils/errores');
const { responderErrorDeBorrado } = require('../src/utils/borrado');
const fs = require('node:fs');
const path = require('node:path');

const respuestaFalsa = () => {
    const res = { req: { method: 'DELETE', originalUrl: '/api/academico/alumnos/7' } };
    res.status = (codigo) => { res.codigo = codigo; return res; };
    res.json = (cuerpo) => { res.cuerpo = cuerpo; return res; };
    return res;
};
// El log es esperado: se silencia para no ensuciar la salida de las pruebas y se comprueba lo que registra
const conLogSilenciado = (fn) => {
    const original = console.error;
    const registros = [];
    console.error = (...args) => registros.push(args);
    try { fn(); } finally { console.error = original; }
    return registros;
};

describe('Errores: respuestas sin detalles internos', () => {
    it('un error inesperado responde 500 genérico y deja el detalle en el log del servidor', () => {
        const res = respuestaFalsa();
        const error = new Error('relation "pagos" does not exist');
        const registros = conLogSilenciado(() => responderErrorInterno(res, error));
        assert.equal(res.codigo, 500);
        assert.deepEqual(res.cuerpo, { message: 'Error en el servidor' });
        assert.equal(registros.length, 1);
        assert.match(registros[0][0], /DELETE \/api\/academico\/alumnos\/7/);
        assert.equal(registros[0][1], error, 'el error completo queda registrado');
    });

    it('un borrado bloqueado por datos asociados es un 409 que nombra qué no se pudo eliminar', () => {
        const res = respuestaFalsa();
        const error = Object.assign(new Error('update or delete on table "alumnos" violates foreign key constraint "pagos_alumno_id_fkey"'), { code: '23503' });
        responderErrorDeBorrado(res, error, 'el alumno');
        assert.equal(res.codigo, 409);
        assert.match(res.cuerpo.message, /^No se puede eliminar el alumno: tiene registros asociados/);
        assert.doesNotMatch(res.cuerpo.message, /pagos_alumno_id_fkey|constraint|violates/);
    });

    it('cualquier otro error al borrar sigue siendo un 500 genérico', () => {
        const res = respuestaFalsa();
        conLogSilenciado(() => responderErrorDeBorrado(res, Object.assign(new Error('connection terminated'), { code: '57P01' }), 'la cuota'));
        assert.equal(res.codigo, 500);
        assert.deepEqual(res.cuerpo, { message: 'Error en el servidor' });
    });
});

describe('Errores: guardia sobre el código', () => {
    const archivos = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])));

    it('ninguna respuesta 500 devuelve el texto de la excepción (ni como message ni como error)', () => {
        const culpables = [];
        for (const archivo of archivos(path.join(__dirname, '../src'))) {
            fs.readFileSync(archivo, 'utf8').split(String.fromCharCode(10)).forEach((linea, i) => {
                const filtra = /error:\s*err\.message/.test(linea) || /status\(500\)\.json\(\{[^}]*err\.message/.test(linea);
                if (filtra) culpables.push(`${path.relative(path.join(__dirname, '..'), archivo)}:${i + 1}`);
            });
        }
        assert.deepEqual(culpables, [], 'usar responderErrorInterno (utils/errores.js)');
    });
});
