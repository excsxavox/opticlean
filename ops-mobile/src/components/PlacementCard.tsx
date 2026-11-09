import type { PlacementOption } from '../types';

export function PlacementCard({
  option,
  selected,
  onSelect,
}: {
  option: PlacementOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`place-card ${selected ? 'is-selected' : ''}`} onClick={onSelect}>
      <div className="place-loc">
        <strong className="code-label">{option.id}</strong>
        <span>
          Rack {option.rack} · Nivel {option.level} · {option.free} libres
        </span>
      </div>
      <div className="place-tags">
        {option.familyMatch ? <em className="badge blue">Familia</em> : null}
        {option.isEmpty ? <em className="badge">Vacío</em> : null}
        {option.consolidates ? <em className="badge green">Consolida</em> : null}
        {option.fragileSafe ? <em className="badge amber">Seguro frágil</em> : null}
      </div>
      <ul>
        {option.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </button>
  );
}
