import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatearMonto } from '../familia/resumen.js';
import { formatearMomento } from '../cuentas/cuotas.js';
import {
    claveItem, alternarItem, itemsElegidos, totalElegido, seleccionarTodo, itemsParaEnviar, agruparItemsPorHijo,
    etiquetaFactura, colorFactura, lineasDatosBancarios, cargarPagables, cargarFacturas, crearFactura,
} from '../cuentas/pago.js';
import { estilos, colores } from './estilos.js';

// "Pagar": el padre elige cuotas y servicios, ve el total exacto y genera una factura con su referencia para pagar
// por transferencia bancaria. No hay pagos en efectivo.
export default function PagarScreen() {
    const [items, setItems] = useState(null);
    const [facturas, setFacturas] = useState([]);
    const [seleccion, setSeleccion] = useState(new Set());
    const [creada, setCreada] = useState(null); // la factura recién generada, con los datos para transferir
    const [cargando, setCargando] = useState(false);
    const [refrescando, setRefrescando] = useState(false);
    const [creando, setCreando] = useState(false);
    const [error, setError] = useState('');
    const pedidoActual = useRef(0);

    const cargar = useCallback(async (manual = false) => {
        const id = ++pedidoActual.current;
        setError('');
        if (manual) setRefrescando(true); else setCargando(true);
        try {
            const [pagables, emitidas] = await Promise.all([cargarPagables(), cargarFacturas()]);
            if (id !== pedidoActual.current) return;
            setItems(pagables.items);
            setFacturas(emitidas.facturas);
            // Lo elegido que ya no está disponible (por ejemplo, porque se facturó) se descarta
            setSeleccion((anterior) => new Set(itemsElegidos(pagables.items, anterior).map(claveItem)));
        } catch (e) {
            if (id === pedidoActual.current) setError(e.message);
        } finally {
            if (id === pedidoActual.current) { setCargando(false); setRefrescando(false); }
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const total = items ? totalElegido(items, seleccion) : 0;
    const cantidad = items ? itemsElegidos(items, seleccion).length : 0;
    const disponibles = items ? items.filter((i) => i.disponible).length : 0;

    const generar = () => {
        Alert.alert(
            'Generar factura',
            `Vas a generar una factura por ${formatearMonto(total)} (${cantidad} ${cantidad === 1 ? 'ítem' : 'ítems'}) para pagar por transferencia bancaria.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Generar', onPress: confirmar },
            ]
        );
    };

    const confirmar = async () => {
        setCreando(true);
        setError('');
        try {
            const factura = await crearFactura(itemsParaEnviar(items, seleccion));
            setCreada(factura);
            setSeleccion(new Set());
            cargar(true);
        } catch (e) {
            setError(e.message);
            cargar(true); // la lista pudo haber cambiado: se actualiza para no mostrar ítems viejos
        } finally {
            setCreando(false);
        }
    };

    if (creada) return <FacturaGenerada factura={creada} alVolver={() => setCreada(null)} />;

    return (
        <ScrollView
            contentContainerStyle={local.contenido}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} tintColor={colores.azul} />}
        >
            <Text style={estilos.titulo}>Pagar</Text>
            <Text style={[estilos.subtitulo, { marginBottom: 12 }]}>Elegí qué querés pagar. El pago es solo por transferencia bancaria, sin efectivo.</Text>

            {!!error && (
                <View style={local.aviso}>
                    <Text style={local.avisoTexto}>{error}</Text>
                    <Pressable onPress={() => cargar()}><Text style={local.reintentar}>Actualizar</Text></Pressable>
                </View>
            )}

            {cargando && !items && <ActivityIndicator size="large" color={colores.azul} style={{ marginTop: 32 }} />}

            {items && items.length === 0 && (
                <View style={estilos.tarjeta}>
                    <Text style={[estilos.texto, { textAlign: 'center' }]}>¡Estás al día! No tenés cuotas ni servicios para pagar.</Text>
                </View>
            )}

            {items && disponibles > 0 && (
                <Pressable onPress={() => setSeleccion(cantidad === disponibles ? new Set() : seleccionarTodo(items))} style={{ alignSelf: 'flex-end', marginBottom: 6 }}>
                    <Text style={local.enlace}>{cantidad === disponibles ? 'Quitar todo' : 'Elegir todo'}</Text>
                </Pressable>
            )}

            {items && agruparItemsPorHijo(items).map((grupo) => (
                <View key={grupo.alumno_id} style={{ marginBottom: 6 }}>
                    <Text style={local.hijo}>{grupo.alumno}</Text>
                    {grupo.items.map((item) => (
                        <FilaItem key={claveItem(item)} item={item} elegido={seleccion.has(claveItem(item))} alElegir={() => setSeleccion(alternarItem(seleccion, item))} />
                    ))}
                </View>
            ))}

            {items && items.length > 0 && (
                <View style={[estilos.tarjeta, { marginTop: 8, marginBottom: 18 }]}>
                    <Text style={estilos.etiqueta}>Total a pagar</Text>
                    <Text style={local.total}>{formatearMonto(total)}</Text>
                    <Text style={local.detalle}>{cantidad === 0 ? 'No elegiste ningún ítem.' : `${cantidad} ${cantidad === 1 ? 'ítem elegido' : 'ítems elegidos'}`}</Text>
                    <Pressable
                        style={[estilos.boton, (cantidad === 0 || creando) && estilos.botonDeshabilitado]}
                        disabled={cantidad === 0 || creando}
                        onPress={generar}
                        accessibilityRole="button"
                    >
                        {creando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Generar factura</Text>}
                    </Pressable>
                </View>
            )}

            {facturas.length > 0 && (
                <>
                    <Text style={local.seccion}>Mis facturas</Text>
                    {facturas.map((f) => (
                        <View key={f.id} style={[estilos.tarjeta, local.factura]}>
                            <View style={{ flex: 1 }}>
                                <Text style={local.referencia}>{f.referencia}</Text>
                                <Text style={local.detalle}>{formatearMomento(f.emitida_en)} · {f.items.length} {f.items.length === 1 ? 'ítem' : 'ítems'}</Text>
                                <View style={[local.insignia, { backgroundColor: colorFactura(f.estado).fondo }]}>
                                    <Text style={{ color: colorFactura(f.estado).texto, fontWeight: '800', fontSize: 12 }}>{etiquetaFactura(f.estado)}</Text>
                                </View>
                            </View>
                            <Text style={local.monto}>{formatearMonto(f.total)}</Text>
                        </View>
                    ))}
                </>
            )}
        </ScrollView>
    );
}

function FilaItem({ item, elegido, alElegir }) {
    const bloqueado = !item.disponible;
    return (
        <Pressable
            onPress={alElegir}
            disabled={bloqueado}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: elegido, disabled: bloqueado }}
            style={[estilos.tarjeta, local.fila, bloqueado && { opacity: 0.6 }]}
        >
            <View style={[local.casilla, elegido && local.casillaActiva]}>{elegido && <Text style={local.tilde}>✓</Text>}</View>
            <View style={{ flex: 1 }}>
                <Text style={local.itemTitulo}>{item.descripcion.split(' - ')[0]}</Text>
                <Text style={local.detalle}>{bloqueado ? `Ya está en la factura ${item.en_factura}` : (item.estado === 'Vencida' ? 'Vencida' : 'Pendiente de pago')}</Text>
            </View>
            <Text style={local.monto}>{formatearMonto(item.monto)}</Text>
        </Pressable>
    );
}

function FacturaGenerada({ factura, alVolver }) {
    return (
        <ScrollView contentContainerStyle={local.contenido}>
            <Text style={estilos.titulo}>Factura generada</Text>
            <Text style={[estilos.subtitulo, { marginBottom: 12 }]}>Hacé la transferencia por el total e indicá esta referencia.</Text>

            <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                <Text style={estilos.etiqueta}>Referencia de pago</Text>
                <Text selectable style={local.referenciaGrande}>{factura.referencia}</Text>
                <Text style={estilos.etiqueta}>Total a transferir</Text>
                <Text style={local.total}>{formatearMonto(factura.total)}</Text>
            </View>

            <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                <Text style={estilos.etiqueta}>Datos para transferir</Text>
                {lineasDatosBancarios(factura.pago && factura.pago.datos).map((l) => <Text selectable key={l} style={local.dato}>{l}</Text>)}
                <Text style={[local.detalle, { marginTop: 10 }]}>{factura.pago && factura.pago.nota}</Text>
            </View>

            <View style={[estilos.tarjeta, { marginBottom: 14 }]}>
                <Text style={estilos.etiqueta}>Detalle</Text>
                {factura.items.map((i) => (
                    <View key={i.id} style={local.linea}>
                        <Text style={[estilos.texto, { flex: 1 }]}>{i.descripcion}</Text>
                        <Text style={local.monto}>{formatearMonto(i.monto)}</Text>
                    </View>
                ))}
            </View>

            <Pressable style={estilos.botonSecundario} onPress={alVolver}>
                <Text style={estilos.botonTextoSecundario}>Volver</Text>
            </Pressable>
        </ScrollView>
    );
}

const local = StyleSheet.create({
    contenido: { padding: 16, paddingBottom: 32 },
    aviso: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginBottom: 14 },
    avisoTexto: { color: colores.error, fontWeight: '700' },
    reintentar: { color: colores.azul, fontWeight: '800', marginTop: 6 },
    enlace: { color: colores.azul, fontWeight: '800' },
    hijo: { fontSize: 16, fontWeight: '800', color: colores.texto, marginTop: 6, marginBottom: 8 },
    fila: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    casilla: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    casillaActiva: { backgroundColor: colores.azul, borderColor: colores.azul },
    tilde: { color: '#fff', fontWeight: '800', fontSize: 16 },
    itemTitulo: { fontSize: 15, fontWeight: '800', color: colores.texto },
    detalle: { fontSize: 13, color: colores.suave, marginTop: 2 },
    monto: { fontSize: 16, fontWeight: '800', color: colores.texto, marginLeft: 10 },
    total: { fontSize: 28, fontWeight: '800', color: colores.azul },
    seccion: { fontSize: 18, fontWeight: '800', color: colores.texto, marginBottom: 10 },
    factura: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    referencia: { fontSize: 15, fontWeight: '800', color: colores.texto },
    referenciaGrande: { fontSize: 22, fontWeight: '800', color: colores.texto, letterSpacing: 1, marginBottom: 6 },
    insignia: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
    dato: { fontSize: 15, color: colores.texto, fontWeight: '700', marginTop: 4 },
    linea: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
});
