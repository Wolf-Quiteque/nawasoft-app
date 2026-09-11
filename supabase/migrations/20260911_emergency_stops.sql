-- NAWASOFT emergency stop: an audited kill switch that deactivates every
-- currently-active bus (so no channel can sell a seat on them) and remembers
-- exactly which buses were on, so "resume sales" restores precisely those —
-- not every bus in the fleet, including ones that were already off.
CREATE TABLE IF NOT EXISTS public.emergency_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_ids uuid[] NOT NULL,
  reason text,
  activated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_stops_open
  ON public.emergency_stops(activated_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.emergency_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view emergency stops" ON public.emergency_stops;
CREATE POLICY "Admins can view emergency stops"
  ON public.emergency_stops
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'agent'))
  );

COMMENT ON TABLE public.emergency_stops IS
  'Audit trail for the NAWASOFT kill switch: which buses were taken off sale, by whom, and when sales resumed.';
