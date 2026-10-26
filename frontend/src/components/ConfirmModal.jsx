// Modal de confirmación reutilizable (RNF08: "cuadros de confirmación modal
// previos a operaciones destructivas"). Reemplaza a window.confirm(), que
// algunos navegadores/extensiones/políticas corporativas pueden suprimir en
// silencio sin mostrar ningún diálogo ni error.
const overlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 };
const contentStyle = { background: 'white', padding: '32px', borderRadius: '16px', width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' };

const ConfirmModal = ({
    title = 'Confirmar acción',
    message,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    onConfirm,
    onCancel
}) => (
    <div style={overlayStyle} onClick={onCancel}>
        <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.15rem', color: 'var(--text)', fontWeight: 800, margin: '0 0 12px' }}>{title}</h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 24px', whiteSpace: 'pre-line' }}>{message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button onClick={onCancel} className="btn btn-hero-outline" style={{ fontSize: '0.85rem', padding: '10px 18px', color: 'var(--blue)', borderColor: 'var(--blue)' }}>{cancelLabel}</button>
                <button onClick={onConfirm} className="btn" style={{ background: 'var(--orange)', color: 'white', fontSize: '0.85rem', padding: '10px 18px' }}>{confirmLabel}</button>
            </div>
        </div>
    </div>
);

export default ConfirmModal;
