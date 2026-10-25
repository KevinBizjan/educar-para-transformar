import { API_URL } from '../config';
import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import ConfirmModal from '../components/ConfirmModal';
import FichaHijos from '../components/FichaHijos';
import { useAuth } from '../context/AuthContext';

/**
 * Obtiene el saldo financiero y el resumen académico consolidado de un alumno.
 * @param {Object} hijo - Datos del alumno.
 * @param {Function} apiFetch - Función para realizar peticiones HTTP autenticadas.
 * @returns {Promise<Object>} Datos del alumno enriquecidos con métricas académicas y financieras.
 */
const obtenerDetalleHijo = async (hijo, apiFetch) => {
    const [respuestaSaldo, respuestaResumen] = await Promise.all([
        apiFetch(`${API_URL}/api/financiero/saldo/${hijo.id}`),
        apiFetch(`${API_URL}/api/academico/mis-hijos/${hijo.id}/resumen`)
    ]);

    const datosSaldo = respuestaSaldo.ok ? await respuestaSaldo.json() : { saldo_pendiente: 0 };
    const resumenAcademico = respuestaResumen.ok ? await respuestaResumen.json() : {};

    return {
        ...hijo,
        saldo_pendiente: Number(datosSaldo.saldo_pendiente) || 0,
        promedio: resumenAcademico.promedio ?? null,
        asistencia_pct: resumenAcademico.asistencia_pct ?? null,
        faltas: resumenAcademico.faltas ?? 0,
        calificaciones: resumenAcademico.calificaciones || []
    };
};

/**
 * Calcula el monto total adeudado a partir de una lista de alumnos.
 * @param {Array<Object>} listaHijos 
 * @returns {number} Suma de saldos pendientes.
 */
const calcularSaldoTotal = (listaHijos) => {
    return listaHijos.reduce((acumuladorTotal, hijo) => acumuladorTotal + hijo.saldo_pendiente, 0);
};

