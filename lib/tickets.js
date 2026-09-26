export const TICKET_SELECT = `
  id, ticket_number, seat_number, seat_class, price_paid_usd, status, payment_status,
  payment_method, payment_reference, booking_source, booking_time, created_at, passenger_id,
  rebooking_fees:ticket_rebooking_fees(id, percentage, base_amount_kz, amount_kz, payment_method, collected_at),
  trip:trips!inner(
    id, route_id, bus_id, departure_time, arrival_time, status,
    route:routes!inner(id, origin_city, origin_province, destination_city, destination_province),
    bus:buses!inner(id, license_plate, capacity, make, model)
  )
`;

export async function attachPassengers(supabase, tickets) {
  const pids = [...new Set(tickets.map((t) => t.passenger_id).filter(Boolean))];
  if (!pids.length) return tickets;
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, phone_number, national_id')
    .in('id', pids);
  const map = new Map((profiles || []).map((p) => [p.id, p]));
  return tickets.map((t) => ({ ...t, passenger: map.get(t.passenger_id) || null }));
}
