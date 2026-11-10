import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatearMonto } from '../familia/resumen.js';
import { formatearMomento, describirPago } from '../cuentas/cuotas.js';
import { etiquetaFactura, colorFactura } from '../cuentas/pago.js';
import {
    RANGOS, rangoRapido, describirRango, cargarHistorial, cargarHijos, enlacePdf, filasResumen, mensajeHistorialVacio, opcionesHijos, totalesDeFactura, describirComprobanteLinea,
} from '../cuentas/historial.js';
import { urlComprobante } from '../cuentas/comprobantes.js';
import { estilos, colores } from './estilos.js';

// Historial de deudas y pagos (HU9): las facturas de un período con su desglose por ítem, los pagos que registró la
// institución y un resumen de totales. Se puede acotar a un hijo, y cada factura muestra los comprobantes que tiene
// adjuntos. Se puede descargar o ver en PDF todo el historial o cada factura.
export default function HistorialFacturas() {
    const [rangoId, setRangoId] = useState('tres');
    const [hijos, setHijos] = useState([]);
    const [alumnoId, setAlumnoId] = useState(null); // null = todos los hijos
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [abriendo, setAbriendo] = useState(''); // qué PDF se está pidiendo ('historial' o 'factura-<id>')
    const [error, setError] = useState('');
    const pedidoActual = useRef(0);
    const rango = rangoRapido(rangoId);

    const cargar = useCallback(async (id, alumno) => {
        const numero = ++pedidoActual.current;
        setError('');
        setCargando(true);
        try {
            const nuevos = await cargarHistorial({ ...rangoRapido(id), alumnoId: alumno });
            if (numero === pedidoActual.current) setDatos(nuevos);
        } catch (e) {
            if (numero === pedidoActual.current) setError(e.message);
        } finally {
            if (numero === pedidoActual.current) setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(rangoId, alumnoId); }, [rangoId, alumnoId, cargar]);

    // La lista de hijos se pide una sola vez; si falla, el historial igual se ve completo (solo falta el selector)
    useEffect(() => { cargarHijos().then(setHijos).catch(() => {}); }, []);
    const selector = opcionesHijos(hijos);
    const hijoElegido = hijos.find((h) => h.id === alumnoId);

    const verComprobante = async (comprobante) => {
        setError('');
        try {
            const { url } = await urlComprobante(comprobante.id);
            await Linking.openURL(url);
        } catch (e) {
            setError(e.message);
        }
    };

    const abrirPdf = async (clave, pedido) => {
        setAbriendo(clave);
        setError('');
        try {
            await Linking.openURL(await enlacePdf({ ...pedido, alumnoId }));
        } catch (e) {
            setError(e.message);
        } finally {
            setAbriendo('');
        }
    };

    const vacio = datos && datos.facturas.length === 0 && datos.otros_pagos.length === 0;

    return (
        <View>
            <View style={local.rangos}>
                {RANGOS.map((r) => (
                    <Pressable key={r.id} onPress={() => setRangoId(r.id)} accessibilityRole="tab" accessibilityState={{ selected: rangoId === r.id }} style={[local.rango, rangoId === r.id && local.rangoActivo]}>
                        <Text style={[local.rangoTexto, rangoId === r.id && local.rangoTextoActivo]}>{r.texto}</Text>
                    </Pressable>
                ))}
            </View>
            {selector.length > 0 && (
                <View style={local.rangos}>
                    {selector.map((o) => (
                        <Pressable key={String(o.id)} onPress={() => setAlumnoId(o.id)} accessibilityRole="tab" accessibilityState={{ selected: alumnoId === o.id }} style={[local.rango, alumnoId === o.id && local.rangoActivo]}>
                            <Text numberOfLines={1} style={[local.rangoTexto, alumnoId === o.id && local.rangoTextoActivo]}>{o.texto}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
            <Text style={local.periodo}>{describirRango(rango)}{hijoElegido ? ` · ${hijoElegido.nombre}` : ''}</Text>

            {!!error && (
                <View style={local.aviso}>
                    <Text style={local.avisoTexto}>{error}</Text>
                    <Pressable onPress={() => cargar(rangoId, alumnoId)}><Text style={local.enlace}>Reintentar</Text></Pressable>
                </View>
            )}
            {cargando && <ActivityIndicator size="large" color={colores.azul} style={{ marginTop: 24 }} />}

            {datos && !cargando && (
                <>
                    <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                        <Text style={estilos.etiqueta}>Resumen del período</Text>
                        {filasResumen(datos.resumen).map((f) => (
                            <View key={f.texto} style={local.filaResumen}>
                                <Text style={estilos.texto}>{f.texto}</Text>
                                <Text style={[local.monto, f.bueno && { color: colores.ok }, f.alerta && { color: colores.error }]}>{formatearMonto(f.monto)}</Text>
                            </View>
                        ))}
                        <Pressable
                            style={[estilos.botonSecundario, abriendo === 'historial' && estilos.botonDeshabilitado]}
                            disabled={!!abriendo}
                            onPress={() => abrirPdf('historial', { tipo: 'historial', ...rango })}
                            accessibilityRole="button"
                        >
                            {abriendo === 'historial' ? <ActivityIndicator color={colores.azul} /> : <Text style={estilos.botonTextoSecundario}>Ver historial en PDF</Text>}
                        </Pressable>
                    </View>

                    {vacio && (
                        <View style={estilos.tarjeta}>
                            <Text style={[estilos.texto, { textAlign: 'center' }]}>{mensajeHistorialVacio(rango, { hijo: hijoElegido ? hijoElegido.nombre : '' })}</Text>
                        </View>
                    )}

                    {datos.facturas.map((f) => {
                        const color = colorFactura(f.estado);
                        const { total, totalFactura } = totalesDeFactura(f);
                        return (
                            <View key={f.id} style={[estilos.tarjeta, { marginBottom: 12 }]}>
                                <View style={local.cabecera}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={local.referencia}>{f.referencia}</Text>
                                        <Text style={local.detalle}>{formatearMomento(f.emitida_en)}</Text>
                                    </View>
                                    <View style={[local.insignia, { backgroundColor: color.fondo }]}>
                                        <Text style={{ color: color.texto, fontWeight: '800', fontSize: 12 }}>{etiquetaFactura(f.estado)}</Text>
                                    </View>
                                </View>
                                {f.items.map((i, n) => (
                                    <View key={`${f.id}-${n}`} style={local.item}>
                                        <Text style={[local.itemTexto, { flex: 1 }]}>{i.descripcion}</Text>
                                        <Text style={local.itemMonto}>{formatearMonto(i.monto)}</Text>
                                    </View>
                                ))}
                                <Text style={local.seccionChica}>Comprobantes ({f.comprobantes.length})</Text>
                                {f.comprobantes.length === 0 && <Text style={local.detalle}>Todavía no se adjuntó ningún comprobante.</Text>}
                                {f.comprobantes.map((c) => (
                                    <View key={c.id} style={local.item}>
                                        <Text style={[local.itemTexto, { flex: 1 }]}>{describirComprobanteLinea(c)}</Text>
                                        <Pressable onPress={() => verComprobante(c)} accessibilityRole="button"><Text style={local.enlace}>Ver</Text></Pressable>
                                    </View>
                                ))}
                                {f.estado === 'Rechazada' && !!f.motivo_rechazo && <Text style={local.motivo}>Motivo: {f.motivo_rechazo}</Text>}
                                {f.estado === 'Pagada' && !!f.pagada_en && <Text style={local.detalle}>Pagada el {formatearMomento(f.pagada_en)}</Text>}
                                <View style={local.pie}>
                                    <Pressable disabled={!!abriendo} onPress={() => abrirPdf(`factura-${f.id}`, { tipo: 'factura', id: f.id })} accessibilityRole="button">
                                        {abriendo === `factura-${f.id}` ? <ActivityIndicator color={colores.azul} /> : <Text style={local.enlace}>Comprobante en PDF</Text>}
                                    </Pressable>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Text style={local.total}>{totalFactura === null ? 'Total' : 'Su parte'} {formatearMonto(total)}</Text>
                                        {totalFactura !== null && <Text style={local.detalle}>Factura completa {formatearMonto(totalFactura)}</Text>}
                                    </View>
                                </View>
                            </View>
                        );
                    })}

                    {datos.otros_pagos.length > 0 && (
                        <>
                            <Text style={local.seccion}>Pagos registrados en la institución</Text>
                            {datos.otros_pagos.map((p) => (
                                <View key={p.id} style={[estilos.tarjeta, local.otroPago]}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={local.referencia}>{p.alumno}</Text>
                                        <Text style={local.detalle}>{describirPago({ ...p, cuota_mes: p.cuota_mes, cuota_anio: p.cuota_anio })}</Text>
                                        <Text style={local.detalle}>{formatearMomento(p.fecha_pago)}</Text>
                                    </View>
                                    <Text style={[local.monto, { color: colores.ok }]}>{formatearMonto(p.monto)}</Text>
                                </View>
                            ))}
                        </>
                    )}
                </>
            )}
        </View>
    );
}

const local = StyleSheet.create({
    rangos: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: 8, elevation: 1 },
    rango: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
    rangoActivo: { backgroundColor: colores.azul },
    rangoTexto: { fontSize: 13, fontWeight: '700', color: colores.suave },
    rangoTextoActivo: { color: '#fff' },
    periodo: { fontSize: 13, color: colores.suave, textAlign: 'center', marginBottom: 12 },
    aviso: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginBottom: 14 },
    avisoTexto: { color: colores.error, fontWeight: '700' },
    enlace: { color: colores.azul, fontWeight: '800', fontSize: 14 },
    filaResumen: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    monto: { fontSize: 15, fontWeight: '800', color: colores.texto },
    cabecera: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
    referencia: { fontSize: 15, fontWeight: '800', color: colores.texto },
    detalle: { fontSize: 13, color: colores.suave, marginTop: 2 },
    insignia: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginLeft: 8 },
    item: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3 },
    itemTexto: { fontSize: 13, color: colores.texto },
    itemMonto: { fontSize: 13, fontWeight: '700', color: colores.texto, marginLeft: 8 },
    motivo: { fontSize: 13, color: colores.error, fontWeight: '700', marginTop: 6 },
    pie: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 },
    total: { fontSize: 15, fontWeight: '800', color: colores.azul },
    seccionChica: { fontSize: 12, fontWeight: '700', color: colores.suave, textTransform: 'uppercase', marginTop: 10, marginBottom: 4 },
    seccion: { fontSize: 16, fontWeight: '800', color: colores.texto, marginTop: 8, marginBottom: 10 },
    otroPago: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
});