const PadreDashboard = () => {
    const { apiFetch } = useAuth();
    const [showMenu, setShowMenu] = useState(false);
    const [showReporte, setShowReporte] = useState(false);
    // Estado del modal de confirmación reutilizable (RNF08), reemplaza a
    // window.confirm() para desvincular un hijo.
    const [confirmState, setConfirmState] = useState(null);
    const pedirConfirmacion = (message, onConfirm) => setConfirmState({ message, onConfirm });
    const cerrarConfirmacion = () => setConfirmState(null);
    const ejecutarConfirmacion = () => {
        const { onConfirm } = confirmState;
        cerrarConfirmacion();
        onConfirm();
    };
    const [notificaciones, setNotificaciones] = useState([]);
    const [hijosReales, setHijosReales] = useState([]);
    const [saldoTotal, setSaldoTotal] = useState(0);
    const [disponibles, setDisponibles] = useState([]);
    const [alumnoSel, setAlumnoSel] = useState('');
    const [pagos, setPagos] = useState([]);

    const fetchPagos = useCallback(async () => {
        try {
            const response = await apiFetch(`${API_URL}/api/financiero/pagos`);
            if (response.ok) setPagos(await response.json());
        } catch (error) {
            console.error('Error al obtener historial de pagos:', error);
        }
    }, [apiFetch]);

    const fetchDisponibles = useCallback(async () => {
        try {
            const response = await apiFetch(`${API_URL}/api/academico/alumnos-disponibles`);
            if (response.ok) setDisponibles(await response.json());
        } catch (error) {
            console.error('Error al obtener alumnos disponibles:', error);
        }
    }, [apiFetch]);

    const fetchNotificaciones = useCallback(async () => {
        try {
            const response = await apiFetch(`${API_URL}/api/comunicacion/notificaciones`);
            if (response.ok) setNotificaciones(await response.json());
        } catch (error) {
            console.error('Error al obtener notificaciones:', error);
        }
    }, [apiFetch]);

    const fetchHijosYSaldos = useCallback(async () => {
        try {
            const response = await apiFetch(`${API_URL}/api/academico/mis-hijos`);
            if (!response.ok) return;

            const listaHijos = await response.json();
            const hijosConDetalle = await Promise.all(
                listaHijos.map((hijo) => obtenerDetalleHijo(hijo, apiFetch))
            );

            setHijosReales(hijosConDetalle);
            setSaldoTotal(calcularSaldoTotal(hijosConDetalle));
        } catch (error) {
            console.error('Error al sincronizar hijos y saldos:', error);
        }
    }, [apiFetch]);

    useEffect(() => {
        fetchNotificaciones();
        fetchHijosYSaldos();
        fetchDisponibles();
        fetchPagos();
    }, [fetchNotificaciones, fetchHijosYSaldos, fetchDisponibles, fetchPagos]);

    const descargarComprobante = async (pagoId) => {
        try {
            const response = await apiFetch(`${API_URL}/api/financiero/comprobante/${pagoId}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return alert(errorData.message || 'No se pudo generar el comprobante');
            }
            const blob = await response.blob();
            const urlDescarga = URL.createObjectURL(blob);
            const elementoEnlace = document.createElement('a');
            elementoEnlace.href = urlDescarga;
            elementoEnlace.setAttribute('download', `comprobante_pago_${pagoId}.pdf`);
            document.body.appendChild(elementoEnlace);
            elementoEnlace.click();
            document.body.removeChild(elementoEnlace);
            URL.revokeObjectURL(urlDescarga);
        } catch (error) {
            console.error('Error al descargar comprobante:', error);
            alert('Error al descargar el comprobante');
        }
    };

    const vincularHijo = async () => {
        if (!alumnoSel) return alert('Seleccioná un alumno para vincular.');
        try {
            const response = await apiFetch(`${API_URL}/api/academico/vincular-hijo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alumno_id: alumnoSel })
            });
            const data = await response.json();
            if (response.ok) {
                setAlumnoSel('');
                fetchHijosYSaldos();
                fetchDisponibles();
            } else {
                alert(data.message || 'No se pudo vincular el alumno.');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const desvincularHijo = (id, nombreCompleto) => {
        pedirConfirmacion(`¿Desvincular a ${nombreCompleto} de tu cuenta?`, async () => {
            try {
                const response = await apiFetch(`${API_URL}/api/academico/desvincular-hijo/${id}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (response.ok) {
                    fetchHijosYSaldos();
                    fetchDisponibles();
                } else {
                    alert(data.message || 'No se pudo desvincular el alumno.');
                }
            } catch (error) {
                console.error(error);
            }
        });
    };

    const [avisosLeidos, setAvisosLeidos] = useState([]);

    const markAsRead = (id) => {
        if (!avisosLeidos.includes(id)) {
            setAvisosLeidos([...avisosLeidos, id]);
        }
    };

    // Hijo seleccionado para el modal "Ver Reporte Completo".
    const [reporteHijo, setReporteHijo] = useState(null);

    // Agregados reales para las tarjetas de resumen (a partir de los hijos vinculados).
    const conPromedio = hijosReales.filter(h => h.promedio != null);
    const promedioGral = conPromedio.length
        ? (conPromedio.reduce((a, h) => a + h.promedio, 0) / conPromedio.length).toFixed(2)
        : null;
    const conAsistencia = hijosReales.filter(h => h.asistencia_pct != null);
    const asistenciaGral = conAsistencia.length
        ? Math.round(conAsistencia.reduce((a, h) => a + h.asistencia_pct, 0) / conAsistencia.length)
        : null;
    const faltasTotal = hijosReales.reduce((a, h) => a + (h.faltas || 0), 0);

    const menuSemanal = [
        { dia: 'Lunes', plato: 'Tallarines con salsa bolognesa', postre: 'Fruta de estación' },
        { dia: 'Martes', plato: 'Pollo al horno con puré', postre: 'Gelatina' },
        { dia: 'Miércoles', plato: 'Milanesa de carne con ensalada', postre: 'Flan con dulce' },
        { dia: 'Jueves', plato: 'Arroz con pollo y vegetales', postre: 'Yogur' },
        { dia: 'Viernes', plato: 'Pizza artesanal y empanadas', postre: 'Helado' },
    ];

    return (
        <DashboardLayout title="Panel para Padres">
            {confirmState && (
                <ConfirmModal
                    message={confirmState.message}
                    onCancel={cerrarConfirmacion}
                    onConfirm={ejecutarConfirmacion}
                />
            )}

            {/* Modal Menú Semanal */}
            {showMenu && (
                <div style={modalOverlay}>
                    <div style={modalContent}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                            <h2 style={{ color: 'var(--blue)' }}>🍎 Menú Semanal Comedor</h2>
                            <button onClick={() => setShowMenu(false)} style={closeBtn}>✕</button>
                        </div>
                        {menuSemanal.map(m => (
                            <div key={m.dia} style={{ padding: '12px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
                                <div>
                                    <strong style={{ color: 'var(--orange)' }}>{m.dia}</strong>: {m.plato}
                                </div>
                                <em style={{ fontSize: '0.8rem', color: '#64748b' }}>Postre: {m.postre}</em>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Modal Reporte Completo */}
            {showReporte && reporteHijo && (
                <div style={modalOverlay} onClick={() => setShowReporte(false)}>
                    <div style={modalContent} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                            <h2 style={{ color: 'var(--blue)' }}>📊 Reporte de {reporteHijo.nombre}</h2>
                            <button onClick={() => setShowReporte(false)} style={closeBtn}>✕</button>
                        </div>
                        <div style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px' }}>
                            <h3 style={{ fontSize: '1rem', marginBottom: '16px' }}>Calificaciones</h3>
                            {(!reporteHijo.calificaciones || reporteHijo.calificaciones.length === 0) ? (
                                <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Todavía no hay calificaciones cargadas.</p>
                            ) : (
                                <div style={{ display: 'grid', gap: '10px' }}>
                                    {reporteHijo.calificaciones.map((c, idx) => (
                                        <div key={idx} style={notaRow}>
                                            <span>{c.materia_nombre || 'Materia'} {c.trimestre ? `(Trim. ${c.trimestre})` : ''}</span>
                                            <strong>{Number(c.nota).toFixed(2)}</strong>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <hr style={{ margin: '20px 0', border: '0', borderTop: '1px solid #e2e8f0' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <strong>Promedio General:</strong>
                                <strong style={{ color: 'var(--blue)', fontSize: '1.2rem' }}>{reporteHijo.promedio ?? '—'}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Resumen Rápido */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <div className="dashboard-card" style={{ ...cardStyle, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📚</div>
                    <span style={labelStyle}>Promedio Gral</span>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--blue)' }}>{promedioGral ?? '—'}</div>
                </div>
                <div className="dashboard-card" style={{ ...cardStyle, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>✅</div>
                    <span style={labelStyle}>Asistencia</span>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--green)' }}>{asistenciaGral != null ? `${asistenciaGral}%` : '—'}</div>
                </div>
                <div className="dashboard-card" style={{ ...cardStyle, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>💰</div>
                    <span style={labelStyle}>Estado Cuota</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: saldoTotal > 0 ? '#991b1b' : 'var(--blue)', marginTop: '8px' }}>{saldoTotal > 0 ? 'CON DEUDA' : 'AL DÍA'}</div>
                </div>
                <div className="dashboard-card" style={{ ...cardStyle, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📅</div>
                    <span style={labelStyle}>Faltas</span>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--orange)' }}>{faltasTotal}</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
                {/* Gestión de Hijos Vinculados */}
                <div style={cardStyle}>
                    <h3 style={cardTitleStyle}>🔗 Mis Hijos Vinculados</h3>

                    <div style={{ marginTop: '16px' }}>
                        {hijosReales.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                Todavía no vinculaste ningún alumno. Seleccioná el legajo de tu hijo/a abajo.
                            </p>
                        ) : (
                            hijosReales.map(h => (
                                <div key={h.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '12px', background: '#f8fafc', borderRadius: '10px', marginBottom: '10px'
                                }}>
                                    <div>
                                        <p style={{ fontWeight: 800, color: 'var(--blue)' }}>{h.apellido}, {h.nombre}</p>
                                        <p style={{ fontSize: '0.75rem', color: '#64748b' }}>DNI: {h.dni}</p>
                                    </div>
                                    <button
                                        onClick={() => desvincularHijo(h.id, `${h.nombre} ${h.apellido}`)}
                                        style={{ background: 'none', border: 'none', color: '#dc2626', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                                    >
                                        Desvincular
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                        <span style={labelStyle}>Vincular un nuevo alumno</span>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                            <select
                                value={alumnoSel}
                                onChange={(e) => setAlumnoSel(e.target.value)}
                                style={{ flex: 1, minWidth: 0, padding: '10px 8px', borderRadius: '8px', border: '2px solid #e2e8f0', fontSize: '0.8rem' }}
                            >
                                <option value="">Seleccionar alumno...</option>
                                {disponibles.map(a => (
                                    <option key={a.id} value={a.id}>{a.apellido}, {a.nombre} (DNI: {a.dni})</option>
                                ))}
                            </select>
                            <button onClick={vincularHijo} className="btn btn-violet" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                                + Vincular
                            </button>
                        </div>
                        {disponibles.length === 0 && (
                            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '8px' }}>
                                No hay alumnos disponibles para vincular.
                            </p>
                        )}
                    </div>
                </div>

                {/* Información del Alumno */}
                <div style={cardStyle}>
                    <h3 style={cardTitleStyle}>👨‍👩‍👧 Seguimiento del Alumno</h3>
                    {hijosReales.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '16px' }}>
                            Vinculá el legajo de tu hijo/a para ver su seguimiento académico.
                        </p>
                    ) : (
                        hijosReales.map((h) => (
                            <div key={h.id} style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', borderRadius: '12px' }}>
                                <p style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--blue)' }}>{h.apellido}, {h.nombre}</p>
                                <p style={{ fontSize: '0.9rem', color: 'var(--text-sm)' }}>{h.nivel_nombre ? `${h.nivel_nombre} ${h.division || ''}` : 'Sin curso asignado'}</p>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '16px' }}>
                                    <div style={infoBox}>
                                        <span style={labelStyle}>Promedio</span>
                                        <span style={{ ...valueStyle, color: 'var(--blue)' }}>{h.promedio ?? '—'}</span>
                                    </div>
                                    <div style={infoBox}>
                                        <span style={labelStyle}>Asistencia</span>
                                        <span style={{ ...valueStyle, color: 'var(--green)' }}>{h.asistencia_pct != null ? `${h.asistencia_pct}%` : '—'}</span>
                                    </div>
                                    <div style={infoBox}>
                                        <span style={labelStyle}>Faltas</span>
                                        <span style={{ ...valueStyle, color: 'var(--orange)' }}>{h.faltas || 0}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setReporteHijo(h); setShowReporte(true); }}
                                    className="btn btn-violet"
                                    style={{ width: '100%', marginTop: '12px', fontSize: '0.8rem' }}
                                >Ver Reporte Completo</button>
                            </div>
                        ))
                    )}
                </div>

                {/* Avisos Institucionales */}
                <div style={cardStyle}>
                    <h3 style={cardTitleStyle}>🔔 Avisos y Citaciones</h3>
                    <div style={{ marginTop: '16px' }}>
                        {notificaciones.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>No hay avisos nuevos.</p>
                        ) : (
                            notificaciones.map((a, i) => (
                                <div
                                    key={i}
                                    style={{
                                        ...avisoStyle,
                                        opacity: avisosLeidos.includes(a.id) ? 0.7 : 1,
                                        borderLeftColor: avisosLeidos.includes(a.id) ? '#cbd5e1' : 'var(--orange)',
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => markAsRead(a.id)}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <p style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                                            {a.titulo}
                                            {!avisosLeidos.includes(a.id) && (
                                                <span style={{ marginLeft: '8px', fontSize: '0.6rem', background: 'var(--orange)', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>NUEVO</span>
                                            )}
                                        </p>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-sm)' }}>
                                            {new Date(a.fecha_envio).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p style={{ fontSize: '0.85rem', marginTop: '4px', color: 'var(--text-sm)' }}>{a.mensaje}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <FichaHijos hijos={hijosReales} onCambio={fetchHijosYSaldos} />

                {/* Calendario de Pagos / Comedor */}
                <div className="dashboard-card" style={cardStyle}>
                    <h3 style={cardTitleStyle}>💳 Estado de Cuenta</h3>
                    <div style={{ marginTop: '20px' }}>
                        <div style={{
                            padding: '20px',
                            background: saldoTotal > 0 ? '#fef2f2' : '#f0f9ff',
                            borderRadius: '12px',
                            border: `1px solid ${saldoTotal > 0 ? '#fecaca' : '#bae6fd'}`,
                            textAlign: 'center', marginBottom: '20px'
                        }}>
                            <span style={labelStyle}>Saldo Pendiente Total</span>
                            <div style={{ fontSize: '2rem', fontWeight: 900, color: saldoTotal > 0 ? '#991b1b' : 'var(--blue)', marginTop: '4px' }}>
                                ${saldoTotal.toFixed(2)}
                            </div>
                            <p style={{ fontSize: '0.75rem', color: saldoTotal > 0 ? '#991b1b' : '#0369a1', marginTop: '8px', fontWeight: 700 }}>
                                {saldoTotal > 0 ? '⚠️ Posee saldo pendiente' : '✅ Cuenta al día'}
                            </p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {hijosReales.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: '#64748b', padding: '8px 0' }}>
                                    Aún no hay hijos vinculados a su cuenta. Solicite a administración la vinculación de su tutoría con el legajo del alumno.
                                </p>
                            ) : (
                                hijosReales.map(h => (
                                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                                        <span>{h.apellido}, {h.nombre}</span>
                                        <span style={{ fontWeight: 800, color: h.saldo_pendiente > 0 ? '#991b1b' : 'var(--green)' }}>
                                            {h.saldo_pendiente > 0 ? `$${h.saldo_pendiente.toFixed(2)}` : 'AL DÍA'}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>

                        <button
                            onClick={() => window.print()}
                            className="btn btn-hero-outline"
                            style={{ width: '100%', marginTop: '20px', fontSize: '0.8rem', color: 'var(--blue)', borderColor: 'var(--blue)' }}
                        >📥 Imprimir / Guardar como PDF</button>

                        <div style={{ marginTop: '24px' }}>
                            <span style={labelStyle}>Comprobantes de Pago</span>
                            {pagos.length === 0 ? (
                                <p style={{ fontSize: '0.8rem', color: '#64748b', padding: '8px 0' }}>
                                    Todavía no hay pagos registrados.
                                </p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                    {pagos.map(p => (
                                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                                            <span>
                                                {p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString('es-AR') : '-'} · {p.alumno_apellido}, {p.alumno_nombre} · <strong>${Number(p.monto_pagado).toFixed(2)}</strong>
                                            </span>
                                            <button onClick={() => descargarComprobante(p.id)} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>📄 PDF</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Comedor y Otros */}
                <div className="dashboard-card" style={cardStyle}>
                    <h3 style={cardTitleStyle}>🍎 Servicios Extra</h3>
                    <div style={{ marginTop: '20px' }}>
                        <div style={infoBox}>
                            <span style={labelStyle}>Comedor Escolar</span>
                            <span style={{ ...valueStyle, color: 'var(--blue)' }}>Activo (Menú General)</span>
                        </div>
                        <button onClick={() => setShowMenu(true)} className="btn btn-green" style={{ width: '100%', marginTop: '16px', fontSize: '0.85rem' }}>Ver Menú Semanal</button>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
};

const modalOverlay = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalContent = { background: 'white', padding: '32px', borderRadius: '16px', width: '90%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' };
const closeBtn = { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' };
const notaRow = { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.9rem' };

const cardStyle = { background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' };
const cardTitleStyle = { fontSize: '1.1rem', color: 'var(--blue)', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' };
const infoBox = { display: 'flex', flexDirection: 'column', background: 'white', padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0' };
const labelStyle = { fontSize: '0.7rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 800 };
const valueStyle = { fontSize: '1rem', fontWeight: 800 };
const avisoStyle = { padding: '12px', borderLeft: '4px solid var(--orange)', background: '#fff7ed', marginBottom: '12px', borderRadius: '0 8px 8px 0' };

export default PadreDashboard;
