import { API_URL } from '../config';
import { useEffect, useState } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import Toast from '../components/Toast';
import SeccionesReporte from '../components/SeccionesReporte';
import DatosPersonales from '../components/DatosPersonales';
import MisDeportes from '../components/MisDeportes';

const AlumnoDashboard = () => {
    const { apiFetch } = useAuth();
    const [notificaciones, setNotificaciones] = useState([]);
    // Cultura e Idioma (sistema anterior de actividades, por cuenta de alumno)
    const [actividades, setActividades] = useState([]);
    const [misInscripciones, setMisInscripciones] = useState([]);
    // Respuesta de /mi-ficha: null mientras carga; { vinculado: false } si la Dirección todavía no vinculó la cuenta.
    const [perfil, setPerfil] = useState(null);
    const [version, setVersion] = useState(0); // al cambiar, se vuelven a pedir las actividades
    const [toast, setToast] = useState({ message: '', type: 'success' });
    const showToast = (message, type = 'success') => setToast({ message, type });

    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const [resFicha, resNotif, resAct, resMis] = await Promise.all([
                    apiFetch(`${API_URL}/api/academico/mi-ficha`),
                    apiFetch(`${API_URL}/api/comunicacion/notificaciones`),
                    apiFetch(`${API_URL}/api/academico/actividades`),
                    apiFetch(`${API_URL}/api/academico/mis-inscripciones`),
                ]);
                if (!activo) return;
                if (resFicha.ok) setPerfil(await resFicha.json());
                if (resNotif.ok) setNotificaciones(await resNotif.json());
                if (resAct.ok) setActividades(await resAct.json());
                if (resMis.ok) setMisInscripciones(await resMis.json());
            } catch (error) {
                console.error('Error al cargar el panel del alumno:', error);
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, version]);

    const estaInscripto = (actividadId) => misInscripciones.some(a => a.id === actividadId);

    const inscribirse = async (actividadId) => {
        const response = await apiFetch(`${API_URL}/api/academico/inscribir-actividad`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actividad_id: actividadId })
        });
        const data = await response.json();
        if (response.ok) {
            showToast('Inscripción realizada con éxito', 'success');
            setVersion(v => v + 1);
        } else {
            showToast(data.message || 'No te pudiste inscribir.', 'error');
        }
    };

    const cancelarInscripcion = async (actividadId) => {
        const response = await apiFetch(`${API_URL}/api/academico/desinscribir-actividad/${actividadId}`, { method: 'DELETE' });
        if (response.ok) {
            showToast('Inscripción cancelada', 'info');
            setVersion(v => v + 1);
        }
    };

    const vinculado = perfil && perfil.vinculado;
    const datos = vinculado ? perfil.ficha.secciones[0].filas[0] : null;
    // Los deportes se muestran en "Mis deportes"; los datos personales, en el encabezado.
    const seccionesFicha = vinculado ? perfil.ficha.secciones.filter(s => s.titulo !== 'Datos del alumno' && !s.titulo.startsWith('Deportes')) : [];

    return (
        <DashboardLayout title="Panel del Alumno">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
                {/* Mis datos personales (solo lectura): para que el alumno verifique que estén correctos */}
                {vinculado && (
                    <div className="dashboard-card" style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                        <h3 style={cardTitleStyle}>🪪 Mis datos personales</h3>
                        <div style={{ marginTop: '16px' }}>
                            <DatosPersonales seccion={perfil.ficha.secciones[0]} />
                        </div>
                    </div>
                )}

                {/* Mi ficha: materias con sus profesores, transporte y comedor */}
                <div className="dashboard-card" style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                    <h3 style={cardTitleStyle}>📚 Mis materias y profesores</h3>
                    <div style={{ marginTop: '16px' }}>
                        {perfil === null && <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Cargando…</p>}
                        {perfil && !vinculado && (
                            <p style={{ fontSize: '0.85rem', color: '#92400e', background: '#fffbeb', padding: '12px 14px', borderRadius: '8px' }}>
                                Tu cuenta todavía no está vinculada a tu legajo de alumno. Pedile a la Dirección que la vincule para ver acá tus materias,
                                tus profesores y poder inscribirte a deportes.
                            </p>
                        )}
                        {vinculado && (
                            <>
                                <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '14px' }}>
                                    Legajo {datos.legajo} · {datos.nivel} · {datos.curso}
                                </p>
                                <SeccionesReporte secciones={seccionesFicha} />
                            </>
                        )}
                    </div>
                </div>

                {/* Deportes: grupos por nivel, horario y profesor (sistema de inscripciones) */}
                {vinculado && <MisDeportes alumnoId={perfil.alumno_id} nivel={datos.curso === 'Sin curso' ? null : datos.nivel} />}

                {/* Cultura e Idioma */}
                <div className="dashboard-card" style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                    <h3 style={cardTitleStyle}>🎭 Cultura e Idiomas</h3>
                    <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                        {actividades.length === 0 ? (
                            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>No hay actividades disponibles por el momento.</p>
                        ) : (
                            actividades.map(a => {
                                const inscripto = estaInscripto(a.id);
                                const lleno = a.inscriptos >= a.cupo_max;
                                return (
                                    <div key={a.id} style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: 'white', background: a.tipo === 'Cultura' ? 'var(--violet)' : 'var(--orange)', padding: '3px 8px', borderRadius: '6px' }}>{a.tipo}</span>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: lleno ? '#dc2626' : '#64748b' }}>{a.inscriptos}/{a.cupo_max}</span>
                                        </div>
                                        <p style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)', marginTop: '10px' }}>{a.nombre}</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-sm)', marginBottom: '12px' }}>{a.horario || 'Horario a confirmar'}</p>
                                        {inscripto ? (
                                            <button onClick={() => cancelarInscripcion(a.id)} className="btn btn-hero-outline" style={{ width: '100%', fontSize: '0.8rem', color: '#dc2626', borderColor: '#dc2626' }}>
                                                ✓ Inscripto — Cancelar
                                            </button>
                                        ) : (
                                            <button onClick={() => inscribirse(a.id)} disabled={lleno} className="btn btn-violet" style={{ width: '100%', fontSize: '0.8rem', opacity: lleno ? 0.5 : 1, cursor: lleno ? 'not-allowed' : 'pointer' }}>
                                                {lleno ? 'Sin cupo' : 'Inscribirme'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Comunicados */}
                <div className="dashboard-card" style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                    <h3 style={cardTitleStyle}>📢 Comunicados Recientes</h3>
                    <div style={{ marginTop: '16px' }}>
                        {notificaciones.length === 0 ? (
                            <p style={{ fontSize: '0.9rem', color: '#64748b', padding: '12px 0' }}>No hay comunicados nuevos por el momento.</p>
                        ) : (
                            notificaciones.map((n) => (
                                <div key={n.id} style={comunicadoStyle}>
                                    <p style={{ fontWeight: 800, color: 'var(--orange)' }}>{n.titulo}</p>
                                    <p style={{ fontSize: '0.9rem', marginTop: '4px', lineHeight: '1.5' }}>{n.mensaje}</p>
                                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginTop: '8px', fontWeight: 700 }}>
                                        {new Date(n.fecha_envio).toLocaleString()}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            <Toast
                message={toast.message}
                type={toast.type}
                onClose={() => setToast({ message: '', type: 'success' })}
            />
        </DashboardLayout>
    );
};

const cardStyle = {
    background: 'var(--white)',
    padding: '24px',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-sm)'
};

const cardTitleStyle = {
    fontSize: '1.1rem',
    color: 'var(--blue)',
    borderBottom: '2px solid #f1f5f9',
    paddingBottom: '12px'
};

const comunicadoStyle = {
    padding: '16px',
    background: '#f8fafc',
    borderRadius: '12px',
    marginBottom: '12px'
};

export default AlumnoDashboard;
