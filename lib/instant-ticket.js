import { isSellableSeat, sellableSeatCount } from '@/lib/seats';
import { runOccupancy } from '@/lib/trip-run-detail';
import { seatIsTaken, recomputeSiblingsAvailableSeats } from '@/lib/ticket-rebooking';

/**
 * Cash and TPA settle at the counter, so those land as `paid` at once.
 * `referencia` is the third way to sell: the seats are reserved straight away
 * and the passenger pays a Multicaixa reference afterwards. Those tickets sit
 * `pending` until the payment webhook confirms them, and their download page
 * refuses to render until then — which is the point, nobody prints a ticket
 * that was not paid.
 */
export const INSTANT_PAYMENT_METHODS = ['cash', 'tpa', 'referencia'];

/** Where references are created. The same service the website pays through. */
const PAYMENT_API_URL = process.env.PAYMENT_API_URL
  || 'https://payments-nawabus.vercel.app/api/create-payment';

/**
 * Asks the payment service for one Multicaixa reference covering the whole
 * batch. It creates the reference at ProxyPay and the pending payment row the
 * webhook later completes, so a counter reference behaves exactly like a
 * reference bought on the website.
 */
async function createPaymentReference({ ticketId, amountKz, passengerName, phone }) {
  let res;
  try {
    res = await fetch(PAYMENT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id: ticketId,
        amount: amountKz,
        passenger_name: passengerName || 'Passageiro',
        passenger_email: phone ? `${phone}@nawabus.com` : '',
      }),
    });
  } catch (err) {
    fail(502, `Não foi possível contactar o serviço de pagamentos: ${err.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.reference_id) {
    fail(502, body?.error || 'Não foi possível gerar a referência de pagamento.');
  }
  return { reference: String(body.reference_id), expiresAt: body.hold_expires_at || null };
}

/** Guards a fat-fingered paste; the largest bus in the fleet seats 53. */
export const MAX_BATCH_PASSENGERS = 60;

const LIVE_TRIP_STATUSES = ['scheduled', 'boarding'];

// Shared with the ticket screens, which offer the same link for a ticket
// found by reference, name or phone.
import { ticketDownloadUrl } from '@/lib/ticket-download';
export { ticketDownloadUrl };

/**
 * Angolan mobile numbers are stored with the 244 country code. Mirrors the
 * normaliser in agent-web-app's create-passenger route so a passenger booked
 * from either app resolves to the same profile.
 */
export function normalizePhone(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/\D/g, '');
  if (!cleaned) return null;
  if (!cleaned.startsWith('244') && cleaned.length === 9 && cleaned.startsWith('9')) {
    return `244${cleaned}`;
  }
  return cleaned;
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

const sameName = (a, b) =>
  String(a || '').trim().toLocaleLowerCase('pt') === String(b || '').trim().toLocaleLowerCase('pt');

/** Short, URL-safe, and visibly not a ProxyPay reference (those are numeric). */
function newTransactionId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NSF-${stamp}-${rand}`;
}

class IssueError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => {
  throw new IssueError(status, message, code);
};

/**
 * Finds the passenger profile to hang a ticket on, or makes one.
 *
 * Matching needs both the phone and the name. A phone alone is not an identity
 * here: a family travelling on one contact number is the normal case, and
 * matching on the number alone would file all twelve of them under whoever was
 * entered first, losing eleven people's BI numbers and travel history.
 */
async function resolvePassenger(supabase, { name, phone, nationalId }) {
  const parts = splitName(name);
  if (!parts) fail(400, 'Indique o nome do passageiro.');

  if (phone) {
    const { data: candidates, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, phone_number, national_id')
      .eq('phone_number', phone)
      .eq('role', 'passenger')
      .limit(20);
    if (error) throw error;

    const existing = (candidates || []).find((c) =>
      sameName(`${c.first_name || ''} ${c.last_name || ''}`, name)
    );
    if (existing) {
      // Fill in a BI we did not have before, but never overwrite one on file.
      if (nationalId && !existing.national_id) {
        await supabase.from('profiles').update({ national_id: nationalId }).eq('id', existing.id);
      }
      return { ...existing, created: false };
    }
  }

  // The profiles row is created by a trigger on auth.users, and it reads the
  // role straight out of user_metadata — omit it and the passenger is filed as
  // staff. The e-mail is a placeholder; these accounts are never signed into.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: `passageiro+${phone || 'sem-contacto'}-${crypto.randomUUID()}@temp.local`,
    email_confirm: true,
    user_metadata: { role: 'passenger', ...parts, phone_number: phone || null },
  });
  if (createError) throw createError;

  const id = created.user.id;
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ ...parts, phone_number: phone || null, national_id: nationalId || null })
    .eq('id', id);
  if (profileError) throw profileError;

  return { id, ...parts, phone_number: phone || null, national_id: nationalId || null, created: true };
}

