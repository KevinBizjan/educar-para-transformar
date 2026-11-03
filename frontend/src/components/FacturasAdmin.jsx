import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useAuth } from '../context/AuthContext';
import ConfirmModal from './ConfirmModal';

// Revisión de facturas (HU9): las familias pagan por transferencia y adjuntan el comprobante desde la app. Acá la Dirección
// ve cada factura con sus ítems y comprobantes, y la da por pagada o la rechaza con un motivo.
// Al darla por pagada, las cuotas quedan registradas como pagos y descuentan del saldo de la familia.

const ZONA = 'America/Argentina/Buenos_Aires';
const ESTADOS = [
    { valor: 'En revision', texto: 'En revisión' },
    { valor: 'Pendiente', texto: 'Pendientes de pago' },
    { valor: 'Pagada', texto: 'Pagadas' },
    { valor: 'Rechazada', texto: 'Rechazadas' },
    { valor: '', texto: 'Todas' },
];
const COLORES = {
    Pendiente: { fondo: '#e0f2fe', texto: '#075985', nombre: 'Pendiente de pago' },
    'En revision': { fondo: '#fef3c7', texto: '#92400e', nombre: 'En revisión' },
    Pagada: { fondo: '#dcfce7', texto: '#166534', nombre: 'Pagada' },
    Rechazada: { fondo: '#fee2e2', texto: '#991b1b', nombre: 'Rechazada' },
};

