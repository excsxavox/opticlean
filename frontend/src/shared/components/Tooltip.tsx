import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Botón con tooltip. Se abre con el cursor, el foco o un toque (queda fijo
 * hasta tocar fuera, Esc o hacer scroll). Se pinta en <body> con posición
 * fija para que no lo recorten tablas con scroll ni modales.
 */
export function TooltipButton({
  content,
  className,
  children,
  label,
}: {
  content: ReactNode;
  className?: string;
  children: ReactNode;
  /** Texto accesible extra para el botón. */
  label?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !tip.current) return;
    const r = trigger.current.getBoundingClientRect();
    const w = tip.current.offsetWidth;
    const h = tip.current.offsetHeight;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? r.top - h - 8 : below;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
      setPos(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => {
    if (!pinned) {
      setOpen(false);
      setPos(null);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-describedby={open ? id : undefined}
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => {
          setPinned(false);
          setOpen(false);
          setPos(null);
        }}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setOpen(false);
            setPos(null);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              ref={tip}
              id={id}
              role="tooltip"
              className="ui-tooltip"
              style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
