import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { isSellableSeat } from '@/lib/seats';
import { REBOOKING_FEE_PERCENT, rebookingFeeAmount } from '@/lib/rebooking-fee';
import { seatIsTaken, recomputeSiblingsAvailableSeats } from '@/lib/ticket-rebooking';

function sendError(status, message) {
  return NextResponse.json({ error: message }, { status });
}

// POST { new_trip_id, new_seat_number, apply_rebooking_fee, rebooking_fee_payment_method }
// Moves a paid, active, not-yet-boarded ticket to a new trip/seat, optionally
// collecting the rebooking multa (currently 60% of the fare paid).
export async function POST(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: ticket_id } = await params;
  const payload = await request.json().catch(() => ({}));
  const { new_trip_id, new_seat_number, apply_rebooking_fee = false, rebooking_fee_payment_method = null } = payload;

  if (!new_trip_id || new_seat_number == null) {
    return sendError(400, 'new_trip_id e new_seat_number são obrigatórios');
  }

  const seatNum = Number(new_seat_number);
  const shouldCollectFee = apply_rebooking_fee === true;
  const allowedFeeMethods = ['cash', 'tpa'];
  if (shouldCollectFee && !allowedFeeMethods.includes(rebooking_fee_payment_method)) {
    return sendError(400, 'Selecione Dinheiro ou TPA como método de pagamento da multa');
  }

  const supabase = createSupabaseAdminClient();

  try {
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select(
        `id, trip_id, seat_number, seat_class, price_paid_usd, status, payment_status, ticket_number,
         trip:trips!inner(id, route_id, bus_id, departure_time, seat_class, route:routes!inner(origin_city, destination_city))`
      )
      .eq('id', ticket_id)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) return sendError(404, 'Bilhete não encontrado');

    if (ticket.status !== 'active') return sendError(409, 'Só é possível reprogramar bilhetes ativos');
    if (ticket.payment_status !== 'paid') return sendError(409, 'Só é possível reprogramar bilhetes com pagamento confirmado');

    const { data: scans, error: scanError } = await supabase
      .from('ticket_scans')
      .select('id')
      .eq('ticket_id', ticket_id)
      .eq('scan_type', 'boarding');
    if (scanError) throw scanError;
    if (scans && scans.length > 0) return sendError(409, 'Bilhete já embarcou — não é possível reprogramar');

    const oldTripId = ticket.trip_id;
    const oldBusId = ticket.trip?.bus_id;
    const oldDepartureTime = ticket.trip?.departure_time;

    const { data: newTrip, error: tripError } = await supabase
      .from('trips')
      .select('id, route_id, bus_id, departure_time, seat_class, status')
      .eq('id', new_trip_id)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!newTrip) return sendError(404, 'Viagem de destino não encontrada');
    if (newTrip.status !== 'scheduled') return sendError(409, 'A viagem de destino não está programada');

    const { data: newBus, error: busError } = await supabase
      .from('buses')
      .select('capacity')
      .eq('id', newTrip.bus_id)
      .maybeSingle();
    if (busError) throw busError;
    const newCapacity = newBus?.capacity || 0;
    if (!isSellableSeat(seatNum, newCapacity)) {
      return sendError(400, `Assento ${seatNum} não é válido para este autocarro (capacidade ${newCapacity})`);
    }

    const conflict = await seatIsTaken(supabase, new_trip_id, seatNum, ticket_id);
    if (conflict) return sendError(409, `O assento ${seatNum} já está ocupado nesta viagem`);

    const { data: moved, error: moveError } = await supabase
      .from('tickets')
      .update({ trip_id: new_trip_id, seat_number: seatNum, seat_class: newTrip.seat_class || ticket.seat_class })
      .eq('id', ticket_id)
      .select()
      .maybeSingle();
    if (moveError) {
      if (moveError.message?.includes('already booked') || moveError.code === '23505') {
        return sendError(409, `O assento ${seatNum} já está ocupado nesta viagem`);
      }
      throw moveError;
    }

    let rebookingFee = null;
    if (shouldCollectFee) {
      const baseAmount = Number(ticket.price_paid_usd) || 0;
      const feeAmount = rebookingFeeAmount(baseAmount);
      const { data: fee, error: feeError } = await supabase
        .from('ticket_rebooking_fees')
        .insert({
          ticket_id,
          old_trip_id: oldTripId,
          new_trip_id,
          percentage: REBOOKING_FEE_PERCENT,
          base_amount_kz: baseAmount,
          amount_kz: feeAmount,
          payment_method: rebooking_fee_payment_method,
          collected_by: auth.user.id,
        })
        .select()
        .single();

      if (feeError) {
        await supabase
          .from('tickets')
          .update({ trip_id: oldTripId, seat_number: ticket.seat_number, seat_class: ticket.seat_class })
          .eq('id', ticket_id);
        throw feeError;
      }
      rebookingFee = fee;
    }

    if (oldTripId && oldBusId && oldDepartureTime) {
      await recomputeSiblingsAvailableSeats(supabase, oldTripId, oldBusId, oldDepartureTime);
    }

    return NextResponse.json({
      message: shouldCollectFee
        ? `Bilhete reprogramado e multa de ${REBOOKING_FEE_PERCENT}% registada com sucesso.`
        : 'Bilhete reprogramado com sucesso. O assento anterior foi libertado.',
      ticket: moved,
      rebooking_fee: rebookingFee,
    });
  } catch (err) {
    return sendError(500, err.message || 'Erro ao reprogramar bilhete');
  }
}
