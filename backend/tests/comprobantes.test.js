// Comprobantes de transferencia (HU8): validación de archivos, almacenamiento y API contra un PostgreSQL REAL.
// Storage se reemplaza por uno falso en memoria: las pruebas nunca tocan Supabase.
// La parte de la API solo corre si DATABASE_URL apunta a localhost.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_BYTES, MAX_POR_FACTURA, detectarTipo, estaCompleto, decodificarBase64, nombreSeguro, validarArchivo, rutaStorage,
} = require('../src/utils/comprobantes');
const { AlmacenError, crearAlmacenSupabase, almacenDesdeEntorno, usarAlmacen } = require('../src/services/almacenamiento');

// Archivos de prueba mínimos pero con el formato real
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(40, 7), Buffer.from([0xff, 0xd9])]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
const b64 = (buffer) => buffer.toString('base64');
const pedido = (buffer, tipo, nombre = 'transferencia') => ({ nombre, tipo_mime: tipo, contenido: b64(buffer) });

describe('Comprobantes: validación del archivo', () => {
    it('reconoce PNG, JPG y PDF por su contenido', () => {
        assert.equal(detectarTipo(PNG), 'image/png');
        assert.equal(detectarTipo(JPG), 'image/jpeg');
        assert.equal(detectarTipo(PDF), 'application/pdf');
        assert.equal(detectarTipo(Buffer.from('GIF89a....')), null);
        assert.equal(detectarTipo(Buffer.from('hola, soy texto')), null);
        assert.equal(detectarTipo(Buffer.alloc(0)), null);
    });

    it('un archivo cortado no está completo', () => {
        assert.equal(estaCompleto(PNG, 'image/png'), true);
        assert.equal(estaCompleto(PNG.subarray(0, PNG.length - 4), 'image/png'), false);
        assert.equal(estaCompleto(JPG, 'image/jpeg'), true);
        assert.equal(estaCompleto(JPG.subarray(0, JPG.length - 1), 'image/jpeg'), false);
        assert.equal(estaCompleto(PDF, 'application/pdf'), true);
        assert.equal(estaCompleto(PDF.subarray(0, 30), 'application/pdf'), false);
    });

    it('decodifica base64 estricto, con o sin prefijo, y rechaza lo que no lo es', () => {
        assert.deepEqual(decodificarBase64(b64(PNG)), PNG);
        assert.deepEqual(decodificarBase64(`data:image/png;base64,${b64(PNG)}`), PNG);
        assert.deepEqual(decodificarBase64(b64(PNG).replace(/(.{20})/g, '$1\n')), PNG, 'ignora los saltos de línea');
        for (const mala of [undefined, null, 5, '', '   ', 'abc', 'no es base64!!', '@@@@', 'AAA=A']) assert.equal(decodificarBase64(mala), null, String(mala));
    });

    it('acepta un archivo válido y limpia el nombre', () => {
        const r = validarArchivo(pedido(PNG, 'image/png', '  ../../secreto/ticket.png\n '));
        assert.equal(r.tipo, 'image/png');
        assert.ok(!/[\\/\n]/.test(r.nombre), r.nombre);
        assert.deepEqual(r.buffer, PNG);
        assert.equal(nombreSeguro('', 'pdf'), 'comprobante.pdf');
        assert.equal(nombreSeguro('x'.repeat(500), 'png').length, 120);
    });

    it('rechaza el formato no permitido, el falso, el vacío, el dañado y el que pesa de más', () => {
        const casos = [
            [{ nombre: 'a', tipo_mime: 'image/gif', contenido: b64(PNG) }, 400, /PNG, JPG o PDF/],
            [{ nombre: 'a', tipo_mime: 'text/plain', contenido: b64(Buffer.from('hola')) }, 400, /PNG, JPG o PDF/],
            [pedido(Buffer.from('hola, soy texto'), 'image/png'), 400, /PNG, JPG o PDF/],
            [pedido(PDF, 'image/png'), 400, /no coincide/],
            [pedido(PNG, 'application/pdf'), 400, /no coincide/],
            [pedido(PNG.subarray(0, PNG.length - 4), 'image/png'), 400, /dañado/],
            [pedido(JPG.subarray(0, 20), 'image/jpeg'), 400, /dañado/],
            [pedido(PDF.subarray(0, 20), 'application/pdf'), 400, /dañado/],
            [{ nombre: 'a', tipo_mime: 'image/png', contenido: 'no es base64!!' }, 400, /no es válido/],
            [{ nombre: 'a', tipo_mime: 'image/png' }, 400, /no es válido/],
            [undefined, 400, /PNG, JPG o PDF/],
        ];
        for (const [entrada, estado, texto] of casos) {
            const r = validarArchivo(entrada);
            assert.equal(r.estado, estado, String(JSON.stringify(entrada)).slice(0, 80));
            assert.match(r.error, texto);
        }
        const grande = Buffer.concat([JPG.subarray(0, JPG.length - 2), Buffer.alloc(MAX_BYTES), Buffer.from([0xff, 0xd9])]);
        assert.deepEqual([validarArchivo(pedido(grande, 'image/jpeg')).estado, validarArchivo(pedido(grande, 'image/jpeg')).error], [413, 'El archivo supera los 5 MB']);
        const justo = Buffer.concat([JPG.subarray(0, JPG.length - 2), Buffer.alloc(MAX_BYTES - JPG.length), Buffer.from([0xff, 0xd9])]);
        assert.equal(justo.length, MAX_BYTES);
        assert.equal(validarArchivo(pedido(justo, 'image/jpeg')).error, undefined, '5 MB exactos se aceptan');
    });

    it('la ruta lleva al padre, la factura y un nombre al azar con la extensión real', () => {
        assert.equal(rutaStorage(4, 9, 'application/pdf', 'abc123'), '4/9/abc123.pdf');
        assert.equal(rutaStorage(4, 9, 'image/jpeg', 'x'), '4/9/x.jpg');
        assert.equal(MAX_POR_FACTURA >= 2, true, 'hay lugar para más de un comprobante por factura');
    });
});

