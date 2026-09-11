import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { todayInLuanda } from '@/lib/format';
import { runOccupancy } from '@/lib/trip-run-detail';

// GET ?date=YYYY-MM-DD — candidate trips on the ticket's own route for the
// staff member to move this ticket onto.
export async function GET(request, { params }) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || todayInLuanda();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Data inválida.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id, trip_id, trip:trips!inner(route_id, route:routes(origin_city, destination_city))')
    .eq('id', id)
    .maybeSingle();
  if (ticketError) return NextResponse.json({ error: ticketError.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Bilhete não encontrado.' }, { status: 404 });

  const routeId = ticket.trip?.route_id;
  const dayStart = new Date(`${date}T00:00:00+01:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+01:00`).toISOString();

  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select('id, departure_time, arrival_time, bus:buses(license_plate, capacity)')
    .eq('route_id', routeId)
    .eq('status', 'scheduled')
    .gte('departure_time', dayStart)
    .lte('departure_time', dayEnd)
    .order('departure_time');
  if (tripsError) return NextResponse.json({ error: tripsError.message }, { status: 500 });

  try {
    // Free seats are counted across the whole bus run, since passengers
    // boarding at other terminals take seats from the same coach.
    const occupancies = await Promise.all((trips || []).map((t) => runOccupancy(supabase, t.id)));

    const options = (trips || []).map((t, i) => ({
      trip_id: t.id,
      departure_time: t.departure_time,
      arrival_time: t.arrival_time,
      bus_plate: t.bus?.license_plate,
      capacity: occupancies[i].capacity,
      sold: occupancies[i].occupied,
      remaining: occupancies[i].remaining,
      is_current: t.id === ticket.trip_id,
    }));

    return NextResponse.json({ date, route: ticket.trip?.route, options });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