/**
 * Prices one seat. Without a code the passenger pays the fare on the trip;
 * with one, the database is the single source of truth for what the code is
 * worth — it validates the code and computes the discount and any affiliate
 * commission in one go.
 */
async function priceSeat(supabase, { code, baseFare, passengerId }) {
  if (!code) {
    return {
      amount_due_kz: baseFare,
      passenger_discount_kz: 0,
      commission_amount_kz: 0,
      promotion_code_id: null,
      normalized_code: null,
    };
  }

  const { data, error } = await supabase.rpc('resolve_promotion_for_ticket', {
    p_code: code,
    p_base_fare_kz: baseFare,
    p_passenger_id: passengerId,
  });
  if (error) {
    // 22023 is the RPC's own "invalid or inactive code" — a user error, not a fault.
    fail(error.code === '22023' ? 400 : 500, error.message || 'Código promocional inválido.');
  }
  const quote = Array.isArray(data) ? data[0] : data;
  if (!quote) fail(400, 'Código promocional inválido.');
  return quote;
}

/** Normalises either shape of request into one list of passengers. */
function readPassengers(input) {
  if (Array.isArray(input?.passengers) && input.passengers.length) return input.passengers;
  // Single-passenger shape, kept so one caller can do either.
  return [
    {
      name: input?.passenger_name,
      national_id: input?.national_id,
      seat_number: input?.seat_number,
    },
  ];
}

/**
 * Issues one or more paid tickets on the spot, all sharing a single payment
 * reference so the whole group downloads from one link — the ticket page
 * renders every ticket on that reference as one multi-page PDF.
 *
 * Everything the passenger-facing page needs is written here: the tickets, the
 * name to print on each, and a completed payment row. It refuses to render
 * without all three, so a partial write is rolled back rather than left as a
 * seat sold against a ticket nobody can print.
 */
