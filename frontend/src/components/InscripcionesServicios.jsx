import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from './ConfirmModal';

// Inscripciones de un alumno a los servicios del mes: deportes (grupos con nivel, horario y profesor), transporte
// (un recorrido) y comedor. Lo usan el administrador (cualquier alumno) y el padre (sus hijos). Las reglas son las del
// servidor: máximo 2 deportes por mes, sin horarios superpuestos, un solo recorrido por mes y con cupo; la pantalla
// solo deshabilita lo que sabe que se va a rechazar y muestra el motivo que devuelve la API en los demás casos.

const MAX_DEPORTES = 2;
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const campoStyle = { padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem', background: '#fff', maxWidth: '100%' };
const etiquetaStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' };

const horario = (s) => (s.dia_semana ? `${DIAS[s.dia_semana]} ${String(s.hora_inicio).slice(0, 5)} a ${String(s.hora_fin).slice(0, 5)}` : '');
const precio = (n) => `$${Number(n).toLocaleString('es-AR')}`;
const mayuscula = (t) => t[0].toUpperCase() + t.slice(1);

// El mes actual y los dos siguientes: no se inscribe en un mes que ya pasó.
const mesesOfrecidos = () => {
    const hoy = new Date();
    return [0, 1, 2].map((i) => {
        const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
        return { mes: d.getMonth() + 1, anio: d.getFullYear(), clave: `${d.getMonth() + 1}-${d.getFullYear()}` };
    });
};

export default function InscripcionesServicios({ alumnos, titulo = 'Servicios del mes', ayuda }) {
    const { apiFetch } = useAuth();
    const periodos = mesesOfrecidos();
    const [alumnoId, setAlumnoId] = useState(null);
    const [buscar, setBuscar] = useState('');
    const [claveMes, setClaveMes] = useState(periodos[0].clave);
    const [version, setVersion] = useState(0); // al cambiar, se vuelven a pedir el catálogo y las inscripciones
    const [datos, setDatos] = useState(null); // { clave, catalogo, propias, error }
    const [mensaje, setMensaje] = useState({ tipo: '', texto: '' });
    const [ocupado, setOcupado] = useState(false);
    const [confirmar, setConfirmar] = useState(null);

    const periodo = periodos.find((p) => p.clave === claveMes) || periodos[0];
    // Si el alumno elegido ya no está en la lista (por ejemplo, un hijo desvinculado), se vuelve al primero.
    const actual = alumnos.find((a) => a.id === alumnoId) || alumnos[0] || null;
    const actualId = actual ? actual.id : null;
    const clave = `${actualId}-${periodo.clave}-${version}`;

    useEffect(() => {
        if (!actualId) return undefined;
        let activo = true;
        const cargar = async () => {
            try {
                const rc = await apiFetch(`${API_URL}/api/inscripciones/catalogo?mes=${periodo.mes}&anio=${periodo.anio}`);
                if (!rc.ok) throw new Error('No se pudo cargar el catálogo de servicios.');
                const catalogo = await rc.json();
                const rp = await apiFetch(`${API_URL}/api/inscripciones/alumno/${actualId}?mes=${periodo.mes}&anio=${periodo.anio}`);
                if (!rp.ok) throw new Error('No se pudieron cargar las inscripciones del alumno.');
                const propias = await rp.json();
                if (activo) setDatos({ clave, catalogo, propias, error: '' });
            } catch (e) {
                if (activo) setDatos({ clave, catalogo: null, propias: [], error: e.message || 'No se pudo cargar la información.' });
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, actualId, periodo.mes, periodo.anio, clave]);

    const inscribir = async (servicio) => {
        setConfirmar(null);
        setOcupado(true);
        setMensaje({ tipo: '', texto: '' });
        try {
            const r = await apiFetch(`${API_URL}/api/inscripciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alumno_id: actualId, servicio_id: servicio.id, mes: periodo.mes, anio: periodo.anio }),
            });
            const cuerpo = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(cuerpo.message || 'No se pudo inscribir.');
            setMensaje({ tipo: 'ok', texto: `${actual.nombre} quedó inscripto/a en ${servicio.deporte || servicio.nombre}.` });
        } catch (e) {
            setMensaje({ tipo: 'error', texto: e.message || 'No se pudo inscribir.' });
        }
        setVersion((v) => v + 1);
        setOcupado(false);
    };

    const darDeBaja = async (inscripcion, servicio) => {
        setOcupado(true);
        setMensaje({ tipo: '', texto: '' });
        try {
            const r = await apiFetch(`${API_URL}/api/inscripciones/${inscripcion.id}`, { method: 'DELETE' });
            const cuerpo = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(cuerpo.message || 'No se pudo dar de baja la inscripción.');
            setMensaje({ tipo: 'ok', texto: `${actual.nombre} se dio de baja de ${servicio.deporte || servicio.nombre}.` });
        } catch (e) {
            setMensaje({ tipo: 'error', texto: e.message || 'No se pudo dar de baja la inscripción.' });
        }
        setVersion((v) => v + 1);
        setOcupado(false);
    };

    if (!actual) {
        return (
            <div className="dashboard-card" style={{ gridColumn: '1 / -1', background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}>
                <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800 }}>{titulo}</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '10px' }}>No hay alumnos para mostrar.</p>
            </div>
        );
    }

    const cargando = !datos || datos.clave !== clave;
    const catalogo = !cargando && datos.catalogo ? datos.catalogo.servicios : [];
    const propias = !cargando ? datos.propias : [];
    const inscripcionDe = (servicioId) => propias.find((i) => i.servicio_id === servicioId);
    const nivel = actual.nivel_nombre || null;

    const deportes = catalogo.filter((s) => s.tipo === 'Deporte')
        .filter((s) => !s.nivel || !nivel || s.nivel === nivel || inscripcionDe(s.id)); // solo los de su nivel (y los que ya tiene)
    const transportes = catalogo.filter((s) => s.tipo === 'Transporte');
    const comedores = catalogo.filter((s) => s.tipo === 'Comedor');
    const cantidadDeportes = catalogo.filter((s) => s.tipo === 'Deporte' && inscripcionDe(s.id)).length;
    const tieneTransporte = transportes.some((s) => inscripcionDe(s.id));
    const total = catalogo.filter((s) => inscripcionDe(s.id)).reduce((suma, s) => suma + Number(s.precio_mensual), 0);
    const cantidad = catalogo.filter((s) => inscripcionDe(s.id)).length;

    const minuscula = (texto) => texto.trim().toLowerCase();
    const visibles = alumnos.filter((a) => !buscar.trim()
        || minuscula(`${a.apellido} ${a.nombre} ${a.legajo || ''} ${a.dni || ''}`).includes(minuscula(buscar)) || a.id === actualId);

    // Una tarjeta por servicio: el detalle depende del tipo y el botón, de si ya está inscripto y de lo que no se permite.
    const tarjeta = (s, detalle, motivoBloqueo) => {
        const inscripcion = inscripcionDe(s.id);
        const sinCupo = s.cupo_disponible === 0;
        const bloqueado = ocupado || (!inscripcion && (sinCupo || motivoBloqueo));
        return (
            <div key={s.id} style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: `1px solid ${inscripcion ? 'var(--green)' : '#e2e8f0'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: 'white', background: s.tipo === 'Deporte' ? 'var(--green)' : s.tipo === 'Transporte' ? 'var(--blue)' : 'var(--orange)', padding: '3px 8px', borderRadius: '6px' }}>
                        {s.tipo === 'Deporte' ? (s.nivel || 'Todos los niveles') : s.tipo}
                    </span>
                    {s.cupo_max !== null && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: sinCupo ? '#dc2626' : '#64748b' }}>{s.inscriptos}/{s.cupo_max}</span>}
                </div>
                <p style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)', marginTop: '10px' }}>{s.deporte || s.nombre}</p>
                {detalle.map((linea) => <p key={linea} style={{ fontSize: '0.8rem', color: 'var(--text-sm)' }}>{linea}</p>)}
                <p style={{ fontSize: '0.8rem', color: 'var(--text-sm)', marginBottom: '12px' }}>{precio(s.precio_mensual)} por mes</p>
                {inscripcion ? (
                    <button onClick={() => darDeBaja(inscripcion, s)} disabled={ocupado} className="btn btn-hero-outline" style={{ width: '100%', fontSize: '0.8rem', color: '#dc2626', borderColor: '#dc2626', opacity: ocupado ? 0.55 : 1 }}>
                        ✓ Inscripto — Dar de baja
                    </button>
                ) : (
                    <button onClick={() => setConfirmar({ servicio: s })} disabled={bloqueado} className="btn btn-violet" style={{ width: '100%', fontSize: '0.8rem', opacity: bloqueado ? 0.5 : 1, cursor: bloqueado ? 'not-allowed' : 'pointer' }}>
                        {sinCupo ? 'Sin cupo' : (motivoBloqueo || 'Inscribir')}
                    </button>
                )}
            </div>
        );
    };

    const grilla = (children) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>{children}</div>;
    const seccion = (texto, extra) => <h4 style={{ fontSize: '0.85rem', color: 'var(--blue)', fontWeight: 800, margin: '20px 0 10px' }}>{texto}{extra && <span style={{ color: '#94a3b8', fontWeight: 600 }}> · {extra}</span>}</h4>;

    return (
        <div className="dashboard-card" style={{ gridColumn: '1 / -1', background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '16px' }}>🧾 {titulo}</h3>
            {ayuda && <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '14px' }}>{ayuda}</p>}

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '14px' }}>
                {alumnos.length > 8 && (
                    <div>
                        <label htmlFor="insc-buscar" style={etiquetaStyle}>Buscar alumno</label>
                        <input id="insc-buscar" type="search" placeholder="Nombre, DNI o legajo" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...campoStyle, minWidth: '200px' }} />
                    </div>
                )}
                {alumnos.length > 1 && (
                    <div>
                        <label htmlFor="insc-alumno" style={etiquetaStyle}>Alumno</label>
                        <select id="insc-alumno" value={actualId} onChange={(e) => { setAlumnoId(Number(e.target.value)); setMensaje({ tipo: '', texto: '' }); }} style={{ ...campoStyle, minWidth: '260px' }}>
                            {visibles.map((a) => <option key={a.id} value={a.id}>{a.legajo ? `${a.legajo} · ` : ''}{a.apellido}, {a.nombre}</option>)}
                        </select>
                    </div>
                )}
                <div>
                    <label htmlFor="insc-mes" style={etiquetaStyle}>Mes</label>
                    <select id="insc-mes" value={periodo.clave} onChange={(e) => { setClaveMes(e.target.value); setMensaje({ tipo: '', texto: '' }); }} style={{ ...campoStyle, minWidth: '170px' }}>
                        {periodos.map((p) => <option key={p.clave} value={p.clave}>{mayuscula(MESES[p.mes - 1])} de {p.anio}</option>)}
                    </select>
                </div>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '6px' }}>
                <strong>{actual.apellido}, {actual.nombre}</strong>{nivel ? ` · ${nivel}` : ' · Sin curso asignado'}
                {!cargando && !datos.error ? ` · ${cantidad} ${cantidad === 1 ? 'servicio' : 'servicios'} · ${precio(total)} por mes` : ''}
            </p>

            <div aria-live="polite">
                {mensaje.texto && (
                    <p role={mensaje.tipo === 'error' ? 'alert' : undefined} style={{ fontSize: '0.85rem', fontWeight: 700, margin: '8px 0', color: mensaje.tipo === 'error' ? '#991b1b' : '#166534' }}>{mensaje.texto}</p>
                )}
            </div>

            {cargando && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando…</p>}
            {!cargando && datos.error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700 }}>{datos.error}</p>}

            {!cargando && !datos.error && (
                <>
                    {seccion('Deportes', `${cantidadDeportes} de ${MAX_DEPORTES} posibles`)}
                    {deportes.length === 0
                        ? <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No hay grupos de deportes disponibles para este nivel.</p>
                        : grilla(deportes.map((s) => tarjeta(
                            s,
                            [horario(s) || 'Horario a confirmar', s.docente ? `Profesor/a: ${s.docente}` : 'Profesor a confirmar'],
                            cantidadDeportes >= MAX_DEPORTES ? 'Máximo alcanzado' : ''
                        )))}

                    {seccion('Transporte', 'un recorrido por mes')}
                    {transportes.length === 0
                        ? <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No hay recorridos disponibles.</p>
                        : grilla(transportes.map((s) => tarjeta(s, [], tieneTransporte ? 'Ya tiene recorrido' : '')))}

                    {seccion('Comedor')}
                    {comedores.length === 0
                        ? <p style={{ fontSize: '0.85rem', color: '#64748b' }}>El comedor no está disponible.</p>
                        : grilla(comedores.map((s) => tarjeta(s, [], '')))}
                </>
            )}

            {confirmar && (
                <ConfirmModal
                    title="Confirmar inscripción"
                    message={`¿Inscribir a ${actual.nombre} ${actual.apellido} en ${confirmar.servicio.deporte || confirmar.servicio.nombre}${horario(confirmar.servicio) ? ` (${horario(confirmar.servicio)})` : ''} en ${MESES[periodo.mes - 1]} de ${periodo.anio}?\nTiene un valor de ${precio(confirmar.servicio.precio_mensual)} por mes.`}
                    confirmLabel="Inscribir"
                    onCancel={() => setConfirmar(null)}
                    onConfirm={() => inscribir(confirmar.servicio)}
                />
            )}
        </div>
    );
}
