// The rebooking rules live in the database (`rebook_ticket`, migration
// admin-app/supabase/migrations/20260920_rebooking_engine.sql). Nothing here
// decides whether a rebook is free or what the multa is — the server does,
// and this file only turns its answers into Portuguese for the screen.

export const REBOOK_ERRORS = {
  REBOOK_UNKNOWN_ACTOR: 'Não foi possível identificar quem está a reprogramar.',
  REBOOK_TICKET_NOT_FOUND: 'Bilhete não encontrado.',
  REBOOK_NOT_STAFF: 'Esta conta não pode reprogramar bilhetes.',
  REBOOK_NOT_ADMIN: 'Só administradores podem reprogramar no NAWASOFT.',
  REBOOK_SELF_SERVICE_OFF: 'A reprogramação pelo próprio passageiro está desativada.',
  REBOOK_NOT_YOUR_TICKET: 'Este bilhete pertence a outro passageiro.',
  REBOOK_TICKET_NOT_ACTIVE: 'Só é possível reprogramar bilhetes ativos.',
  REBOOK_TICKET_NOT_PAID: 'Só é possível reprogramar bilhetes com pagamento confirmado.',
  REBOOK_ALREADY_BOARDED: 'O passageiro já embarcou — não é possível reprogramar.',
  REBOOK_PAYMENT_PENDING: 'Já existe uma reprogramação à espera de pagamento para este bilhete.',
  REBOOK_LIMIT_REACHED: 'Este bilhete atingiu o limite de reprogramações.',
  REBOOK_TRIP_DEPARTED: 'A viagem original já partiu.',
  REBOOK_NO_SHOW_WINDOW_PASSED: 'Passou o prazo para reprogramar depois da partida.',
  REBOOK_NEW_TRIP_NOT_FOUND: 'Viagem de destino não encontrada.',
  REBOOK_SAME_TRIP_AND_SEAT: 'O bilhete já está nesta viagem e neste assento.',
  REBOOK_NEW_TRIP_UNAVAILABLE: 'A viagem de destino não está disponível.',
  REBOOK_NEW_TRIP_TOO_SOON: 'A viagem de destino parte demasiado cedo.',
  REBOOK_NEW_TRIP_TOO_FAR: 'A viagem de destino está demasiado longe no tempo.',
  REBOOK_OTHER_COMPANY: 'A viagem de destino é de outra empresa.',
  REBOOK_DIFFERENT_ROUTE: 'A viagem de destino tem origem ou destino diferente.',
  REBOOK_BAD_SEAT: 'Assento inválido para este autocarro.',
  REBOOK_SEAT_TAKEN: 'Esse assento já está ocupado.',
  REBOOK_SEAT_HELD: 'Esse assento está reservado por outra compra em curso.',
  REBOOK_WAIVER_NOT_ALLOWED: 'Só um administrador pode perdoar a multa.',
  REBOOK_WAIVER_REASON_REQUIRED: 'Escreva o motivo do perdão (mínimo 10 caracteres).',
  REBOOK_BAD_PAYMENT_METHOD: 'Selecione Dinheiro ou TPA para cobrar o valor devido.',
  REBOOK_BAD_CHANNEL: 'Canal de reprogramação inválido.',
  REBOOK_IDEMPOTENCY_CONFLICT: 'Este pedido já foi usado para outra reprogramação.',
  REBOOK_NOT_APPLICABLE: 'Esta reprogramação já não pode ser aplicada.',
  REBOOK_REFERENCE_NOT_FOUND: 'Referência de reprogramação não encontrada.',
};

// Postgres sends the RAISE message back inside the PostgREST error; some codes
// (42501, 23505) also arrive with Supabase's own wrapper text around them.
export function rebookErrorMessage(error) {
  const raw = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  const code = Object.keys(REBOOK_ERRORS).find((k) => raw.includes(k));
  if (code) return { code, message: REBOOK_ERRORS[code] };
  return { code: null, message: error?.message || 'Erro ao reprogramar bilhete.' };
}

// HTTP status that matches the refusal, so the sheet can tell "not allowed"
// from "try another seat".
export function rebookErrorStatus(code) {
  if (!code) return 500;
  if (['REBOOK_NOT_STAFF', 'REBOOK_NOT_ADMIN', 'REBOOK_WAIVER_NOT_ALLOWED', 'REBOOK_NOT_YOUR_TICKET'].includes(code)) return 403;
  if (['REBOOK_TICKET_NOT_FOUND', 'REBOOK_NEW_TRIP_NOT_FOUND', 'REBOOK_REFERENCE_NOT_FOUND'].includes(code)) return 404;
  if (['REBOOK_BAD_SEAT', 'REBOOK_BAD_PAYMENT_METHOD', 'REBOOK_BAD_CHANNEL', 'REBOOK_WAIVER_REASON_REQUIRED'].includes(code)) return 400;
  return 409;
}

// One quote row -> the numbers the sheet shows. Amounts are Kz.
export function describeQuote(q) {
  if (!q) return null;
  return {
    isFree: q.is_free === true && Number(q.fee_kz) === 0,
    rebooksUsed: q.rebooks_used,
    rebooksAllowed: q.rebooks_allowed,
    farePaidKz: Number(q.fare_paid_kz) || 0,
    newFareKz: Number(q.new_fare_kz) || 0,
    feePercent: Number(q.fee_percent) || 0,
    feeKz: Number(q.fee_kz) || 0,
    fareDifferenceKz: Number(q.fare_difference_kz) || 0,
    totalKz: Number(q.total_kz) || 0,
    waived: q.waived === true,
  };
}