export async function issueInstantTickets(supabase, input, staffUserId) {
  const {
    trip_id,
    contact_phone,
    passenger_phone,
    promotion_code,
    payment_method = 'cash',
    override_sales_limit = false,
  } = input || {};

  if (!trip_id) fail(400, 'Selecione o percurso.');
  if (!INSTANT_PAYMENT_METHODS.includes(payment_method)) {
    fail(400, 'Método de pagamento inválido. Use Dinheiro, TPA ou Referência.');
  }
  // Paid at the counter, or reserved now and paid by Multicaixa reference.
  const byReference = payment_method === 'referencia';

  const requested = readPassengers(input);
  if (!requested.length) fail(400, 'Indique pelo menos um passageiro.');
  if (requested.length > MAX_BATCH_PASSENGERS) {
    fail(400, `Máximo de ${MAX_BATCH_PASSENGERS} passageiros por emissão.`);
  }

  const rows = requested.map((p, i) => {
    const name = String(p?.name || '').trim();
    const seat = Number(p?.seat_number);
    if (!name) fail(400, `Indique o nome do passageiro ${i + 1}.`);
    if (!Number.isInteger(seat)) fail(400, `Selecione um assento para ${name}.`);
    return { name, seat, national_id: String(p?.national_id || '').trim() || null };
  });

  const seatNumbers = rows.map((r) => r.seat);
  if (new Set(seatNumbers).size !== seatNumbers.length) {
    fail(400, 'O mesmo assento foi atribuído a mais do que um passageiro.');
  }

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, status, price_usd, seat_class, bus_id, departure_time, bus:buses(capacity, is_active)')
    .eq('id', trip_id)
    .maybeSingle();
  if (tripError) throw tripError;
  if (!trip) fail(404, 'Viagem não encontrada.');
  if (!LIVE_TRIP_STATUSES.includes(trip.status)) fail(409, 'Esta viagem não está disponível para venda.');
  if (trip.bus?.is_active === false) fail(409, 'O autocarro desta viagem está inativo.');

  const capacity = trip.bus?.capacity || 0;
  for (const row of rows) {
    if (!isSellableSeat(row.seat, capacity)) {
      fail(400, `Assento ${row.seat} não é válido para este autocarro (capacidade ${capacity}).`);
    }
    if (await seatIsTaken(supabase, trip_id, row.seat, null)) {
      fail(409, `O assento ${row.seat} já está ocupado nesta viagem.`);
    }
  }

  // Seats may be physically free while the run is held below capacity by a
  // sales limit. Raising it is a commercial decision, so it needs a yes.
  const occupancy = await runOccupancy(supabase, trip_id);
  if (occupancy.remaining < rows.length) {
    const physical = sellableSeatCount(capacity);
    if (occupancy.occupied + rows.length > physical) {
      fail(409, `O autocarro não tem ${rows.length} lugares livres.`);
    }
    if (!override_sales_limit) {
      fail(
        409,
        `A viagem atingiu o limite de vendas (${occupancy.capacity}). Confirme para aumentar o limite e emitir ${
          rows.length > 1 ? `${rows.length} bilhetes` : 'o bilhete'
        }.`,
        'sales_limit_reached'
      );
    }
    const { error: limitError } = await supabase.rpc('set_trip_sales_capacity_limit', {
      p_trip_id: trip_id,
      p_limit: occupancy.occupied + rows.length,
    });
    if (limitError) fail(500, limitError.message || 'Falha ao aumentar o limite de vendas.');
  }

  const phone = normalizePhone(contact_phone ?? passenger_phone);
  const baseFare = Number(trip.price_usd) || 0;
  const code = String(promotion_code || '').trim().toUpperCase() || null;
  const transactionId = newTransactionId();

  const createdTicketIds = [];
  const createdProfileIds = [];
  let referencePayment = null;
  const issued = [];
  let totalDue = 0;
  let totalBase = 0;
  let totalDiscount = 0;
  let totalCommission = 0;

  try {
    for (const row of rows) {
      const passenger = await resolvePassenger(supabase, {
        name: row.name,
        phone,
        nationalId: row.national_id,
      });
      if (passenger.created) createdProfileIds.push(passenger.id);

      const quote = await priceSeat(supabase, { code, baseFare, passengerId: passenger.id });
      const amountDue = Number(quote.amount_due_kz ?? baseFare);
      const discount = Number(quote.passenger_discount_kz || 0);
      const commission = Number(quote.commission_amount_kz || 0);

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          trip_id,
          passenger_id: passenger.id,
          booked_by: staffUserId,
          // A counter sale, not a web sale — keeps these out of the online figures.
          booking_source: 'agent',
          seat_class: trip.seat_class || 'economy',
          seat_number: row.seat,
          price_paid_usd: amountDue,
          payment_status: byReference ? 'pending' : 'paid',
          payment_method,
          payment_reference: transactionId,
          promotion_code_id: quote.promotion_code_id || null,
          promotion_code_snapshot: quote.normalized_code || null,
          base_fare_kz: baseFare,
          passenger_discount_kz: discount,
          affiliate_commission_kz: commission,
          attribution_source: quote.promotion_code_id ? 'nawasoft_counter' : null,
        })
        .select()
        .single();

      if (ticketError) {
        if (ticketError.code === '23505' || /seat|assento/i.test(ticketError.message || '')) {
          fail(409, `O assento ${row.seat} já está ocupado nesta viagem.`);
        }
        throw ticketError;
      }
      createdTicketIds.push(ticket.id);

      const { error: companionError } = await supabase
        .from('ticket_companions')
        .insert({ ticket_id: ticket.id, name: row.name, phone });
      if (companionError) throw companionError;

      totalDue += amountDue;
      totalBase += baseFare;
      totalDiscount += discount;
      totalCommission += commission;
      issued.push({
        ticket_id: ticket.id,
        ticket_number: ticket.ticket_number,
        seat_number: ticket.seat_number,
        name: row.name,
        national_id: row.national_id,
        amount_due_kz: amountDue,
        passenger_id: passenger.id,
      });
    }

    if (byReference) {
      // One Multicaixa reference for the whole batch. The payment service
      // creates it and the pending payment row; when it is paid, the webhook
      // marks every ticket carrying that reference as paid.
      referencePayment = await createPaymentReference({
        ticketId: createdTicketIds[0],
        amountKz: totalDue,
        passengerName: issued[0]?.name,
        phone,
      });
      const { error: refError } = await supabase
        .from('tickets')
        .update({ payment_reference: referencePayment.reference })
        .in('id', createdTicketIds);
      if (refError) throw refError;
    } else {
    // One payment row for the whole group: the ticket page looks the reference
    // up here first and refuses to render unless it is completed.
    const { error: paymentError } = await supabase.from('payment_transactions').insert({
      ticket_id: createdTicketIds[0],
      amount_usd: totalDue,
      currency: 'USD',
      payment_method,
      transaction_id: transactionId,
      status: 'completed',
      promotion_code_id: issued[0]?.promotion_code_id || null,
      base_amount_kz: totalBase,
      discount_amount_kz: totalDiscount,
      affiliate_commission_kz: totalCommission,
      attribution_source: code ? 'nawasoft_counter' : null,
    });
    if (paymentError) throw paymentError;
    }
  } catch (err) {
    // Unwind in reverse: the tickets and their names first, then any profile
    // this call brought into existence, so a failed batch leaves no trace.
    for (const id of createdTicketIds) {
      await supabase.from('ticket_companions').delete().eq('ticket_id', id);
      await supabase.from('tickets').delete().eq('id', id);
    }
    await supabase.from('payment_transactions').delete().eq('transaction_id', transactionId);
    if (referencePayment) {
      // The reference itself is left to expire on its own — this app holds no
      // ProxyPay key — but nothing points at it any more.
      await supabase.from('payment_transactions').delete().eq('transaction_id', referencePayment.reference);
    }
    for (const id of createdProfileIds) {
      // Profile first — auth.users is the parent of the FK, not the child.
      await supabase.from('profiles').delete().eq('id', id);
      await supabase.auth.admin.deleteUser(id).catch(() => {});
    }
    throw err;
  }

  await recomputeSiblingsAvailableSeats(supabase, trip_id, trip.bus_id, trip.departure_time);

  const groupReference = referencePayment?.reference || transactionId;

  return {
    transaction_id: groupReference,
    payment_method,
    payment_status: byReference ? 'pending' : 'paid',
    reference: referencePayment?.reference || null,
    reference_expires_at: referencePayment?.expiresAt || null,
    download_url: ticketDownloadUrl(groupReference),
    count: issued.length,
    total_due_kz: totalDue,
    total_base_kz: totalBase,
    total_discount_kz: totalDiscount,
    promotion_code: code,
    contact_phone: phone,
    tickets: issued,
  };
}

export { IssueError };
