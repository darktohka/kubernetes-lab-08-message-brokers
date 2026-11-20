import { BrandMark } from './Icons';
import { CITY_LABEL } from '../constants';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" data-compact={compact || undefined}>
      <BrandMark className="brand__mark" />
      <div className="brand__text">
        <span className="brand__name">ZBOR</span>
        <span className="brand__sub">{compact ? CITY_LABEL : 'Aerial spraying'}</span>
      </div>
    </div>
  );
}
