import { MapPin } from 'lucide-react';
import { NO_TRIP_GROUP } from '@/lib/origin-groups';

export default function OriginProvinceSection({ province, count, children }) {
  const idle = province === NO_TRIP_GROUP;
  return (
    <section>
      <div className="mb-2 mt-2 flex items-center gap-2 px-0.5">
        <MapPin size={14} className={idle ? 'text-muted-foreground' : 'text-primary'} />
        <h2 className={`text-xs font-extrabold uppercase tracking-[0.14em] ${idle ? 'text-muted-foreground' : 'text-foreground'}`}>
          {province}
        </h2>
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold text-muted-foreground">{count}</span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
