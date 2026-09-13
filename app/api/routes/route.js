import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { loadRoutes } from '@/lib/queries/routes';

export async function GET() {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await loadRoutes());
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Falha ao carregar rotas' }, { status: 500 });
  }
}
