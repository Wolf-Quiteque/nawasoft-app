import Badge from '@/components/ui/Badge';

const LABELS = {
  active: 'Ativo',
  used: 'Usado',
  refunded: 'Reembolsado',
  cancelled: 'Cancelado',
  pending: 'Pendente',
  // Missed the bus and past its validity. Still reprogrammable, with multa.
  expired: 'Expirado',
};

const TONES = {
  active: 'success',
  used: 'primary',
  refunded: 'danger',
  cancelled: 'neutral',
  pending: 'warning',
  expired: 'warning',
};

export default function TicketStatusBadge({ status }) {
  return <Badge tone={TONES[status] || 'neutral'}>{LABELS[status] || status}</Badge>;
}
