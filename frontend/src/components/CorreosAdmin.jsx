import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from './ConfirmModal';

// Correos automáticos a las familias (HU10): la factura de fin de mes y el aviso de deuda del día 20 los envía solo el
// sistema (un programador diario llama al servidor). Acá la Dirección ve la auditoría de cada correo y, si hace falta,
// puede simular o disparar el envío a mano.

const ZONA = 'America/Argentina/Buenos_Aires';
const TIPOS = {
    factura_fin_de_mes: 'Factura de fin de mes',
    aviso_deuda: 'Aviso de deuda',
};
const QUE_ENVIAR = [
    { valor: '', texto: 'Lo que corresponde hoy' },
    { valor: 'factura_fin_de_mes', texto: 'Factura de fin de mes' },
    { valor: 'aviso_deuda', texto: 'Aviso de deuda' },
];
const COLORES = {
    Enviado: { fondo: '#dcfce7', texto: '#166534' },
    Omitido: { fondo: '#fef3c7', texto: '#92400e' },
    Error: { fondo: '#fee2e2', texto: '#991b1b' },
};

const momento = (valor) => (valor ? new Date(valor).toLocaleString('es-AR', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' }) : '-');
const campoStyle = { padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem', background: '#fff', minWidth: '170px', maxWidth: '100%' };
const etiquetaStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' };
const thStyle = { padding: '10px 12px', fontSize: '0.72rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 12px', fontSize: '0.85rem', borderTop: '1px solid #f1f5f9', verticalAlign: 'top' };

const Insignia = ({ estado }) => {
    const c = COLORES[estado] || { fondo: '#f1f5f9', texto: '#334155' };
    return <span style={{ background: c.fondo, color: c.texto, fontWeight: 800, fontSize: '0.75rem', padding: '3px 10px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{estado}</span>;
};

export default function CorreosAdmin() {
    const { apiFetch } = useAuth();
    const [tipo, setTipo] = useState('');
    const [estado, setEstado] = useState('');
    const [correos, setCorreos] = useState(null);
    const [version, setVersion] = useState(0);
    const [queEnviar, setQueEnviar] = useState('');
    const [resultado, setResultado] = useState(null);
    const [confirmar, setConfirmar] = useState(false);
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState('');

    const pedir = useCallback(async (ruta, opciones) => {
        const r = await apiFetch(`${API_URL}${ruta}`, opciones);
        let datos = null;
        try { datos = await r.json(); } catch { /* sin JSON */ }
        if (!r.ok) throw new Error((datos && datos.message) || `Error ${r.status}`);
        return datos;
    }, [apiFetch]);

    // La lista se vuelve a pedir al cambiar un filtro o cuando sube `version`
    useEffect(() => {
        let vigente = true;
        const parametros = new URLSearchParams({ limite: '100' });
        if (tipo) parametros.set('tipo', tipo);
        if (estado) parametros.set('estado', estado);
        pedir(`/api/correos?${parametros}`)
            .then((datos) => { if (vigente) { setCorreos(datos.correos); setError(''); } })
            .catch((e) => { if (vigente) setError(e.message); });
        return () => { vigente = false; };
    }, [tipo, estado, version, pedir]);

    const ejecutar = async (simular) => {
        setTrabajando(true);
        setError('');
        setResultado(null);
        try {
            const cuerpo = { simular, ...(queEnviar ? { tipos: [queEnviar] } : {}) };
            setResultado(await pedir('/api/correos/ejecutar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }));
            setVersion((v) => v + 1);
        } catch (e) {
            setError(e.message);
        } finally {
            setTrabajando(false);
            setConfirmar(false);
        }
    };

    return (
        <div>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '6px' }}>✉️ Correos automáticos</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
                El sistema envía solo la <strong>factura de fin de mes</strong> (el último día hábil, con el PDF adjunto) y el <strong>aviso de deuda</strong> (el día 20). Cada intento queda registrado acá. Un correo ya enviado no se repite en el mismo mes.
            </p>

            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px', marginBottom: '22px' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: '10px' }}>Ejecutar a mano</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
                    <div>
                        <label style={etiquetaStyle} htmlFor="co-que">Qué enviar</label>
                        <select id="co-que" style={campoStyle} value={queEnviar} onChange={(e) => setQueEnviar(e.target.value)}>
                            {QUE_ENVIAR.map((q) => <option key={q.valor} value={q.valor}>{q.texto}</option>)}
                        </select>
                    </div>
                    <button className="btn btn-hero-outline" style={{ fontSize: '0.85rem', padding: '10px 18px', color: 'var(--blue)', borderColor: 'var(--blue)' }} disabled={trabajando} onClick={() => ejecutar(true)}>
                        Simular (no envía nada)
                    </button>
                    <button className="btn btn-violet" style={{ fontSize: '0.85rem', padding: '10px 18px' }} disabled={trabajando} onClick={() => setConfirmar(true)}>
                        Enviar ahora
                    </button>
                </div>

                {resultado && (
                    <div role="status" style={{ marginTop: '14px', fontSize: '0.88rem' }}>
                        <p style={{ fontWeight: 800, marginBottom: '6px' }}>
                            {resultado.simulado ? 'Simulación' : 'Envío realizado'} · {resultado.tareas.length === 0 ? 'hoy no corresponde ningún envío' : resultado.tareas.map((t) => TIPOS[t]).join(' y ')} · período {resultado.periodo}
                        </p>
                        {Object.keys(resultado.conteo).length > 0 && (
                            <p style={{ color: '#475569', marginBottom: '6px' }}>{Object.entries(resultado.conteo).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                        )}
                        <ul style={{ margin: 0, paddingLeft: '18px', color: '#475569' }}>
                            {resultado.resultados.map((r, i) => (
                                <li key={i}>{TIPOS[r.tarea]} · {r.nombre}: <strong>{r.resultado}</strong>{r.detalle ? ` (${r.detalle})` : ''}{r.sinCorreo ? ' · sin correo válido' : ''}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end', marginBottom: '14px' }}>
                <div>
                    <label style={etiquetaStyle} htmlFor="co-tipo">Tipo</label>
                    <select id="co-tipo" style={campoStyle} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                        <option value="">Todos</option>
                        {Object.entries(TIPOS).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                    </select>
                </div>
                <div>
                    <label style={etiquetaStyle} htmlFor="co-estado">Estado</label>
                    <select id="co-estado" style={campoStyle} value={estado} onChange={(e) => setEstado(e.target.value)}>
                        <option value="">Todos</option>
                        {['Enviado', 'Error', 'Omitido'].map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                </div>
            </div>

            {error && <p role="alert" style={{ color: '#991b1b', background: '#fee2e2', padding: '10px 14px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 700, marginBottom: '14px' }}>{error}</p>}
            {!correos && !error && <p style={{ color: '#64748b', fontSize: '0.88rem' }}>Cargando…</p>}
            {correos && correos.length === 0 && (
                <p style={{ color: '#64748b', background: '#f8fafc', padding: '16px', borderRadius: '10px', fontSize: '0.9rem', textAlign: 'center' }}>Todavía no se envió ningún correo.</p>
            )}
            {correos && correos.length > 0 && (
                <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>{['Fecha', 'Tipo', 'Período', 'Familia', 'Destinatario', 'Estado', 'Detalle'].map((t) => <th key={t} style={thStyle}>{t}</th>)}</tr>
                        </thead>
                        <tbody>
                            {correos.map((c) => (
                                <tr key={c.id}>
                                    <td style={tdStyle}>{momento(c.creado_en)}</td>
                                    <td style={tdStyle}>{TIPOS[c.tipo] || c.tipo}</td>
                                    <td style={tdStyle}>{c.periodo}</td>
                                    <td style={tdStyle}>{c.familia || '-'}</td>
                                    <td style={{ ...tdStyle, overflowWrap: 'anywhere' }}>{c.destinatario || '-'}</td>
                                    <td style={tdStyle}><Insignia estado={c.estado} /></td>
                                    <td style={{ ...tdStyle, color: '#64748b', maxWidth: '320px', overflowWrap: 'anywhere' }}>{c.detalle || (c.factura ? `Factura ${c.factura}` : '')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {confirmar && (
                <ConfirmModal
                    title="Enviar los correos ahora"
                    message={`Se van a enviar de verdad los correos de «${QUE_ENVIAR.find((q) => q.valor === queEnviar).texto}» a las familias que corresponda.\nSi se trata de la factura de fin de mes, también se emiten las facturas. Lo que ya se envió este mes no se repite.`}
                    confirmLabel="Enviar"
                    onConfirm={() => ejecutar(false)}
                    onCancel={() => setConfirmar(false)}
                />
            )}
        </div>
    );
}
