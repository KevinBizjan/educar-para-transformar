import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';

// Los 9 reportes de la Dirección. La lista de reportes y de filtros viene del backend (GET /api/reportes),
// así que esta pantalla muestra cualquiera de ellos con el mismo componente: filtros, tabla y descarga en CSV.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const thStyle = { padding: '12px 14px', fontSize: '0.75rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap' };
const tdStyle = { padding: '12px 14px', fontSize: '0.88rem', verticalAlign: 'top', borderTop: '1px solid #f1f5f9' };
const campoStyle = { padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem', background: '#fff', minWidth: '180px', maxWidth: '100%' };
const etiquetaStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' };

// Qué lista de opciones usa cada tipo de filtro y cómo se muestra cada opción.
const ETIQUETA_FILTRO = {
    alumno: 'Alumno', docente: 'Docente', nivel: 'Nivel educativo', curso: 'Curso',
    materia: 'Materia', deporte: 'Deporte', ruta: 'Recorrido',
};

export default function ReportesListados() {
    const { apiFetch } = useAuth();
    const [catalogo, setCatalogo] = useState([]);
    const [opciones, setOpciones] = useState(null);
    const [reporteId, setReporteId] = useState('');
    const [filtros, setFiltros] = useState({});
    const [mes, setMes] = useState(() => new Date().getMonth() + 1);
    const [anio, setAnio] = useState(() => new Date().getFullYear());
    const [resultado, setResultado] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');

    // Al abrir la pantalla: la lista de reportes y las opciones de los filtros (niveles, cursos, etc.)
    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const [rc, ro] = await Promise.all([apiFetch(`${API_URL}/api/reportes`), apiFetch(`${API_URL}/api/reportes/opciones`)]);
                if (!rc.ok || !ro.ok) throw new Error('No se pudieron cargar los reportes.');
                const [c, o] = await Promise.all([rc.json(), ro.json()]);
                if (!activo) return;
                setCatalogo(c);
                setOpciones(o);
                setReporteId(c.length ? c[0].id : '');
            } catch (e) {
                if (activo) setError(e.message || 'No se pudieron cargar los reportes.');
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch]);

    const reporte = useMemo(() => catalogo.find((r) => r.id === reporteId) || null, [catalogo, reporteId]);

    const elegirReporte = (id) => {
        setReporteId(id);
        setFiltros({});
        setResultado(null);
        setError('');
    };
    // Al cambiar un filtro se limpian los que dependen de él (curso depende del nivel; materia, del curso).
    const cambiarFiltro = (clave, valor) => {
        setFiltros((previos) => {
            const nuevos = { ...previos, [clave]: valor };
            if (clave === 'nivel_id') { delete nuevos.curso_id; delete nuevos.materia_id; }
            if (clave === 'curso_id') delete nuevos.materia_id;
            return nuevos;
        });
    };

    const faltaObligatorio = reporte ? reporte.filtros.some((f) => f.obligatorio && !filtros[f.clave]) : true;

    // Arma la URL del reporte con los filtros elegidos
    const urlReporte = (formato) => {
        const params = new URLSearchParams();
        for (const f of reporte.filtros) {
            if (f.tipo === 'periodo') { params.set('mes', mes); params.set('anio', anio); }
            else if (filtros[f.clave] && f.clave !== 'alumno_id' && f.clave !== 'docente_id') params.set(f.clave, filtros[f.clave]);
        }
        if (formato) params.set('formato', formato);
        const ruta = reporte.id === 'alumno' ? `alumno/${filtros.alumno_id}` : reporte.id === 'docente' ? `docente/${filtros.docente_id}` : reporte.id;
        const consulta = params.toString();
        return `${API_URL}/api/reportes/${ruta}${consulta ? `?${consulta}` : ''}`;
    };

    const generar = async () => {
        if (!reporte || faltaObligatorio) return;
        setCargando(true);
        setError('');
        try {
            const respuesta = await apiFetch(urlReporte());
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.message || 'No se pudo generar el reporte.');
            setResultado(datos);
        } catch (e) {
            setResultado(null);
            setError(e.message || 'No se pudo generar el reporte.');
        } finally {
            setCargando(false);
        }
    };

    const descargar = async () => {
        if (!reporte || faltaObligatorio) return;
        setError('');
        try {
            const respuesta = await apiFetch(urlReporte('csv'));
            if (!respuesta.ok) {
                const datos = await respuesta.json().catch(() => ({}));
                throw new Error(datos.message || 'No se pudo descargar el archivo.');
            }
            const blob = await respuesta.blob();
            const disposicion = respuesta.headers.get('Content-Disposition') || '';
            const nombre = (disposicion.match(/filename="([^"]+)"/) || [])[1] || `${reporte.id}.csv`;
            const url = URL.createObjectURL(blob);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = nombre;
            document.body.appendChild(enlace);
            enlace.click();
            document.body.removeChild(enlace);
            URL.revokeObjectURL(url);
        } catch (e) {
            setError(e.message || 'No se pudo descargar el archivo.');
        }
    };

    // Opciones de cada filtro (curso según el nivel elegido, materia según el curso)
    const opcionesDe = (tipo) => {
        if (!opciones) return [];
        switch (tipo) {
            case 'alumno': return opciones.alumnos.map((a) => ({ valor: a.id, texto: `${a.apellido}, ${a.nombre} (${a.legajo})` }));
            case 'docente': return opciones.docentes.map((d) => ({ valor: d.id, texto: `${d.apellido}, ${d.nombre}` }));
            case 'nivel': return opciones.niveles.map((n) => ({ valor: n.id, texto: n.nombre }));
            case 'curso': return opciones.cursos
                .filter((c) => !filtros.nivel_id || String(c.nivel_id) === String(filtros.nivel_id))
                .map((c) => ({ valor: c.id, texto: `${c.nivel} · ${c.division}` }));
            case 'materia': return opciones.materias
                .filter((m) => !filtros.curso_id || String(m.curso_id) === String(filtros.curso_id))
                .map((m) => ({ valor: m.id, texto: m.nombre }));
            case 'deporte': return opciones.deportes.map((d) => ({ valor: d.id, texto: d.nombre }));
            case 'ruta': return opciones.rutas.map((r) => ({ valor: r.id, texto: r.nombre }));
            default: return [];
        }
    };

    const celda = (valor) => (valor === null || valor === undefined || valor === '' ? '-' : String(valor));

    return (
        <div style={{ background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', marginTop: '24px' }}>
            <h2 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '6px' }}>📊 Reportes de la Dirección</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '18px' }}>
                Elegí un reporte, ajustá los filtros y generalo en pantalla o descargalo en CSV (se abre en Excel).
            </p>

            {!opciones && !error && <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Cargando reportes…</p>}

            {opciones && reporte && (
                <>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div>
                            <label htmlFor="reporte-id" style={etiquetaStyle}>Reporte</label>
                            <select id="reporte-id" value={reporteId} onChange={(e) => elegirReporte(e.target.value)} style={{ ...campoStyle, minWidth: '300px' }}>
                                {catalogo.map((r) => <option key={r.id} value={r.id}>{r.titulo}</option>)}
                            </select>
                        </div>

                        {reporte.filtros.map((f) => f.tipo === 'periodo' ? (
                            <div key={f.clave} style={{ display: 'flex', gap: '8px' }}>
                                <div>
                                    <label htmlFor="rep-mes" style={etiquetaStyle}>Mes</label>
                                    <select id="rep-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ ...campoStyle, minWidth: '130px' }}>
                                        {MESES.map((nombre, i) => <option key={nombre} value={i + 1}>{nombre}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="rep-anio" style={etiquetaStyle}>Año</label>
                                    <input id="rep-anio" type="number" min="2020" max="2100" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ ...campoStyle, minWidth: '90px', width: '90px' }} />
                                </div>
                            </div>
                        ) : (
                            <div key={f.clave}>
                                <label htmlFor={`rep-${f.clave}`} style={etiquetaStyle}>{ETIQUETA_FILTRO[f.tipo]}{f.obligatorio ? ' *' : ''}</label>
                                <select id={`rep-${f.clave}`} value={filtros[f.clave] || ''} onChange={(e) => cambiarFiltro(f.clave, e.target.value)} style={campoStyle}>
                                    <option value="">{f.obligatorio ? 'Elegí una opción' : 'Todos'}</option>
                                    {opcionesDe(f.tipo).map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>

                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '12px 0' }}>{reporte.descripcion}</p>

                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button onClick={generar} disabled={cargando || faltaObligatorio} className="btn btn-violet" style={{ fontSize: '0.8rem', opacity: cargando || faltaObligatorio ? 0.55 : 1 }}>
                            {cargando ? 'Generando…' : 'Generar reporte'}
                        </button>
                        <button onClick={descargar} disabled={faltaObligatorio} className="btn btn-hero-outline" style={{ fontSize: '0.8rem', color: 'var(--blue)', borderColor: 'var(--blue)', opacity: faltaObligatorio ? 0.55 : 1 }}>
                            📄 Descargar CSV
                        </button>
                    </div>
                    {faltaObligatorio && <p style={{ fontSize: '0.78rem', color: '#92400e', marginTop: '8px' }}>Elegí la persona para generar este reporte.</p>}
                </>
            )}

            {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700, marginTop: '14px' }}>{error}</p>}

            {resultado && (
                <div style={{ marginTop: '22px' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--text)', fontWeight: 800, marginBottom: '4px' }}>{resultado.titulo}</h3>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '14px' }}>Generado el {new Date(resultado.generado_en).toLocaleString('es-AR')}</p>

                    {resultado.secciones.map((sec) => (
                        <div key={sec.titulo} style={{ marginBottom: '22px' }}>
                            {(resultado.secciones.length > 1 || sec.total > 0) && (
                                <h4 style={{ fontSize: '0.85rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '8px' }}>
                                    {sec.titulo} <span style={{ color: '#94a3b8', fontWeight: 600 }}>· {sec.total} {sec.total === 1 ? 'fila' : 'filas'}</span>
                                </h4>
                            )}
                            {sec.total === 0 ? (
                                <p style={{ fontSize: '0.85rem', color: '#64748b', padding: '14px', background: '#f8fafc', borderRadius: '8px' }}>
                                    {resultado.secciones.length > 1 ? `${sec.titulo}: sin datos.` : 'No hay resultados para estos filtros.'}
                                </p>
                            ) : (
                                <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead style={{ background: '#f8fafc' }}>
                                            <tr>{sec.columnas.map((c) => <th key={c.clave} style={thStyle}>{c.titulo}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                            {sec.filas.map((fila, i) => (
                                                <tr key={i}>{sec.columnas.map((c) => <td key={c.clave} style={tdStyle}>{celda(fila[c.clave])}</td>)}</tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
