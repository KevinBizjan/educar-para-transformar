import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';

// Vincula cada cuenta de docente o de alumno con su legajo, para que cada persona vea solo lo suyo:
// el docente, sus cursos y alumnos; el alumno, sus inscripciones. El vínculo es uno a uno.

const thStyle = { padding: '10px 14px', fontSize: '0.75rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 14px', fontSize: '0.88rem', borderTop: '1px solid #f1f5f9' };
const campoStyle = { padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff', maxWidth: '100%' };

// tipo: 'docente' | 'alumno'. Cada fila elige entre su cuenta actual, las cuentas libres de ese rol y "Sin vincular".
function TablaVinculos({ tipo, titulo, legajos, libres, ocupado, onCambiar }) {
    const [buscar, setBuscar] = useState('');
    const [soloSinVincular, setSoloSinVincular] = useState(false);
    const cuentasLibres = libres.filter((c) => c.rol === tipo);
    const vinculados = legajos.filter((l) => l.user_id).length;
    const texto = buscar.trim().toLowerCase();
    const visibles = legajos.filter((l) => (!soloSinVincular || !l.user_id)
        && (!texto || `${l.apellido} ${l.nombre} ${l.legajo}`.toLowerCase().includes(texto)));

    return (
        <section style={{ marginTop: '22px' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text)', fontWeight: 800, marginBottom: '4px' }}>{titulo}</h3>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '10px' }}>
                {vinculados} de {legajos.length} con cuenta vinculada · {cuentasLibres.length} {cuentasLibres.length === 1 ? 'cuenta libre' : 'cuentas libres'}
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
                <input type="search" aria-label={`Buscar ${titulo.toLowerCase()}`} placeholder="Buscar por nombre o legajo" value={buscar}
                    onChange={(e) => setBuscar(e.target.value)} style={{ ...campoStyle, minWidth: '240px' }} />
                <label style={{ fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="checkbox" checked={soloSinVincular} onChange={(e) => setSoloSinVincular(e.target.checked)} /> Solo sin vincular
                </label>
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#f8fafc' }}>
                        <tr><th style={thStyle}>Legajo</th><th style={thStyle}>Nombre</th><th style={thStyle}>Estado</th><th style={thStyle}>Cuenta vinculada</th></tr>
                    </thead>
                    <tbody>
                        {visibles.length === 0 ? (
                            <tr><td colSpan="4" style={{ ...tdStyle, textAlign: 'center', color: '#64748b' }}>No hay resultados.</td></tr>
                        ) : visibles.map((l) => (
                            <tr key={l.id}>
                                <td style={tdStyle}>{l.legajo}</td>
                                <td style={tdStyle}><strong>{l.apellido}</strong>, {l.nombre}</td>
                                <td style={tdStyle}>{l.estado}</td>
                                <td style={tdStyle}>
                                    <select aria-label={`Cuenta de ${l.apellido}, ${l.nombre}`} value={l.user_id || ''} disabled={ocupado}
                                        onChange={(e) => onCambiar(tipo, l, e.target.value ? Number(e.target.value) : null)} style={campoStyle}>
                                        <option value="">Sin vincular</option>
                                        {l.user_id && <option value={l.user_id}>{l.username}</option>}
                                        {cuentasLibres.map((c) => <option key={c.id} value={c.id}>{c.username} ({c.nombre})</option>)}
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default function VinculosCuentas() {
    const { apiFetch } = useAuth();
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const [version, setVersion] = useState(0); // al cambiar, se vuelven a pedir los datos

    useEffect(() => {
        let activo = true;
        const cargar = async () => {
            try {
                const r = await apiFetch(`${API_URL}/api/vinculos`);
                if (!r.ok) throw new Error('No se pudieron cargar los vínculos.');
                const cuerpo = await r.json();
                if (activo) setDatos(cuerpo);
            } catch (e) {
                if (activo) setError(e.message || 'No se pudieron cargar los vínculos.');
            } finally {
                if (activo) setOcupado(false);
            }
        };
        cargar();
        return () => { activo = false; };
    }, [apiFetch, version]);

    const cambiar = async (tipo, legajo, userId) => {
        setOcupado(true);
        setError('');
        setAviso('');
        try {
            const r = await apiFetch(`${API_URL}/api/vinculos/${tipo === 'docente' ? 'docentes' : 'alumnos'}/${legajo.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId }),
            });
            const cuerpo = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(cuerpo.message || 'No se pudo guardar el vínculo.');
            setAviso(userId ? `${legajo.apellido}, ${legajo.nombre} quedó vinculado a la cuenta ${cuerpo.username}.` : `${legajo.apellido}, ${legajo.nombre} quedó sin cuenta vinculada.`);
        } catch (e) {
            setError(e.message || 'No se pudo guardar el vínculo.');
        }
        setVersion((v) => v + 1); // se recargan las listas: la cuenta pasa de libre a ocupada (o al revés)
    };

    return (
        <div style={{ background: 'var(--white)', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', marginTop: '24px' }}>
            <h2 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '6px' }}>🔗 Vincular cuentas con legajos</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                Asociá la cuenta de cada docente y de cada alumno con su legajo. Un docente vinculado ve solo los alumnos y materias de sus cursos;
                mientras no esté vinculado, mantiene la vista completa.
            </p>

            <div aria-live="polite">
                {aviso && <p style={{ fontSize: '0.85rem', color: '#166534', fontWeight: 700, marginTop: '12px' }}>{aviso}</p>}
                {error && <p role="alert" style={{ fontSize: '0.85rem', color: '#991b1b', fontWeight: 700, marginTop: '12px' }}>{error}</p>}
            </div>

            {!datos && !error && <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '12px' }}>Cargando…</p>}
            {datos && (
                <>
                    <TablaVinculos tipo="docente" titulo="Docentes" legajos={datos.docentes} libres={datos.cuentas_libres} ocupado={ocupado} onCambiar={cambiar} />
                    <TablaVinculos tipo="alumno" titulo="Alumnos" legajos={datos.alumnos} libres={datos.cuentas_libres} ocupado={ocupado} onCambiar={cambiar} />
                </>
            )}
        </div>
    );
}
