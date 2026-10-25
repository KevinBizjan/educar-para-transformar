// Reglas puras de los reportes de la Dirección: legajo, respuesta y exportación a CSV. Sin base de datos.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { legajo, diaCapitalizado, seccion, reporte, celdaCsv, aCsv, nombreArchivo, CATALOGO } = require('../src/utils/reportes');

describe('Reportes: formatos', () => {
    it('el legajo es el número de registro con prefijo y ceros', () => {
        assert.equal(legajo('A', 12), 'A-00012');
        assert.equal(legajo('D', 5), 'D-00005');
        assert.equal(legajo('A', 123456), 'A-123456');
    });

    it('los días van con mayúscula inicial', () => {
        assert.equal(diaCapitalizado(1), 'Lunes');
        assert.equal(diaCapitalizado(3), 'Miércoles');
        assert.equal(diaCapitalizado(9), '');
    });

    it('cada sección lleva sus columnas con clave y título, y el total de filas', () => {
        const s = seccion('Alumnos', [['apellido', 'Apellido'], ['nombre', 'Nombre']], [{ apellido: 'Paz', nombre: 'Ana' }]);
        assert.deepEqual(s.columnas, [{ clave: 'apellido', titulo: 'Apellido' }, { clave: 'nombre', titulo: 'Nombre' }]);
        assert.equal(s.total, 1);
        const r = reporte('Listado', [s], { curso_id: 3 });
        assert.equal(r.titulo, 'Listado');
        assert.deepEqual(r.filtros, { curso_id: 3 });
        assert.ok(!Number.isNaN(Date.parse(r.generado_en)));
    });

    it('el nombre del archivo lleva la fecha', () => {
        assert.equal(nombreArchivo('alumnos-por-curso', new Date('2026-10-25T12:00:00Z')), 'alumnos-por-curso_2026-10-25.csv');
    });
});

describe('Reportes: exportación a CSV', () => {
    it('escapa comas, comillas y saltos de línea', () => {
        assert.equal(celdaCsv('simple'), 'simple');
        assert.equal(celdaCsv('Pérez, Ana'), '"Pérez, Ana"');
        assert.equal(celdaCsv('dijo "hola"'), '"dijo ""hola"""');
        assert.equal(celdaCsv('línea 1\nlínea 2'), '"línea 1\nlínea 2"');
        assert.equal(celdaCsv(null), '');
        assert.equal(celdaCsv(undefined), '');
        assert.equal(celdaCsv(0), '0');
    });

    it('neutraliza las fórmulas (inyección en Excel)', () => {
        assert.equal(celdaCsv('=HYPERLINK("http://malo.com")'), '"\'=HYPERLINK(""http://malo.com"")"');
        assert.equal(celdaCsv('+54 362 4000000'), "'+54 362 4000000");
        assert.equal(celdaCsv('-cmd'), "'-cmd");
        assert.equal(celdaCsv('@usuario'), "'@usuario");
        assert.equal(celdaCsv('María'), 'María');
    });

    it('arma el CSV con título, encabezados, filas y BOM', () => {
        const s = seccion('Alumnos', [['legajo', 'Legajo'], ['alumno', 'Alumno']], [
            { legajo: 'A-00001', alumno: 'Paz, Ana' },
            { legajo: 'A-00002', alumno: 'Ruiz, Bo' },
        ]);
        const csv = aCsv(reporte('Alumnos por curso', [s]));
        assert.ok(csv.startsWith('﻿'));
        assert.deepEqual(csv.slice(1).split('\r\n'), [
            'Alumnos por curso', '', 'Legajo,Alumno', 'A-00001,"Paz, Ana"', 'A-00002,"Ruiz, Bo"', '',
        ]);
    });

    it('con varias secciones repite el título de cada una', () => {
        const a = seccion('Datos', [['k', 'Dato']], [{ k: 'x' }]);
        const b = seccion('Materias', [['m', 'Materia']], [{ m: 'Lengua' }]);
        const csv = aCsv(reporte('Por alumno', [a, b]));
        assert.ok(csv.includes('\r\nDatos\r\nDato\r\nx\r\n'));
        assert.ok(csv.includes('\r\nMaterias\r\nMateria\r\nLengua\r\n'));
    });

    it('una sección sin filas exporta solo los encabezados', () => {
        const csv = aCsv(reporte('Vacío', [seccion('S', [['a', 'A']], [])]));
        assert.deepEqual(csv.slice(1).split('\r\n'), ['Vacío', '', 'A', '']);
    });
});

describe('Reportes: catálogo', () => {
    it('define los 9 reportes de la Dirección, con id único', () => {
        assert.equal(CATALOGO.length, 9);
        assert.equal(new Set(CATALOGO.map((r) => r.id)).size, 9);
        for (const r of CATALOGO) {
            assert.ok(r.titulo && r.descripcion, `${r.id} sin título o descripción`);
            assert.ok(Array.isArray(r.filtros));
        }
    });

    it('los reportes por alumno y por docente exigen elegir a la persona', () => {
        assert.equal(CATALOGO.find((r) => r.id === 'alumno').filtros.find((f) => f.clave === 'alumno_id').obligatorio, true);
        assert.equal(CATALOGO.find((r) => r.id === 'docente').filtros.find((f) => f.clave === 'docente_id').obligatorio, true);
    });
});
