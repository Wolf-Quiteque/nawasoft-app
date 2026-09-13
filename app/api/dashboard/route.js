import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { loadDashboard } from '@/lib/queries/dashboard';

export async function GET() {
  const auth = await requireStaff();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await loadDashboard());
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Falha ao carregar o painel' }, { status: 500 });
  }
}
