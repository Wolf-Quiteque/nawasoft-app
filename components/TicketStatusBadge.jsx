import Badge from '@/components/ui/Badge';

const LABELS = {
  active: 'Ativo',
  used: 'Usado',
  refunded: 'Reembolsado',
  cancelled: 'Cancelado',
  pending: 'Pendente',
};

const TONES = {
  active: 'success',
  used: 'primary',
  refunded: 'danger',
  cancelled: 'neutral',
  pending: 'warning',
};

export default function TicketStatusBadge({ status }) {
  return <Badge tone={TONES[status] || 'neutral'}>{LABELS[status] || status}</Badge>;
}
