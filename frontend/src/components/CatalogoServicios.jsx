import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';

// Catálogo de servicios para el administrador: los grupos de deportes (cada uno con su deporte, nivel, día y horario
// y el profesor responsable), los servicios de transporte (uno por recorrido) y el comedor. Las reglas las valida el
// servidor (profesor activo y sin otro grupo en ese horario, horario válido, nombre sin repetir, etc.) y esta pantalla
// muestra el motivo cuando rechaza algo.

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const thStyle = { padding: '10px 12px', fontSize: '0.72rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 12px', fontSize: '0.85rem', borderTop: '1px solid #f1f5f9', verticalAlign: 'top' };
const campoStyle = { padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff', maxWidth: '100%', width: '100%' };
const etiquetaStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' };

const horario = (s) => (s.dia_semana ? `${DIAS[s.dia_semana]} ${String(s.hora_inicio).slice(0, 5)} a ${String(s.hora_fin).slice(0, 5)}` : '');
const precio = (n) => `$${Number(n).toLocaleString('es-AR')}`;
const FORMULARIO_VACIO = { tipo: 'Deporte', nombre: '', precio_mensual: '', cupo_max: '', actividad_id: '', nivel_id: '', docente_id: '', dia_semana: '1', hora_inicio: '16:00', hora_fin: '17:00', ruta_id: '' };

function Campo({ id, etiqueta, children }) {
    return (
        <div>
            <label htmlFor={id} style={etiquetaStyle}>{etiqueta}</label>
            {children}
        </div>
    );
}

export default function CatalogoServicios() {
    const { apiFetch } = useAuth();
    const [version, setVersion] = useState(0); // al cambiar, se vuelve a pedir el catálogo
    const [datos, setDatos] = useState(null); // { servicios, actividades, niveles, docentes, rutas }
    const [error, setError] = useState('');
    const [mensaje, setMensaje] = useState({ tipo: '', texto: '' });
    const [form, setForm] = useState(FORMULARIO_VACIO);
    const [edicion, setEdicion] = useState(null); // { servicio, precio_mensual, cupo_max, docente_id }
    const [ocupado, setOcupado] = useState(false);

    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const pedir = async (ruta) => {
                    const r = await apiFetch(`${API_URL}${ruta}`);
                    if (!r.ok) throw new Error('No se pudo cargar el catálogo de servicios.');
                    return r.json();
                };
                const [catalogo, actividades, niveles, docentes, rutas] = await Promise.all([
                    pedir('/api/inscripciones/servicios'), pedir('/api/academico/actividades'), pedir('/api/academico/niveles'),
                    pedir('/api/academico/docentes'), pedir('/api/servicios/transporte/rutas'),
                ]);
                if (activo) {
                    setDatos({ servicios: catalogo.servicios, actividades: actividades.filter((a) => a.tipo === 'Deporte'), niveles, docentes, rutas });
                    setError('');
                }
            } catch (e) {
                if (activo) setError(e.message || 'No se pudo cargar el catálogo de servicios.');
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, version]);

    const cambiar = (campo) => (e) => setForm((previo) => ({ ...previo, [campo]: e.target.value }));

    // Llama a la API y deja en pantalla el resultado o el motivo del rechazo.
    const enviar = async (ruta, metodo, cuerpo, textoOk) => {
        setOcupado(true);
        setMensaje({ tipo: '', texto: '' });
        try {
            const r = await apiFetch(`${API_URL}${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
            const respuesta = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(respuesta.message || 'No se pudo guardar el cambio.');
            setMensaje({ tipo: 'ok', texto: textoOk });
            setVersion((v) => v + 1);
            return true;
        } catch (e) {
            setMensaje({ tipo: 'error', texto: e.message || 'No se pudo guardar el cambio.' });
            return false;
        } finally {
            setOcupado(false);
        }
    };

    // Si el nombre queda vacío se arma con el mismo criterio que el catálogo de ejemplo.
    const nombreSugerido = () => {
        if (!datos) return '';
        if (form.tipo === 'Deporte') {
            const deporte = datos.actividades.find((a) => String(a.id) === form.actividad_id);
            const nivel = datos.niveles.find((n) => String(n.id) === form.nivel_id);
            return deporte && nivel ? `${deporte.nombre} ${nivel.nombre} · ${DIAS[form.dia_semana].toLowerCase()} ${form.hora_inicio}` : '';
        }
        if (form.tipo === 'Transporte') {
            const ruta = datos.rutas.find((r) => String(r.id) === form.ruta_id);
            return ruta ? `Transporte ${ruta.nombre}` : '';
        }
        return 'Comedor escolar';
    };

    const crear = async (e) => {
        e.preventDefault();
        const nombre = form.nombre.trim() || nombreSugerido();
        if (!nombre) { setMensaje({ tipo: 'error', texto: 'Completá el deporte, el nivel y el horario (o escribí un nombre).' }); return; }
        const cuerpo = { tipo: form.tipo, nombre, precio_mensual: Number(form.precio_mensual), cupo_max: form.cupo_max === '' ? null : Number(form.cupo_max) };
        if (form.tipo === 'Deporte') {
            Object.assign(cuerpo, {
                actividad_id: Number(form.actividad_id), nivel_id: Number(form.nivel_id), docente_id: Number(form.docente_id),
                dia_semana: Number(form.dia_semana), hora_inicio: form.hora_inicio, hora_fin: form.hora_fin,
            });
        }
        if (form.tipo === 'Transporte') cuerpo.ruta_id = Number(form.ruta_id);
        if (await enviar('/api/inscripciones/servicios', 'POST', cuerpo, `Se creó el servicio "${nombre}".`)) setForm({ ...FORMULARIO_VACIO, tipo: form.tipo });
    };

    const guardarEdicion = async (e) => {
        e.preventDefault();
        const s = edicion.servicio;
        const cuerpo = { precio_mensual: Number(edicion.precio_mensual), cupo_max: edicion.cupo_max === '' ? null : Number(edicion.cupo_max) };
        if (s.tipo === 'Deporte' && String(edicion.docente_id) !== String(s.docente_id)) cuerpo.docente_id = Number(edicion.docente_id);
        if (await enviar(`/api/inscripciones/servicios/${s.id}`, 'PATCH', cuerpo, `Se actualizó "${s.nombre}".`)) setEdicion(null);
    };

    const alternar = (s) => enviar(`/api/inscripciones/servicios/${s.id}`, 'PATCH', { activo: !s.activo },
        s.activo ? `"${s.nombre}" quedó desactivado: ya no se ofrece a las familias.` : `"${s.nombre}" volvió a estar disponible.`);

    const detalle = (s) => {
        if (s.tipo === 'Deporte') return [s.deporte, s.nivel, horario(s), s.docente ? `Prof. ${s.docente}` : 'Sin profesor'].filter(Boolean).join(' · ');
        if (s.tipo === 'Transporte') return s.ruta ? `Recorrido: ${s.ruta}` : '-';
        return 'Servicio de comedor';
    };

    return (
        <div style={{ background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '6px' }}>🏅 Deportes y servicios</h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '16px' }}>
                Cada deporte tiene sus <strong>grupos</strong> por nivel y horario, con un profesor responsable (los deportes se crean en Gestión Académica → Actividades).
                Para cambiar el nivel o el horario de un grupo, creá uno nuevo y desactivá el anterior.
            </p>

            <div aria-live="polite">
                {mensaje.texto && (
                    <p role={mensaje.tipo === 'error' ? 'alert' : undefined} style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', color: mensaje.tipo === 'error' ? '#991b1b' : '#166534' }}>{mensaje.texto}</p>
                )}
            </div>
            {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700 }}>{error}</p>}
            {!datos && !error && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando…</p>}

            {datos && (
                <>
                    <form onSubmit={crear} style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', alignItems: 'end' }}>
                            <Campo id="cs-tipo" etiqueta="Tipo">
                                <select id="cs-tipo" value={form.tipo} onChange={cambiar('tipo')} style={campoStyle}>
                                    <option value="Deporte">Grupo de deporte</option>
                                    <option value="Transporte">Transporte (recorrido)</option>
                                    <option value="Comedor">Comedor</option>
                                </select>
                            </Campo>
                            {form.tipo === 'Deporte' && (
                                <>
                                    <Campo id="cs-deporte" etiqueta="Deporte">
                                        <select id="cs-deporte" required value={form.actividad_id} onChange={cambiar('actividad_id')} style={campoStyle}>
                                            <option value="">Elegí un deporte</option>
                                            {datos.actividades.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                        </select>
                                    </Campo>
                                    <Campo id="cs-nivel" etiqueta="Nivel">
                                        <select id="cs-nivel" required value={form.nivel_id} onChange={cambiar('nivel_id')} style={campoStyle}>
                                            <option value="">Elegí un nivel</option>
                                            {datos.niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
                                        </select>
                                    </Campo>
                                    <Campo id="cs-docente" etiqueta="Profesor responsable">
                                        <select id="cs-docente" required value={form.docente_id} onChange={cambiar('docente_id')} style={campoStyle}>
                                            <option value="">Elegí un profesor</option>
                                            {datos.docentes.map((d) => <option key={d.id} value={d.id}>{d.apellido}, {d.nombre}</option>)}
                                        </select>
                                    </Campo>
                                    <Campo id="cs-dia" etiqueta="Día">
                                        <select id="cs-dia" value={form.dia_semana} onChange={cambiar('dia_semana')} style={campoStyle}>
                                            {DIAS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                                        </select>
                                    </Campo>
                                    <Campo id="cs-desde" etiqueta="Desde"><input id="cs-desde" type="time" required value={form.hora_inicio} onChange={cambiar('hora_inicio')} style={campoStyle} /></Campo>
                                    <Campo id="cs-hasta" etiqueta="Hasta"><input id="cs-hasta" type="time" required value={form.hora_fin} onChange={cambiar('hora_fin')} style={campoStyle} /></Campo>
                                </>
                            )}
                            {form.tipo === 'Transporte' && (
                                <Campo id="cs-ruta" etiqueta="Recorrido">
                                    <select id="cs-ruta" required value={form.ruta_id} onChange={cambiar('ruta_id')} style={campoStyle}>
                                        <option value="">Elegí un recorrido</option>
                                        {datos.rutas.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                                    </select>
                                </Campo>
                            )}
                            <Campo id="cs-nombre" etiqueta="Nombre (opcional)"><input id="cs-nombre" type="text" maxLength={80} placeholder={nombreSugerido() || 'Se arma solo'} value={form.nombre} onChange={cambiar('nombre')} style={campoStyle} /></Campo>
                            <Campo id="cs-precio" etiqueta="Valor mensual ($)"><input id="cs-precio" type="number" min="1" step="any" required value={form.precio_mensual} onChange={cambiar('precio_mensual')} style={campoStyle} /></Campo>
                            <Campo id="cs-cupo" etiqueta="Cupo (vacío = sin límite)"><input id="cs-cupo" type="number" min="1" step="1" value={form.cupo_max} onChange={cambiar('cupo_max')} style={campoStyle} /></Campo>
                            <button type="submit" disabled={ocupado} className="btn btn-violet" style={{ whiteSpace: 'nowrap', opacity: ocupado ? 0.6 : 1 }}>+ Crear</button>
                        </div>
                    </form>

                    {edicion && (
                        <form onSubmit={guardarEdicion} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
                            <p style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--blue)', marginBottom: '10px' }}>Editar «{edicion.servicio.nombre}»</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', alignItems: 'end' }}>
                                <Campo id="ce-precio" etiqueta="Valor mensual ($)"><input id="ce-precio" type="number" min="1" step="any" required value={edicion.precio_mensual} onChange={(e) => setEdicion({ ...edicion, precio_mensual: e.target.value })} style={campoStyle} /></Campo>
                                <Campo id="ce-cupo" etiqueta="Cupo (vacío = sin límite)"><input id="ce-cupo" type="number" min="1" step="1" value={edicion.cupo_max} onChange={(e) => setEdicion({ ...edicion, cupo_max: e.target.value })} style={campoStyle} /></Campo>
                                {edicion.servicio.tipo === 'Deporte' && (
                                    <Campo id="ce-docente" etiqueta="Profesor responsable">
                                        <select id="ce-docente" value={edicion.docente_id} onChange={(e) => setEdicion({ ...edicion, docente_id: e.target.value })} style={campoStyle}>
                                            {datos.docentes.map((d) => <option key={d.id} value={d.id}>{d.apellido}, {d.nombre}</option>)}
                                        </select>
                                    </Campo>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button type="submit" disabled={ocupado} className="btn btn-violet" style={{ opacity: ocupado ? 0.6 : 1 }}>Guardar</button>
                                    <button type="button" onClick={() => setEdicion(null)} className="btn btn-hero-outline" style={{ color: 'var(--blue)', borderColor: 'var(--blue)' }}>Cancelar</button>
                                </div>
                            </div>
                        </form>
                    )}

                    <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th style={thStyle}>Tipo</th><th style={thStyle}>Servicio</th><th style={thStyle}>Detalle</th>
                                    <th style={thStyle}>Valor</th><th style={thStyle}>Inscriptos / Cupo</th><th style={thStyle}>Estado</th><th style={thStyle}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {datos.servicios.length === 0 ? (
                                    <tr><td colSpan="7" style={{ ...tdStyle, textAlign: 'center', color: '#64748b' }}>Todavía no hay servicios. Creá el primero con el formulario de arriba.</td></tr>
                                ) : datos.servicios.map((s) => (
                                    <tr key={s.id} style={{ opacity: s.activo ? 1 : 0.55 }}>
                                        <td style={tdStyle}>{s.tipo}</td>
                                        <td style={tdStyle}><strong>{s.nombre}</strong></td>
                                        <td style={tdStyle}>{detalle(s)}</td>
                                        <td style={tdStyle}>{precio(s.precio_mensual)}</td>
                                        <td style={tdStyle}>{s.inscriptos} / {s.cupo_max === null ? '∞' : s.cupo_max}</td>
                                        <td style={tdStyle}>{s.activo ? 'Activo' : 'Desactivado'}</td>
                                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                                            <button onClick={() => setEdicion({ servicio: s, precio_mensual: s.precio_mensual, cupo_max: s.cupo_max === null ? '' : s.cupo_max, docente_id: s.docente_id || '' })} disabled={ocupado} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontWeight: 700, cursor: 'pointer' }}>Editar</button>
                                            <button onClick={() => alternar(s)} disabled={ocupado} style={{ background: 'none', border: 'none', color: s.activo ? '#dc2626' : 'var(--green)', fontWeight: 700, cursor: 'pointer' }}>{s.activo ? 'Desactivar' : 'Activar'}</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '8px' }}>Los inscriptos son los del mes actual.</p>
                </>
            )}
        </div>
    );
}
