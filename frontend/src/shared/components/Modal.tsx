import { useEffect, type ReactNode } from 'react';
import { Btn } from './ui';
import { Icon } from './Icon';

export function Modal({
  title,
  subtitle,
  children,
  footer,
  wide,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </section>
    </div>
  );
}

export function ModalActions({
  onCancel,
  submitLabel,
  formId,
  icon,
}: {
  onCancel: () => void;
  submitLabel: string;
  formId: string;
  icon?: string;
}) {
  return (
    <>
      <Btn onClick={onCancel}>Cancelar</Btn>
      <button type="submit" form={formId} className="btn primary">
        {icon ? <Icon name={icon} /> : null}
        {submitLabel}
      </button>
    </>
  );
}
