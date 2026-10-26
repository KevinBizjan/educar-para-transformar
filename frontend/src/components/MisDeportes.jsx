import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from './ConfirmModal';

// Portal del alumno: sus deportes del mes. Elige entre los grupos del catálogo (cada uno con su nivel, horario y
// profesor) y se inscribe o se da de baja. Usa el mismo sistema de inscripciones que la familia, con las mismas
// reglas: máximo 2 deportes por mes, sin horarios superpuestos y con cupo.

const MAX_DEPORTES = 2;
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const horario = (s) => (s.dia_semana ? `${DIAS[s.dia_semana]} ${String(s.hora_inicio).slice(0, 5)} a ${String(s.hora_fin).slice(0, 5)}` : 'Horario a confirmar');
const precio = (n) => `$${Number(n).toLocaleString('es-AR')}`;

// nivel: nombre del nivel del alumno ( "Primario"); un grupo pertenece a un nivel, así que no se ofrecen los de otros.
export default function MisDeportes({ alumnoId, nivel }) {
    const { apiFetch } = useAuth();
    const [version, setVersion] = useState(0); // al cambiar, se vuelven a pedir el catálogo y las inscripciones
    const [datos, setDatos] = useState(null); // { catalogo, propias }
    const [error, setError] = useState('');
    const [mensaje, setMensaje] = useState({ tipo: '', texto: '' });
    const [ocupado, setOcupado] = useState(false);
    const [confirmar, setConfirmar] = useState(null); // { servicio } a inscribir

    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const rc = await apiFetch(`${API_URL}/api/inscripciones/catalogo`);
                if (!rc.ok) throw new Error('No se pudo cargar el catálogo de deportes.');
                const catalogo = await rc.json();
                const rp = await apiFetch(`${API_URL}/api/inscripciones/alumno/${alumnoId}?mes=${catalogo.mes}&anio=${catalogo.anio}`);
                if (!rp.ok) throw new Error('No se pudieron cargar tus inscripciones.');
                const propias = await rp.json();
                if (activo) { setDatos({ catalogo, propias }); setError(''); }
            } catch (e) {
                if (activo) setError(e.message || 'No se pudo cargar la sección de deportes.');
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, alumnoId, version]);

    const inscribir = async (servicio) => {
        setConfirmar(null);
        setOcupado(true);
        setMensaje({ tipo: '', texto: '' });
        try {
            const r = await apiFetch(`${API_URL}/api/inscripciones`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alumno_id: alumnoId, servicio_id: servicio.id, mes: datos.catalogo.mes, anio: datos.catalogo.anio }),
            });
            const cuerpo = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(cuerpo.message || 'No te pudiste inscribir.');
            setMensaje({ tipo: 'ok', texto: `Te inscribiste en ${servicio.deporte || servicio.nombre}.` });
        } catch (e) {
            setMensaje({ tipo: 'error', texto: e.message || 'No te pudiste inscribir.' });
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
            setMensaje({ tipo: 'ok', texto: `Te diste de baja de ${servicio.deporte || servicio.nombre}.` });
        } catch (e) {
            setMensaje({ tipo: 'error', texto: e.message || 'No se pudo dar de baja la inscripción.' });
        }
        setVersion((v) => v + 1);
        setOcupado(false);
    };

    const catalogo = datos ? datos.catalogo.servicios : [];
    const inscripcionDe = (servicioId) => (datos ? datos.propias.find((i) => i.servicio_id === servicioId) : null);
    const cantidad = datos ? datos.propias.filter((i) => catalogo.some((s) => s.id === i.servicio_id)).length : 0;
    // Solo los grupos de su nivel (y los que ya tiene, por si lo inscribió la Dirección en otro).
    const servicios = catalogo.filter((s) => !s.nivel || !nivel || s.nivel === nivel || inscripcionDe(s.id));
    const alMaximo = cantidad >= MAX_DEPORTES;

    return (
        <div className="dashboard-card" style={{ gridColumn: '1 / -1', background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>🏅 Mis deportes</h3>

            {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700 }}>{error}</p>}
            {!datos && !error && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando…</p>}

            {datos && (
                <>
                    <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '14px' }}>
                        {MESES[datos.catalogo.mes - 1][0].toUpperCase() + MESES[datos.catalogo.mes - 1].slice(1)} de {datos.catalogo.anio}: estás inscripto/a en <strong>{cantidad} de {MAX_DEPORTES}</strong> deportes
                        posibles. Cada grupo tiene su nivel, horario y profesor, y el valor mensual se suma a la cuenta de tu familia.
                    </p>

                    <div aria-live="polite">
                        {mensaje.texto && (
                            <p role={mensaje.tipo === 'error' ? 'alert' : undefined} style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '14px', color: mensaje.tipo === 'error' ? '#991b1b' : '#166534' }}>
                                {mensaje.texto}
                            </p>
                        )}
                    </div>

                    {servicios.length === 0 ? (
                        <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Todavía no hay grupos de deportes disponibles este mes.</p>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                            {servicios.map((s) => {
                                const inscripcion = inscripcionDe(s.id);
                                const sinCupo = s.cupo_disponible === 0;
                                return (
                                    <div key={s.id} style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: `1px solid ${inscripcion ? 'var(--green)' : '#e2e8f0'}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: 'white', background: 'var(--green)', padding: '3px 8px', borderRadius: '6px' }}>{s.nivel || 'Todos los niveles'}</span>
                                            {s.cupo_max !== null && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: sinCupo ? '#dc2626' : '#64748b' }}>{s.inscriptos}/{s.cupo_max}</span>}
                                        </div>
                                        <p style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)', marginTop: '10px' }}>{s.deporte || s.nombre}</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-sm)' }}>{horario(s)}</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-sm)' }}>{s.docente ? `Profesor/a: ${s.docente}` : 'Profesor a confirmar'}</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-sm)', marginBottom: '12px' }}>{precio(s.precio_mensual)} por mes</p>
                                        {inscripcion ? (
                                            <button onClick={() => darDeBaja(inscripcion, s)} disabled={ocupado} className="btn btn-hero-outline" style={{ width: '100%', fontSize: '0.8rem', color: '#dc2626', borderColor: '#dc2626', opacity: ocupado ? 0.55 : 1 }}>
                                                ✓ Inscripto — Darme de baja
                                            </button>
                                        ) : (
                                            <button onClick={() => setConfirmar({ servicio: s })} disabled={ocupado || sinCupo || alMaximo} className="btn btn-violet" style={{ width: '100%', fontSize: '0.8rem', opacity: ocupado || sinCupo || alMaximo ? 0.5 : 1, cursor: ocupado || sinCupo || alMaximo ? 'not-allowed' : 'pointer' }}>
                                                {sinCupo ? 'Sin cupo' : alMaximo ? 'Máximo alcanzado' : 'Inscribirme'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {confirmar && (
                <ConfirmModal
                    title="Confirmar inscripción"
                    message={`¿Querés inscribirte en ${confirmar.servicio.deporte || confirmar.servicio.nombre} (${horario(confirmar.servicio)})?\nTiene un valor de ${precio(confirmar.servicio.precio_mensual)} por mes que se suma a la cuenta de tu familia.`}
                    confirmLabel="Inscribirme"
                    onCancel={() => setConfirmar(null)}
                    onConfirm={() => inscribir(confirmar.servicio)}
                />
            )}
        </div>
    );
}
