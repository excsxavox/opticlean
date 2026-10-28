import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function esc(v: unknown) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function PageHead({
  eyebrow,
  title,
  desc,
  actions,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}

export function Kpi({
  label,
  value,
  unit,
  foot,
  icon = 'box',
  color = '',
}: {
  label: string;
  value: string | number;
  unit: string;
  foot: string;
  icon?: string;
  color?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        {label}
        <Icon name={icon} />
      </div>
      <div className="kpi-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      <div className={`kpi-foot ${color}`}>
        {color === 'positive' ? <Icon name="check" /> : null}
        {foot}
      </div>
    </div>
  );
}

export function Badge({ text, color = '' }: { text: string; color?: string }) {
  return <span className={`badge ${color}`}>{text}</span>;
}

type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  icon?: string;
  variant?: '' | 'primary' | 'ghost' | 'small' | 'green' | 'danger' | 'full';
  type?: 'button' | 'submit';
  disabled?: boolean;
};

export function Btn({
  children,
  onClick,
  icon,
  variant = '',
  type = 'button',
  disabled,
}: BtnProps) {
  return (
    <button
      type={type}
      className={`btn ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Empty({ title, desc, action }: { title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name="box" />
      <h3>{title}</h3>
      <p>{desc}</p>
      {action}
    </div>
  );
}

export function ProductCell({ name, id, category }: { name: string; id: string; category: string }) {
  return (
    <div className="table-product">
      <span className="product-icon">
        <Icon name="box" />
      </span>
      <div>
        <strong>{name}</strong>
        <span className="sub">
          {id} · {category}
        </span>
      </div>
    </div>
  );
}