describe('Almacenamiento en Supabase Storage', () => {
    const clienteFalso = (resultado = {}) => {
        const llamadas = [];
        return {
            llamadas,
            storage: {
                from: (bucket) => ({
                    upload: async (ruta, cuerpo, opciones) => { llamadas.push(['upload', bucket, ruta, cuerpo, opciones]); return resultado.upload || { error: null }; },
                    createSignedUrl: async (ruta, seg) => { llamadas.push(['firmar', bucket, ruta, seg]); return resultado.firma || { data: { signedUrl: 'https://x/firmada' }, error: null }; },
                    remove: async (rutas) => { llamadas.push(['borrar', bucket, rutas]); return resultado.borrar || { error: null }; },
                }),
            },
        };
    };

    it('sube al bucket indicado con su tipo y sin pisar archivos', async () => {
        const cliente = clienteFalso();
        const almacen = crearAlmacenSupabase({ bucket: 'comprobantes', cliente });
        await almacen.subir('1/2/a.png', PNG, 'image/png');
        assert.deepEqual(cliente.llamadas[0].slice(0, 3), ['upload', 'comprobantes', '1/2/a.png']);
        assert.deepEqual(cliente.llamadas[0][4], { contentType: 'image/png', upsert: false });
        assert.equal(await almacen.urlFirmada('1/2/a.png', 120), 'https://x/firmada');
        assert.deepEqual(cliente.llamadas[1], ['firmar', 'comprobantes', '1/2/a.png', 120]);
        await almacen.borrar('1/2/a.png');
        assert.deepEqual(cliente.llamadas[2], ['borrar', 'comprobantes', ['1/2/a.png']]);
    });

    it('un error de Storage se informa como AlmacenError', async () => {
        const mal = { error: { message: 'bucket inexistente' } };
        const almacen = crearAlmacenSupabase({ cliente: clienteFalso({ upload: mal, firma: mal, borrar: mal }) });
        await assert.rejects(() => almacen.subir('r', PNG, 'image/png'), (e) => e instanceof AlmacenError && /bucket inexistente/.test(e.message));
        await assert.rejects(() => almacen.urlFirmada('r'), AlmacenError);
        await assert.rejects(() => almacen.borrar('r'), AlmacenError);
    });

    it('sin la configuración del servidor, el almacenamiento no está disponible', () => {
        assert.equal(almacenDesdeEntorno({}), null);
        assert.equal(almacenDesdeEntorno({ SUPABASE_URL: 'https://x.supabase.co' }), null, 'falta la clave');
        assert.equal(almacenDesdeEntorno({ SUPABASE_SERVICE_KEY: 'k' }), null, 'falta la dirección');
        assert.ok(almacenDesdeEntorno({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'clave-de-prueba' }));
    });
});

