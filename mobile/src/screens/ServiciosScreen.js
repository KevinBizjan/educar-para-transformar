import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cargarHijos } from '../cuentas/historial.js';
import {
    PERIODOS, periodoElegido, tituloPeriodo, agruparCatalogo, tituloServicio, detalleServicio, describirCupo, inscripcionDe, accionDe, ordenarServicios,
    cargarCatalogo, cargarInscripciones, inscribir, darDeBaja,
} from '../familia/servicios.js';
import { estilos, colores, colorDeTipo } from './estilos.js';

// "Servicios": el padre inscribe a cada hijo en deportes, transporte y comedor del mes (o del siguiente) y puede darlos
// de baja. Las reglas (máximo de 2 deportes, un recorrido por mes, cupos y horarios) las controla el servidor y su
// mensaje se muestra tal cual.
export default function ServiciosScreen() {
    const [hijos, setHijos] = useState([]);
    const [alumnoId, setAlumnoId] = useState(null);
    const [periodoId, setPeriodoId] = useState('actual');
    const [catalogo, setCatalogo] = useState(null);
    const [inscripciones, setInscripciones] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [refrescando, setRefrescando] = useState(false);
    const [trabajando, setTrabajando] = useState(0); // id del servicio que se está inscribiendo o dando de baja
    const [error, setError] = useState('');
    const [exito, setExito] = useState('');
    const pedidoActual = useRef(0);
    const periodo = periodoElegido(periodoId);
    const hijo = hijos.find((h) => h.id === alumnoId);

    useEffect(() => {
        cargarHijos().then((lista) => {
            setHijos(lista);
            if (lista.length) setAlumnoId(lista[0].id);
            else setCargando(false);
        }).catch((e) => { setError(e.message); setCargando(false); });
    }, []);

    const cargar = useCallback(async (hijoId, p, manual = false) => {
        if (!hijoId) return;
        const numero = ++pedidoActual.current;
        if (manual) setRefrescando(true); else setCargando(true);
        try {
            const [cat, insc] = await Promise.all([cargarCatalogo(p), cargarInscripciones(hijoId, p)]);
            if (numero === pedidoActual.current) { setCatalogo(cat.servicios); setInscripciones(insc); }
        } catch (e) {
            if (numero === pedidoActual.current) setError(e.message);
        } finally {
            if (numero === pedidoActual.current) { setCargando(false); setRefrescando(false); }
        }
    }, []);

    useEffect(() => { setError(''); setExito(''); cargar(alumnoId, periodoElegido(periodoId)); }, [alumnoId, periodoId, cargar]);

    const ejecutar = async (servicio, accion) => {
        setTrabajando(servicio.id);
        setError('');
        setExito('');
        try {
            if (accion === 'inscribir') {
                await inscribir({ alumnoId, servicioId: servicio.id, mes: periodo.mes, anio: periodo.anio });
                setExito(`${hijo.nombre} quedó inscripto en ${tituloServicio(servicio)}.`);
            } else {
                await darDeBaja(inscripcionDe(servicio, inscripciones).id);
                setExito(`Se dio de baja a ${hijo.nombre} de ${tituloServicio(servicio)}.`);
            }
            await cargar(alumnoId, periodo, true);
        } catch (e) {
            setError(e.message);
        } finally {
            setTrabajando(0);
        }
    };

    const tocar = (servicio) => {
        const accion = accionDe(servicio, inscripciones);
        if (accion === 'completo') return;
        if (accion === 'baja') {
            Alert.alert('Dar de baja', `¿Dar de baja a ${hijo.nombre} de ${tituloServicio(servicio)} en ${tituloPeriodo(periodo)}?`, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Dar de baja', style: 'destructive', onPress: () => ejecutar(servicio, 'baja') },
            ]);
        } else {
            ejecutar(servicio, 'inscribir');
        }
    };

    const grupos = catalogo ? agruparCatalogo(catalogo) : [];

    return (
        <ScrollView
            contentContainerStyle={local.contenido}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(alumnoId, periodo, true)} tintColor={colores.azul} />}
        >
            <Text style={estilos.titulo}>Servicios</Text>
            <Text style={[estilos.subtitulo, { marginBottom: 12 }]}>Inscribí a tus hijos en deportes, transporte y comedor</Text>

            {hijos.length > 1 && (
                <View style={local.chips}>
                    {hijos.map((h) => (
                        <Pressable key={h.id} onPress={() => setAlumnoId(h.id)} accessibilityRole="tab" accessibilityState={{ selected: alumnoId === h.id }} style={[local.chip, alumnoId === h.id && local.chipActivo]}>
                            <Text numberOfLines={1} style={[local.chipTexto, alumnoId === h.id && local.chipTextoActivo]}>{h.nombre}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
            <View style={local.chips}>
                {PERIODOS.map((p) => (
                    <Pressable key={p.id} onPress={() => setPeriodoId(p.id)} accessibilityRole="tab" accessibilityState={{ selected: periodoId === p.id }} style={[local.chip, periodoId === p.id && local.chipActivo]}>
                        <Text style={[local.chipTexto, periodoId === p.id && local.chipTextoActivo]}>{p.texto}</Text>
                    </Pressable>
                ))}
            </View>
            <Text style={local.periodo}>{hijo ? `${hijo.nombre} · ` : ''}{tituloPeriodo(periodo)}</Text>

            {!!error && <View style={local.aviso}><Text style={local.avisoTexto}>{error}</Text></View>}
            {!!exito && <View style={local.exito}><Text style={local.exitoTexto}>{exito}</Text></View>}
            {cargando && <ActivityIndicator size="large" color={colores.azul} style={{ marginTop: 24 }} />}

            {!cargando && hijos.length === 0 && !error && (
                <View style={estilos.tarjeta}>
                    <Text style={[estilos.texto, { textAlign: 'center' }]}>Todavía no tenés hijos vinculados a tu cuenta. Pedile a la institución que los vincule.</Text>
                </View>
            )}

            {!cargando && grupos.map((g) => (
                <View key={g.tipo} style={{ marginBottom: 6 }}>
                    <Text style={[local.seccion, { color: colorDeTipo(g.tipo) }]}>{g.titulo}</Text>
                    {ordenarServicios(g.servicios, inscripciones).map((s) => {
                        const accion = accionDe(s, inscripciones);
                        const ocupado = trabajando === s.id;
                        return (
                            <View key={s.id} style={[estilos.tarjeta, local.servicio, { borderTopColor: colorDeTipo(s.tipo) }, accion === 'baja' && local.inscripto]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={local.nombre}>{tituloServicio(s)}</Text>
                                    {detalleServicio(s).map((linea) => <Text key={linea} style={local.detalle}>{linea}</Text>)}
                                    <Text style={[local.detalle, accion === 'completo' && { color: colores.error, fontWeight: '700' }]}>{describirCupo(s)}</Text>
                                    {accion === 'baja' && <Text style={local.marca}>✓ Inscripto este mes</Text>}
                                </View>
                                {accion !== 'completo' && (
                                    <Pressable
                                        style={[local.boton, accion === 'baja' && local.botonBaja, (ocupado || trabajando !== 0) && estilos.botonDeshabilitado]}
                                        disabled={trabajando !== 0}
                                        onPress={() => tocar(s)}
                                        accessibilityRole="button"
                                    >
                                        {ocupado ? <ActivityIndicator color={accion === 'baja' ? colores.error : '#fff'} /> : <Text style={[local.botonTexto, accion === 'baja' && { color: colores.error }]}>{accion === 'baja' ? 'Dar de baja' : 'Inscribir'}</Text>}
                                    </Pressable>
                                )}
                            </View>
                        );
                    })}
                </View>
            ))}
            {!cargando && catalogo && grupos.length === 0 && (
                <View style={estilos.tarjeta}><Text style={[estilos.texto, { textAlign: 'center' }]}>La institución todavía no cargó servicios para este mes.</Text></View>
            )}
        </ScrollView>
    );
}

const local = StyleSheet.create({
    contenido: { padding: 20, paddingBottom: 32, backgroundColor: colores.fondo, flexGrow: 1 },
    chips: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: 8, elevation: 1 },
    chip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
    chipActivo: { backgroundColor: colores.azul },
    chipTexto: { fontSize: 13, fontWeight: '700', color: colores.suave },
    chipTextoActivo: { color: '#fff' },
    periodo: { fontSize: 13, color: colores.suave, textAlign: 'center', marginBottom: 12 },
    aviso: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, marginBottom: 14 },
    avisoTexto: { color: colores.error, fontWeight: '700' },
    exito: { backgroundColor: '#dcfce7', borderRadius: 10, padding: 12, marginBottom: 14 },
    exitoTexto: { color: colores.ok, fontWeight: '700' },
    seccion: { fontSize: 16, fontWeight: '800', color: colores.texto, marginTop: 8, marginBottom: 10 },
    servicio: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    inscripto: { borderWidth: 1.5, borderColor: colores.ok },
    nombre: { fontSize: 15, fontWeight: '800', color: colores.texto },
    detalle: { fontSize: 13, color: colores.suave, marginTop: 2 },
    marca: { fontSize: 13, fontWeight: '800', color: colores.ok, marginTop: 4 },
    boton: { backgroundColor: colores.azul, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginLeft: 10, minWidth: 92, alignItems: 'center' },
    botonBaja: { backgroundColor: '#fff', borderWidth: 1, borderColor: colores.error },
    botonTexto: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