const pesos = (monto) => Number(monto || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const momento = (valor) => (valor ? new Date(valor).toLocaleString('es-AR', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' }) : '-');
const tamano = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const campoStyle = { padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem', background: '#fff', minWidth: '160px', maxWidth: '100%' };
const etiquetaStyle = { display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' };
const thStyle = { padding: '10px 12px', fontSize: '0.72rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 12px', fontSize: '0.88rem', borderTop: '1px solid #f1f5f9', verticalAlign: 'top' };

const Insignia = ({ estado }) => {
    const c = COLORES[estado] || { fondo: '#f1f5f9', texto: '#334155', nombre: estado };
    return <span style={{ background: c.fondo, color: c.texto, fontWeight: 800, fontSize: '0.75rem', padding: '3px 10px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{c.nombre}</span>;
};

export default function FacturasAdmin() {
    const { apiFetch } = useAuth();
    const [estado, setEstado] = useState('En revision');
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');
    const [facturas, setFacturas] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [version, setVersion] = useState(0); // sube cada vez que hay que volver a pedir la lista
    const [error, setError] = useState('');
    const [aviso, setAviso] = useState('');
    const [rechazando, setRechazando] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [confirmarPago, setConfirmarPago] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const pedir = useCallback(async (ruta, opciones) => {
        const r = await apiFetch(`${API_URL}${ruta}`, opciones);
        let datos = null;
        try { datos = await r.json(); } catch { /* sin JSON */ }
        if (!r.ok) throw new Error((datos && datos.message) || `Error ${r.status}`);
        return datos;
    }, [apiFetch]);

    // La lista se vuelve a pedir al cambiar un filtro o cuando sube `version`. Sin setState síncrono dentro del efecto.
    useEffect(() => {
        let vigente = true;
        const parametros = new URLSearchParams();
        if (estado) parametros.set('estado', estado);
        if (desde) parametros.set('desde', desde);
        if (hasta) parametros.set('hasta', hasta);
        pedir(`/api/facturas?${parametros}`)
            .then((datos) => { if (vigente) { setFacturas(datos.facturas); setError(''); } })
            .catch((e) => { if (vigente) setError(e.message); });
        return () => { vigente = false; };
    }, [estado, desde, hasta, version, pedir]);

    const abrir = async (id) => {
        setError('');
        setAviso('');
        setRechazando(false);
        setMotivo('');
        try { setDetalle(await pedir(`/api/facturas/${id}`)); } catch (e) { setError(e.message); }
    };

    const verComprobante = async (c) => {
        try {
            const { url } = await pedir(`/api/facturas/comprobantes/${c.id}/url`);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
            setError(e.message);
        }
    };

    const cambiarEstado = async (nuevo) => {
        setEnviando(true);
        setError('');
        try {
            const r = await pedir(`/api/facturas/${detalle.id}/estado`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: nuevo, motivo }),
            });
            setAviso(`${r.message}: ${detalle.referencia}`);
            setConfirmarPago(false);
            setRechazando(false);
            setMotivo('');
            setDetalle(await pedir(`/api/facturas/${detalle.id}`));
            setVersion((v) => v + 1);
        } catch (e) {
            setError(e.message);
            setConfirmarPago(false);
        } finally {
            setEnviando(false);
        }
    };

    const abierta = detalle && (detalle.estado === 'En revision' || detalle.estado === 'Pendiente');

    return (
        <div>
            <h3 style={{ fontSize: '1.1rem', color: 'var(--blue)', fontWeight: 800, marginBottom: '6px' }}>🧾 Facturas de las familias</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
                Las familias pagan por transferencia y adjuntan el comprobante desde la app. Revisá el comprobante y dá por pagada la factura, o rechazala indicando qué corregir.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end', marginBottom: '16px' }}>
                <div>
                    <label style={etiquetaStyle} htmlFor="fa-estado">Estado</label>
                    <select id="fa-estado" style={campoStyle} value={estado} onChange={(e) => { setEstado(e.target.value); setDetalle(null); }}>
                        {ESTADOS.map((e) => <option key={e.valor} value={e.valor}>{e.texto}</option>)}
                    </select>
                </div>
                <div>
                    <label style={etiquetaStyle} htmlFor="fa-desde">Emitida desde</label>
                    <input id="fa-desde" type="date" style={campoStyle} value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
                </div>
                <div>
                    <label style={etiquetaStyle} htmlFor="fa-hasta">Emitida hasta</label>
                    <input id="fa-hasta" type="date" style={campoStyle} value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
                </div>
            </div>

            {error && <p role="alert" style={{ color: '#991b1b', background: '#fee2e2', padding: '10px 14px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 700, marginBottom: '14px' }}>{error}</p>}
            {aviso && <p role="status" style={{ color: '#166534', background: '#dcfce7', padding: '10px 14px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 700, marginBottom: '14px' }}>{aviso}</p>}

            {!facturas && !error && <p style={{ color: '#64748b', fontSize: '0.88rem' }}>Cargando…</p>}
            {facturas && facturas.length === 0 && (
                <p style={{ color: '#64748b', background: '#f8fafc', padding: '16px', borderRadius: '10px', fontSize: '0.9rem', textAlign: 'center' }}>
                    {estado === 'En revision' ? 'No hay facturas esperando revisión.' : 'No hay facturas con estos filtros.'}
                </p>
            )}
            {facturas && facturas.length > 0 && (
                <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px', marginBottom: '22px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>{['Referencia', 'Familia', 'Emitida', 'Total', 'Comprobantes', 'Estado', ''].map((t) => <th key={t} style={thStyle}>{t}</th>)}</tr>
                        </thead>
                        <tbody>
                            {facturas.map((f) => (
                                <tr key={f.id} style={{ background: detalle && detalle.id === f.id ? '#eff6ff' : undefined }}>
                                    <td style={{ ...tdStyle, fontWeight: 800 }}>{f.referencia}</td>
                                    <td style={tdStyle}>{f.padre}</td>
                                    <td style={tdStyle}>{momento(f.emitida_en)}</td>
                                    <td style={{ ...tdStyle, fontWeight: 700 }}>{pesos(f.total)}</td>
                                    <td style={tdStyle}>{f.cantidad_comprobantes}</td>
                                    <td style={tdStyle}><Insignia estado={f.estado} /></td>
                                    <td style={tdStyle}>
                                        <button className="btn btn-hero-outline" style={{ fontSize: '0.78rem', padding: '6px 12px', color: 'var(--blue)', borderColor: 'var(--blue)' }} onClick={() => abrir(f.id)}>
                                            {f.estado === 'En revision' ? 'Revisar' : 'Ver'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {detalle && (
                <section aria-label={`Factura ${detalle.referencia}`} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '22px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '10px', marginBottom: '14px' }}>
                        <div>
                            <h4 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>{detalle.referencia}</h4>
                            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>{detalle.padre} ({detalle.padre_usuario}) · emitida el {momento(detalle.emitida_en)}</p>
                        </div>
                        <div style={{ alignSelf: 'flex-start' }}><Insignia estado={detalle.estado} /></div>
                    </div>

                    <h5 style={etiquetaStyle}>Ítems a pagar</h5>
                    <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                                {detalle.items.map((i) => (
                                    <tr key={i.id}>
                                        <td style={tdStyle}>{i.descripcion}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{pesos(i.monto)}</td>
                                    </tr>
                                ))}
                                <tr>
                                    <td style={{ ...tdStyle, fontWeight: 800, textAlign: 'right' }}>Total a transferir</td>
                                    <td style={{ ...tdStyle, fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap' }}>{pesos(detalle.total)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <h5 style={etiquetaStyle}>Comprobantes adjuntos ({detalle.comprobantes.length})</h5>
                    {detalle.comprobantes.length === 0 && <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>La familia todavía no adjuntó ningún comprobante.</p>}
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
                        {detalle.comprobantes.map((c) => (
                            <li key={c.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', padding: '6px 0' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.88rem', overflowWrap: 'anywhere' }}>{c.nombre_archivo}</span>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{tamano(c.tamano_bytes)} · {momento(c.subido_en)}</span>
                                <button className="btn btn-hero-outline" style={{ fontSize: '0.78rem', padding: '5px 12px', color: 'var(--blue)', borderColor: 'var(--blue)' }} onClick={() => verComprobante(c)}>Ver archivo</button>
                            </li>
                        ))}
                    </ul>

                    {detalle.estado === 'Rechazada' && (
                        <p style={{ fontSize: '0.88rem', color: '#991b1b', background: '#fee2e2', padding: '10px 14px', borderRadius: '8px' }}>
                            <strong>Motivo del rechazo:</strong> {detalle.motivo_rechazo}
                        </p>
                    )}
                    {(detalle.estado === 'Pagada' || detalle.estado === 'Rechazada') && detalle.revisada_en && (
                        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '10px' }}>Revisada por {detalle.revisada_por || '—'} el {momento(detalle.revisada_en)}.</p>
                    )}

                    {abierta && !rechazando && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {detalle.estado === 'En revision' && (
                                <button className="btn btn-violet" style={{ fontSize: '0.85rem', padding: '10px 18px' }} disabled={enviando} onClick={() => setConfirmarPago(true)}>
                                    ✔ Dar por pagada
                                </button>
                            )}
                            <button className="btn btn-hero-outline" style={{ fontSize: '0.85rem', padding: '10px 18px', color: '#991b1b', borderColor: '#991b1b' }} disabled={enviando} onClick={() => setRechazando(true)}>
                                {detalle.estado === 'Pendiente' ? 'Anular factura' : 'Rechazar'}
                            </button>
                        </div>
                    )}
                    {abierta && rechazando && (
                        <form onSubmit={(e) => { e.preventDefault(); cambiarEstado('Rechazada'); }} style={{ maxWidth: '520px' }}>
                            <label style={etiquetaStyle} htmlFor="fa-motivo">Motivo (lo va a ver la familia)</label>
                            <textarea id="fa-motivo" required maxLength={300} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: el monto transferido no coincide con el total." style={{ ...campoStyle, width: '100%', resize: 'vertical' }} />
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                <button type="submit" className="btn" style={{ background: 'var(--orange)', color: 'white', fontSize: '0.85rem', padding: '10px 18px' }} disabled={enviando || !motivo.trim()}>Confirmar rechazo</button>
                                <button type="button" className="btn btn-hero-outline" style={{ fontSize: '0.85rem', padding: '10px 18px', color: 'var(--blue)', borderColor: 'var(--blue)' }} onClick={() => { setRechazando(false); setMotivo(''); }}>Cancelar</button>
                            </div>
                        </form>
                    )}
                </section>
            )}

            {confirmarPago && detalle && (
                <ConfirmModal
                    title="Dar la factura por pagada"
                    message={`Se confirma que llegó la transferencia de ${pesos(detalle.total)} (${detalle.referencia}).\nLas cuotas incluidas quedan registradas como pagos y descuentan del saldo de ${detalle.padre}. No se puede deshacer.`}
                    confirmLabel="Dar por pagada"
                    onConfirm={() => cambiarEstado('Pagada')}
                    onCancel={() => setConfirmarPago(false)}
                />
            )}
        </div>
    );
}
