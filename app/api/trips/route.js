import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { todayInLuanda } from '@/lib/format';
import { loadTrips, isValidTripDate } from '@/lib/queries/trips';

// GET /api/trips?date=YYYY-MM-DD (defaults to today in Africa/Luanda)
export async function GET(request) {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || todayInLuanda();
  if (!isValidTripDate(date)) {
    return NextResponse.json({ error: 'Data inválida.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await loadTrips(date));
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Falha ao carregar viagens' }, { status: 500 });
  }
}
