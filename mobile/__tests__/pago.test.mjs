// Pruebas de la lógica de "Pagar" (HU7): selección, total exacto, lo que se envía y los textos. Sin red.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    claveItem, alternarItem, itemsElegidos, totalElegido, seleccionarTodo, itemsParaEnviar, agruparItemsPorHijo,
    etiquetaFactura, colorFactura, lineasDatosBancarios, cargarPagables, cargarFacturas, crearFactura,
} from '../src/cuentas/pago.js';
import { setToken } from '../src/api/client.js';

const cuota = (extra = {}) => ({ tipo: 'cuota', alumno_id: 1, cuota_id: 10, alumno: 'Paz, Ana', monto: 15000, disponible: true, ...extra });
const servicio = (extra = {}) => ({ tipo: 'servicio', alumno_id: 1, inscripcion_id: 7, alumno: 'Paz, Ana', monto: 6000, disponible: true, ...extra });

describe('Selección de ítems para pagar', () => {
    it('la clave distingue la misma cuota en dos hijos y coincide con la del servidor', () => {
        assert.equal(claveItem(cuota()), 'cuota:1:10');
        assert.notEqual(claveItem(cuota()), claveItem(cuota({ alumno_id: 2 })));
        assert.equal(claveItem(servicio()), 'servicio:7');
    });

    it('agrega y quita ítems sin modificar la selección anterior', () => {
        const vacia = new Set();
        const una = alternarItem(vacia, cuota());
        assert.equal(vacia.size, 0);
        assert.deepEqual([...una], ['cuota:1:10']);
        assert.equal(alternarItem(una, cuota()).size, 0);
    });

    it('un ítem que ya está en una factura abierta no se puede elegir', () => {
        const bloqueada = cuota({ disponible: false, en_factura: 'EPT-20261030-ABC234' });
        const seleccion = new Set();
        assert.equal(alternarItem(seleccion, bloqueada), seleccion);
    });

    it('el total se suma en centavos exactos y solo con lo elegido y disponible', () => {
        const items = [cuota({ monto: 0.1 }), servicio({ monto: 0.2 }), cuota({ cuota_id: 11, monto: 12345.67 }), cuota({ cuota_id: 12, monto: 99, disponible: false })];
        assert.equal(totalElegido(items, new Set([claveItem(items[0]), claveItem(items[1])])), 0.3);
        assert.equal(totalElegido(items, new Set(items.map(claveItem))), 12345.97, 'el no disponible no suma aunque figure en la selección');
        assert.equal(totalElegido(items, new Set()), 0);
        assert.equal(totalElegido([cuota({ monto: 1.15 }), cuota({ cuota_id: 3, monto: 8.2 })], seleccionarTodo([cuota({ monto: 1.15 }), cuota({ cuota_id: 3, monto: 8.2 })])), 9.35);
    });

    it('si la lista se actualiza y un ítem elegido deja de estar disponible, se descarta', () => {
        const antes = [cuota(), servicio()];
        const seleccion = seleccionarTodo(antes);
        const despues = [cuota({ disponible: false }), servicio()];
        assert.deepEqual(itemsElegidos(despues, seleccion).map(claveItem), ['servicio:7']);
    });

    it('selecciona todo lo disponible', () => {
        assert.equal(seleccionarTodo([cuota(), servicio(), cuota({ cuota_id: 12, disponible: false })]).size, 2);
    });

    it('al servidor solo se le envía qué ítems, nunca los montos', () => {
        const items = [cuota(), servicio()];
        assert.deepEqual(itemsParaEnviar(items, seleccionarTodo(items)), [
            { tipo: 'cuota', alumno_id: 1, cuota_id: 10 }, { tipo: 'servicio', inscripcion_id: 7 },
        ]);
        assert.deepEqual(itemsParaEnviar(items, new Set()), []);
    });

    it('agrupa los ítems por hijo conservando el orden', () => {
        const grupos = agruparItemsPorHijo([cuota(), cuota({ alumno_id: 2, alumno: 'Paz, Leo', cuota_id: 11 }), servicio()]);
        assert.deepEqual(grupos.map((g) => [g.alumno, g.items.length]), [['Paz, Ana', 2], ['Paz, Leo', 1]]);
        assert.deepEqual(agruparItemsPorHijo([]), []);
    });
});

describe('Textos de la factura', () => {
    it('etiqueta y colorea cada estado, y uno desconocido no rompe la pantalla', () => {
        assert.equal(etiquetaFactura('Pendiente'), 'Pendiente de pago');
        assert.equal(etiquetaFactura('En revision'), 'En revisión');
        assert.equal(etiquetaFactura('Otro'), 'Otro');
        assert.notEqual(colorFactura('Pagada').fondo, colorFactura('Rechazada').fondo);
        assert.ok(colorFactura('inventado').fondo);
    });

    it('muestra los datos para transferir o avisa dónde consultarlos', () => {
        assert.deepEqual(lineasDatosBancarios({ titular: 'Escuela', cbu: '0000003100000000000001', alias: 'escuela.pagos' }),
            ['Titular: Escuela', 'CBU: 0000003100000000000001', 'Alias: escuela.pagos']);
        assert.match(lineasDatosBancarios(null)[0], /Consultá los datos bancarios/);
        assert.match(lineasDatosBancarios({})[0], /Consultá los datos bancarios/);
    });
});

describe('Llamadas a la API de pagos', () => {
    const fetchOriginal = globalThis.fetch;
    let llamadas;
    beforeEach(() => { llamadas = []; setToken('T1'); });
    afterEach(() => { globalThis.fetch = fetchOriginal; setToken(null); });
    const simular = (respuesta, estado = 200) => {
        globalThis.fetch = async (url, opciones) => {
            llamadas.push({ url, opciones });
            return { ok: estado < 400, status: estado, json: async () => respuesta };
        };
    };

    it('pide lo que se puede pagar y las facturas con el token de la sesión', async () => {
        simular({ items: [], total_disponible: 0 });
        await cargarPagables();
        await cargarFacturas();
        assert.match(llamadas[0].url, /\/api\/cuentas\/pagables$/);
        assert.match(llamadas[1].url, /\/api\/cuentas\/facturas$/);
        assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer T1');
    });

    it('crea la factura enviando solo los ítems elegidos', async () => {
        simular({ id: 5, referencia: 'EPT-20261030-ABC234', total: 21000 }, 201);
        const r = await crearFactura([{ tipo: 'servicio', inscripcion_id: 7 }]);
        assert.equal(r.referencia, 'EPT-20261030-ABC234');
        assert.equal(llamadas[0].opciones.method, 'POST');
        assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { items: [{ tipo: 'servicio', inscripcion_id: 7 }] });
    });

    it('si el servidor rechaza la factura, el mensaje llega a la pantalla', async () => {
        simular({ message: 'Un ítem ya está en la factura EPT-1' }, 409);
        await assert.rejects(() => crearFactura([{ tipo: 'servicio', inscripcion_id: 7 }]), (e) => e.estado === 409 && /EPT-1/.test(e.message));
    });
});
