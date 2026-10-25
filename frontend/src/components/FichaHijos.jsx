import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import SeccionesReporte from './SeccionesReporte';

// Portal del padre: ficha de cada hijo (profesores por materia, deportes con horario, transporte y comedor)
// e inscripción del hijo al cursado cuando todavía no tiene curso.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const campoStyle = { padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem', background: '#fff', maxWidth: '100%' };
const etiquetaStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' };

// hijos: los alumnos vinculados al padre. onCambio: se avisa al panel cuando un hijo cambia de curso, para que recargue la lista.
export default function FichaHijos({ hijos, onCambio }) {
    const { apiFetch } = useAuth();
    const [hijoId, setHijoId] = useState(null);
    const [mes, setMes] = useState(() => new Date().getMonth() + 1);
    const [anio, setAnio] = useState(() => new Date().getFullYear());
    const [version, setVersion] = useState(0); // al cambiar, se vuelve a pedir la ficha
    const [respuesta, setRespuesta] = useState(null); // { clave, ficha, error } de la última ficha pedida
    const [cursos, setCursos] = useState([]);
    const [cursoSel, setCursoSel] = useState('');
    const [inscribiendo, setInscribiendo] = useState(false);
    const [mensaje, setMensaje] = useState({ tipo: '', texto: '' });

    // Si el hijo elegido se desvinculó, se vuelve al primero de la lista.
    const actual = hijos.find((h) => h.id === hijoId) || hijos[0] || null;
    const actualId = actual ? actual.id : null;
    const sinCurso = !!actual && !actual.curso_id;
    const clave = `${actualId}-${mes}-${anio}-${version}`;

    useEffect(() => {
        if (!actualId) return undefined;
        let activo = true;
        const cargar = async () => {
            try {
                const r = await apiFetch(`${API_URL}/api/academico/mis-hijos/${actualId}/ficha?mes=${mes}&anio=${anio}`);
                const cuerpo = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(cuerpo.message || 'No se pudo cargar la ficha.');
                if (activo) setRespuesta({ clave, ficha: cuerpo, error: '' });
            } catch (e) {
                if (activo) setRespuesta({ clave, ficha: null, error: e.message || 'No se pudo cargar la ficha.' });
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, actualId, mes, anio, version, clave]);

    // Los cursos con vacantes solo hacen falta si el hijo todavía no está inscripto en uno.
    useEffect(() => {
        if (!sinCurso) return undefined;
        let activo = true;
        const cargar = async () => {
            try {
                const r = await apiFetch(`${API_URL}/api/academico/cursos-disponibles`);
                if (r.ok && activo) setCursos(await r.json());
            } catch { /* sin lista de cursos no se puede inscribir, pero la ficha sigue funcionando */ }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, sinCurso, version]);

    const inscribir = async () => {
        if (!cursoSel) return;
        setInscribiendo(true);
        setMensaje({ tipo: '', texto: '' });
        try {
            const r = await apiFetch(`${API_URL}/api/academico/mis-hijos/${actual.id}/inscribir-curso`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ curso_id: Number(cursoSel) }),
            });
            const cuerpo = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(cuerpo.message || 'No se pudo inscribir al curso.');
            setMensaje({ tipo: 'ok', texto: `${actual.nombre} quedó inscripto/a al curso.` });
            setCursoSel('');
            if (onCambio) onCambio();
        } catch (e) {
            setMensaje({ tipo: 'error', texto: e.message || 'No se pudo inscribir al curso.' });
        }
        setVersion((v) => v + 1); // se recarga la ficha y la lista de vacantes
        setInscribiendo(false);
    };

    if (!actual) return null;

    const cargando = !respuesta || respuesta.clave !== clave;
    const ficha = !cargando ? respuesta.ficha : null;
    const secciones = ficha ? ficha.secciones.slice(1) : []; // la primera (datos del alumno) ya está en el encabezado

    return (
        <div className="dashboard-card" style={{ gridColumn: '1 / -1', background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '16px' }}>
                📘 Ficha de mi hijo/a
            </h3>

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '14px' }}>
                {hijos.length > 1 && (
                    <div>
                        <label htmlFor="ficha-hijo" style={etiquetaStyle}>Hijo/a</label>
                        <select id="ficha-hijo" value={actual.id} onChange={(e) => { setHijoId(Number(e.target.value)); setMensaje({ tipo: '', texto: '' }); }} style={{ ...campoStyle, minWidth: '220px' }}>
                            {hijos.map((h) => <option key={h.id} value={h.id}>{h.apellido}, {h.nombre}</option>)}
                        </select>
                    </div>
                )}
                <div>
                    <label htmlFor="ficha-mes" style={etiquetaStyle}>Mes (deportes y comedor)</label>
                    <select id="ficha-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ ...campoStyle, minWidth: '140px' }}>
                        {MESES.map((nombre, i) => <option key={nombre} value={i + 1}>{nombre}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="ficha-anio" style={etiquetaStyle}>Año</label>
                    <input id="ficha-anio" type="number" min="2020" max="2100" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ ...campoStyle, width: '90px' }} />
                </div>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '14px' }}>
                <strong>{actual.apellido}, {actual.nombre}</strong>
                {actual.curso_id ? ` · ${actual.nivel_nombre || ''} ${actual.division || ''}`.trimEnd() : ' · Sin curso asignado'}
                {ficha ? ` · Legajo ${ficha.secciones[0].filas[0].legajo}` : ''}
            </p>

            {sinCurso && (
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '14px', marginBottom: '18px' }}>
                    <p style={{ fontSize: '0.85rem', color: '#0c4a6e', fontWeight: 700, marginBottom: '10px' }}>
                        {actual.estado === 'Activo'
                            ? `${actual.nombre} todavía no cursa en ningún curso. Podés inscribirlo/a en uno con vacantes:`
                            : 'El legajo no está activo, por lo que no se puede inscribir a un curso. Comunicate con la Dirección.'}
                    </p>
                    {actual.estado === 'Activo' && (
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <select aria-label="Curso" value={cursoSel} onChange={(e) => setCursoSel(e.target.value)} style={{ ...campoStyle, minWidth: '260px' }}>
                                <option value="">Elegí un curso</option>
                                {cursos.map((c) => (
                                    <option key={c.id} value={c.id} disabled={c.vacantes === 0}>
                                        {c.nivel_nombre} · {c.division} ({c.vacantes === 0 ? 'sin vacantes' : `${c.vacantes} ${c.vacantes === 1 ? 'vacante' : 'vacantes'}`})
                                    </option>
                                ))}
                            </select>
                            <button onClick={inscribir} disabled={!cursoSel || inscribiendo} className="btn btn-violet" style={{ fontSize: '0.8rem', opacity: !cursoSel || inscribiendo ? 0.55 : 1 }}>
                                {inscribiendo ? 'Inscribiendo…' : 'Inscribir al curso'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div aria-live="polite">
                {mensaje.texto && (
                    <p role={mensaje.tipo === 'error' ? 'alert' : undefined} style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '14px', color: mensaje.tipo === 'error' ? '#991b1b' : '#166534' }}>
                        {mensaje.texto}
                    </p>
                )}
            </div>

            {cargando && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando ficha…</p>}
            {!cargando && respuesta.error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700 }}>{respuesta.error}</p>}
            {ficha && <SeccionesReporte secciones={secciones} />}
        </div>
    );
}