const dbUrl = process.env.DATABASE_URL || '';
const skip = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
    ? false
    : 'Solo corre contra un PostgreSQL local (DATABASE_URL con localhost) para no escribir datos de prueba en la base real.';

describe('API de comprobantes (HU8)', { skip }, () => {
    let server, base, db, tokenAdmin, tutor, token, otroToken;
    const ids = { facturas: [] };
    let almacen;

    const crearFalso = () => {
        const falso = {
            archivos: new Map(), borrados: [], falla: false, alSubir: null,
            async subir(ruta, buffer, tipo) {
                if (falso.falla) throw new AlmacenError('almacenamiento caído');
                if (falso.alSubir) await falso.alSubir();
                falso.archivos.set(ruta, { buffer, tipo });
            },
            async urlFirmada(ruta, segundos) {
                if (!falso.archivos.has(ruta)) throw new AlmacenError('no existe');
                return `https://storage.invalido/${ruta}?token=t&expira=${segundos}`;
            },
            async borrar(ruta) { falso.borrados.push(ruta); falso.archivos.delete(ruta); },
        };
        return falso;
    };

    async function api(method, path, { token: t, body } = {}) {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch { /* sin JSON */ }
        return { status: res.status, data };
    }
    const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } })).data.token;
    let seq = 0;
    const factura = async (estado = 'Pendiente') => {
        const id = (await db.query('INSERT INTO facturas (tutor_id, referencia, total, estado) VALUES ($1, $2, 1000, $3) RETURNING id', [tutor.id, `HU8-${Date.now()}-${++seq}`, estado])).rows[0].id;
        ids.facturas.push(id);
        return id;
    };
    const subir = (id, cuerpo, t = token) => api('POST', `/api/cuentas/facturas/${id}/comprobantes`, { token: t, body: cuerpo });
    const estadoDe = async (id) => (await db.query('SELECT estado FROM facturas WHERE id = $1', [id])).rows[0].estado;
    const filasDe = async (id) => (await db.query('SELECT COUNT(*)::int AS n FROM comprobantes_pago WHERE factura_id = $1', [id])).rows[0].n;

    before(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
        db = require('../src/config/database');
        await db.ready;
        const app = require('../src/app');
        server = app.listen(0);
        base = `http://127.0.0.1:${server.address().port}`;
        tokenAdmin = await login('admin', 'admin123');
        otroToken = await login('padre', 'padre123');
        const username = `hu8-${Date.now()}`;
        const r = await api('POST', '/api/auth/users', { token: tokenAdmin, body: { nombre: 'Familia Comprobantes', username, password: 'Compro123!', rol: 'padre' } });
        assert.equal(r.status, 201);
        tutor = { id: r.data.id };
        token = await login(username, 'Compro123!');
    });

    beforeEach(() => { almacen = crearFalso(); usarAlmacen(almacen); });

    after(async () => {
        usarAlmacen(undefined);
        await db.query('DELETE FROM facturas WHERE tutor_id = $1', [tutor.id]); // los comprobantes se van en cascada
        if (tutor) await api('DELETE', `/api/auth/users/${tutor.id}`, { token: tokenAdmin });
        if (server) await new Promise((resolve) => server.close(resolve));
        if (db) await db.end();
    });

    it('guarda el comprobante en Storage y en la base, y la factura pasa a "En revisión"', async () => {
        const id = await factura();
        const r = await subir(id, pedido(PNG, 'image/png', 'transferencia-1.png'));
        assert.equal(r.status, 201, JSON.stringify(r.data));
        assert.equal(r.data.factura_estado, 'En revision');
        assert.deepEqual([r.data.comprobante.nombre_archivo, r.data.comprobante.tipo_mime, r.data.comprobante.tamano_bytes], ['transferencia-1.png', 'image/png', PNG.length]);
        assert.equal(await estadoDe(id), 'En revision');
        const [ruta, guardado] = [...almacen.archivos.entries()][0];
        assert.match(ruta, new RegExp(`^${tutor.id}/${id}/[0-9a-f]{24}\\.png$`));
        assert.deepEqual(guardado.buffer, PNG);
        assert.equal((await db.query('SELECT ruta_storage FROM comprobantes_pago WHERE id = $1', [r.data.comprobante.id])).rows[0].ruta_storage, ruta);
    });

    it('admite varios comprobantes por factura y los lista en orden', async () => {
        const id = await factura();
        for (const [buffer, tipo, nombre] of [[PNG, 'image/png', 'a.png'], [PDF, 'application/pdf', 'b.pdf'], [JPG, 'image/jpeg', 'c.jpg']]) {
            assert.equal((await subir(id, pedido(buffer, tipo, nombre))).status, 201);
        }
        const lista = await api('GET', `/api/cuentas/facturas/${id}/comprobantes`, { token });
        assert.equal(lista.status, 200);
        assert.deepEqual(lista.data.comprobantes.map((c) => c.nombre_archivo), ['a.png', 'b.pdf', 'c.jpg']);
        assert.equal(lista.data.factura_estado, 'En revision');
        assert.equal(lista.data.maximo, MAX_POR_FACTURA);
        assert.equal(almacen.archivos.size, 3);
    });

    it('rechaza formatos inválidos y archivos dañados sin guardar nada', async () => {
        const id = await factura();
        const malos = [
            [{ nombre: 'a.gif', tipo_mime: 'image/gif', contenido: b64(PNG) }, 400],
            [pedido(PDF, 'image/png'), 400],
            [pedido(PNG.subarray(0, PNG.length - 4), 'image/png'), 400],
            [{ nombre: 'a.png', tipo_mime: 'image/png', contenido: 'no es base64!!' }, 400],
            [{}, 400],
        ];
        for (const [cuerpo, estado] of malos) assert.equal((await subir(id, cuerpo)).status, estado, JSON.stringify(cuerpo).slice(0, 70));
        const enorme = Buffer.concat([JPG.subarray(0, JPG.length - 2), Buffer.alloc(MAX_BYTES), Buffer.from([0xff, 0xd9])]);
        assert.equal((await subir(id, pedido(enorme, 'image/jpeg'))).status, 413);
        assert.equal(almacen.archivos.size, 0, 'nada llegó a Storage');
        assert.equal(await filasDe(id), 0);
        assert.equal(await estadoDe(id), 'Pendiente', 'la factura sigue esperando su comprobante');
    });

    it('un cuerpo mayor al límite de la ruta lo corta el servidor', async () => {
        const id = await factura();
        const r = await subir(id, { nombre: 'a', tipo_mime: 'image/png', contenido: 'A'.repeat(9 * 1024 * 1024) });
        assert.equal(r.status, 413);
    });

    it('una factura admite hasta el máximo de comprobantes', async () => {
        const id = await factura();
        for (let i = 0; i < MAX_POR_FACTURA; i++) assert.equal((await subir(id, pedido(PNG, 'image/png', `c${i}.png`))).status, 201);
        const de_mas = await subir(id, pedido(PNG, 'image/png', 'de-mas.png'));
        assert.equal(de_mas.status, 409);
        assert.match(de_mas.data.message, /hasta 10/);
        assert.equal(almacen.archivos.size, MAX_POR_FACTURA);
    });

    it('una factura pagada o rechazada ya no admite ni quita comprobantes', async () => {
        for (const estado of ['Pagada', 'Rechazada']) {
            const id = await factura(estado);
            const r = await subir(id, pedido(PNG, 'image/png'));
            assert.equal(r.status, 409, estado);
            assert.equal(almacen.archivos.size, 0);
        }
        const id = await factura();
        const ok = await subir(id, pedido(PNG, 'image/png'));
        await db.query("UPDATE facturas SET estado = 'Pagada' WHERE id = $1", [id]);
        const borrar = await api('DELETE', `/api/cuentas/comprobantes/${ok.data.comprobante.id}`, { token });
        assert.equal(borrar.status, 409);
        assert.equal(await filasDe(id), 1, 'el comprobante de una factura pagada queda como constancia');
    });

    it('solo el dueño sube, lista y ve los comprobantes de su factura', async () => {
        const id = await factura();
        const ok = await subir(id, pedido(PNG, 'image/png'));
        assert.equal((await subir(id, pedido(PNG, 'image/png'), otroToken)).status, 403);
        assert.equal((await api('GET', `/api/cuentas/facturas/${id}/comprobantes`, { token: otroToken })).status, 403);
        assert.equal((await api('GET', `/api/cuentas/comprobantes/${ok.data.comprobante.id}/url`, { token: otroToken })).status, 403);
        assert.equal((await api('DELETE', `/api/cuentas/comprobantes/${ok.data.comprobante.id}`, { token: otroToken })).status, 403);
        assert.equal((await subir(999999999, pedido(PNG, 'image/png'))).status, 404);
        assert.equal((await api('GET', '/api/cuentas/comprobantes/999999999/url', { token })).status, 404);
        assert.equal((await subir('abc', pedido(PNG, 'image/png'))).status, 400);
        for (const t of [tokenAdmin, await login('docente', 'docente123'), await login('alumno', 'alumno123'), null]) {
            assert.equal((await subir(id, pedido(PNG, 'image/png'), t)).status, 403);
            assert.equal((await api('GET', `/api/cuentas/facturas/${id}/comprobantes`, { token: t })).status, 403);
        }
        assert.equal(await filasDe(id), 1);
    });

    it('si Storage falla no queda registro ni cambia la factura', async () => {
        const id = await factura();
        almacen.falla = true;
        const r = await subir(id, pedido(PNG, 'image/png'));
        assert.equal(r.status, 502);
        assert.doesNotMatch(r.data.message, /caído/, 'no se filtran detalles internos');
        assert.equal(await filasDe(id), 0);
        assert.equal(await estadoDe(id), 'Pendiente');
    });

    it('si el registro falla después de subir el archivo, se borra de Storage (sin huérfanos)', async () => {
        const id = await factura();
        // Justo mientras se sube el archivo, la factura desaparece: el registro no se puede crear
        almacen.alSubir = async () => { await db.query('DELETE FROM facturas WHERE id = $1', [id]); };
        const r = await subir(id, pedido(PNG, 'image/png'));
        assert.equal(r.status, 404);
        assert.equal(almacen.archivos.size, 0, 'el archivo subido se retiró');
        assert.equal(almacen.borrados.length, 1);
    });

    it('sin almacenamiento configurado responde 503 y no toca la base', async () => {
        const id = await factura();
        usarAlmacen(null);
        const r = await subir(id, pedido(PNG, 'image/png'));
        assert.equal(r.status, 503);
        assert.match(r.data.message, /no está configurado/);
        assert.equal(await filasDe(id), 0);
    });

    it('da un enlace temporal para ver el archivo (el bucket es privado)', async () => {
        const id = await factura();
        const ok = await subir(id, pedido(PDF, 'application/pdf', 'constancia.pdf'));
        const r = await api('GET', `/api/cuentas/comprobantes/${ok.data.comprobante.id}/url`, { token });
        assert.equal(r.status, 200);
        assert.equal(r.data.vence_en_segundos, 600);
        assert.match(r.data.url, new RegExp(`^https://storage\\.invalido/${tutor.id}/${id}/[0-9a-f]{24}\\.pdf\\?`));
    });

    it('permite corregir un archivo equivocado, y sin comprobantes la factura vuelve a "Pendiente"', async () => {
        const id = await factura();
        const a = await subir(id, pedido(PNG, 'image/png', 'a.png'));
        const b = await subir(id, pedido(JPG, 'image/jpeg', 'b.jpg'));
        assert.equal((await api('DELETE', `/api/cuentas/comprobantes/${a.data.comprobante.id}`, { token })).status, 200);
        assert.equal(await filasDe(id), 1);
        assert.equal(await estadoDe(id), 'En revision', 'todavía queda uno');
        assert.equal(almacen.archivos.size, 1);
        assert.equal((await api('DELETE', `/api/cuentas/comprobantes/${b.data.comprobante.id}`, { token })).status, 200);
        assert.equal(await estadoDe(id), 'Pendiente');
        assert.equal(almacen.archivos.size, 0);
    });
});
