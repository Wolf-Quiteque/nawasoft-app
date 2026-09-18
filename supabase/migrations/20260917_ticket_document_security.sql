-- Preserve exactly what each ticket showed when issued/reissued, audit later
-- mutations, and record access to passenger ticket documents.

CREATE TABLE IF NOT EXISTS public.ticket_itinerary_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  ticket_number text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'purchase', 'backfill', 'ticket_rebook', 'seat_change',
    'trip_schedule_change', 'trip_bus_change', 'trip_route_change', 'trip_update'
  )),
  source_trip_id uuid NOT NULL,
  route_id uuid NOT NULL,
  origin_city text NOT NULL,
  origin_province text,
  destination_city text NOT NULL,
  destination_province text,
  departure_time timestamptz NOT NULL,
  arrival_time timestamptz NOT NULL,
  bus_id uuid NOT NULL,
  bus_license_plate text NOT NULL,
  bus_make text,
  bus_model text,
  seat_number integer NOT NULL,
  seat_class text NOT NULL,
  ticket_booking_time timestamptz,
  is_historical_backfill boolean NOT NULL DEFAULT false,
  actor_user_id uuid,
  actor_role text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ticket_itinerary_revisions_ticket
  ON public.ticket_itinerary_revisions(ticket_id, recorded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_itinerary_revisions_trip
  ON public.ticket_itinerary_revisions(source_trip_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.operational_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('ticket', 'trip', 'payment_transaction')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  ticket_id uuid,
  trip_id uuid,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  old_values jsonb,
  new_values jsonb,
  actor_user_id uuid,
  actor_role text,
  request_id text,
  database_role text NOT NULL DEFAULT current_user,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_operational_audit_entity
  ON public.operational_audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_audit_ticket
  ON public.operational_audit_log(ticket_id, occurred_at DESC)
  WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operational_audit_trip
  ON public.operational_audit_log(trip_id, occurred_at DESC)
  WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticket_document_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_reference text,
  ticket_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  outcome text NOT NULL CHECK (outcome IN (
    'authorized', 'blocked_refunded', 'blocked_cancelled',
    'blocked_unpaid', 'payment_incomplete', 'not_found', 'invalid_reference', 'error'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  user_agent text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_ticket_document_access_reference
  ON public.ticket_document_access_log(payment_reference, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_document_access_ip
  ON public.ticket_document_access_log(ip_hash, requested_at DESC)
  WHERE ip_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_actor_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claims text;
  v_subject text;
  v_headers text;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  IF v_claims IS NOT NULL THEN v_subject := (v_claims::jsonb ->> 'sub'); END IF;
  IF v_subject IS NULL OR v_subject = '' THEN
    v_headers := nullif(current_setting('request.headers', true), '');
    IF v_headers IS NOT NULL THEN v_subject := v_headers::jsonb ->> 'x-nawabus-actor-id'; END IF;
  END IF;
  IF v_subject IS NULL OR v_subject = '' THEN RETURN NULL; END IF;
  RETURN v_subject::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_actor_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claims text;
  v_headers text;
  v_role text;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '');
  IF v_claims IS NOT NULL THEN v_role := v_claims::jsonb ->> 'role'; END IF;
  IF v_role IS NULL OR v_role = '' OR v_role = 'service_role' THEN
    v_headers := nullif(current_setting('request.headers', true), '');
    IF v_headers IS NOT NULL THEN v_role := v_headers::jsonb ->> 'x-nawabus-actor-role'; END IF;
  END IF;
  RETURN coalesce(nullif(v_role, ''), current_user);
EXCEPTION WHEN OTHERS THEN
  RETURN current_user;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_request_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_headers text;
BEGIN
  v_headers := nullif(current_setting('request.headers', true), '');
  IF v_headers IS NULL THEN RETURN NULL; END IF;
  RETURN coalesce(v_headers::jsonb ->> 'x-request-id', v_headers::jsonb ->> 'cf-ray');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_ticket_itinerary_revision(
  p_ticket_id uuid,
  p_event_type text,
  p_is_historical_backfill boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.ticket_itinerary_revisions (
    ticket_id, ticket_number, event_type, source_trip_id, route_id,
    origin_city, origin_province, destination_city, destination_province,
    departure_time, arrival_time, bus_id, bus_license_plate, bus_make, bus_model,
    seat_number, seat_class, ticket_booking_time, is_historical_backfill,
    actor_user_id, actor_role
  )
  SELECT
    ticket.id, ticket.ticket_number, p_event_type, trip.id, route.id,
    route.origin_city, route.origin_province, route.destination_city, route.destination_province,
    trip.departure_time, trip.arrival_time, bus.id, bus.license_plate, bus.make, bus.model,
    ticket.seat_number, ticket.seat_class, coalesce(ticket.booking_time, ticket.created_at),
    p_is_historical_backfill, public.audit_actor_user_id(), public.audit_actor_role()
  FROM public.tickets ticket
  JOIN public.trips trip ON trip.id = ticket.trip_id
  JOIN public.routes route ON route.id = trip.route_id
  JOIN public.buses bus ON bus.id = trip.bus_id
  WHERE ticket.id = p_ticket_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_ticket_revision_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.capture_ticket_itinerary_revision(NEW.id, 'purchase', false);
  ELSIF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN
    PERFORM public.capture_ticket_itinerary_revision(NEW.id, 'ticket_rebook', false);
  ELSIF NEW.seat_number IS DISTINCT FROM OLD.seat_number OR NEW.seat_class IS DISTINCT FROM OLD.seat_class THEN
    PERFORM public.capture_ticket_itinerary_revision(NEW.id, 'seat_change', false);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_trip_ticket_revisions_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event_type text;
  v_ticket record;
BEGIN
  IF NEW.departure_time IS NOT DISTINCT FROM OLD.departure_time
     AND NEW.arrival_time IS NOT DISTINCT FROM OLD.arrival_time
     AND NEW.bus_id IS NOT DISTINCT FROM OLD.bus_id
     AND NEW.route_id IS NOT DISTINCT FROM OLD.route_id THEN
    RETURN NEW;
  END IF;

  v_event_type := CASE
    WHEN (NEW.departure_time IS DISTINCT FROM OLD.departure_time OR NEW.arrival_time IS DISTINCT FROM OLD.arrival_time)
         AND NEW.bus_id IS NOT DISTINCT FROM OLD.bus_id
         AND NEW.route_id IS NOT DISTINCT FROM OLD.route_id THEN 'trip_schedule_change'
    WHEN NEW.bus_id IS DISTINCT FROM OLD.bus_id
         AND NEW.departure_time IS NOT DISTINCT FROM OLD.departure_time
         AND NEW.arrival_time IS NOT DISTINCT FROM OLD.arrival_time
         AND NEW.route_id IS NOT DISTINCT FROM OLD.route_id THEN 'trip_bus_change'
    WHEN NEW.route_id IS DISTINCT FROM OLD.route_id
         AND NEW.departure_time IS NOT DISTINCT FROM OLD.departure_time
         AND NEW.arrival_time IS NOT DISTINCT FROM OLD.arrival_time
         AND NEW.bus_id IS NOT DISTINCT FROM OLD.bus_id THEN 'trip_route_change'
    ELSE 'trip_update'
  END;

  FOR v_ticket IN SELECT id FROM public.tickets WHERE trip_id = NEW.id LOOP
    PERFORM public.capture_ticket_itinerary_revision(v_ticket.id, v_event_type, false);
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.write_operational_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_entity_id uuid;
  v_ticket_id uuid;
  v_trip_id uuid;
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(entry.key ORDER BY entry.key), ARRAY[]::text[])
      INTO v_changed
    FROM jsonb_each(v_new) entry
    WHERE v_old -> entry.key IS DISTINCT FROM entry.value;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := ARRAY['created'];
  ELSE
    v_changed := ARRAY['deleted'];
  END IF;

  IF TG_TABLE_NAME = 'tickets' THEN
    v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_ticket_id := v_entity_id;
    v_trip_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.trip_id ELSE NEW.trip_id END;
  ELSIF TG_TABLE_NAME = 'trips' THEN
    v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_trip_id := v_entity_id;
  ELSE
    v_entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_ticket_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.ticket_id ELSE NEW.ticket_id END;
    IF TG_OP <> 'DELETE' THEN
      v_new := jsonb_build_object(
        'id', NEW.id, 'ticket_id', NEW.ticket_id, 'transaction_id', NEW.transaction_id,
        'amount_usd', NEW.amount_usd, 'currency', NEW.currency,
        'payment_method', NEW.payment_method, 'status', NEW.status, 'created_at', NEW.created_at
      );
    END IF;
    IF TG_OP <> 'INSERT' THEN
      v_old := jsonb_build_object(
        'id', OLD.id, 'ticket_id', OLD.ticket_id, 'transaction_id', OLD.transaction_id,
        'amount_usd', OLD.amount_usd, 'currency', OLD.currency,
        'payment_method', OLD.payment_method, 'status', OLD.status, 'created_at', OLD.created_at
      );
    END IF;
  END IF;

  INSERT INTO public.operational_audit_log (
    entity_type, entity_id, action, ticket_id, trip_id, changed_fields,
    old_values, new_values, actor_user_id, actor_role, request_id
  ) VALUES (
    CASE TG_TABLE_NAME WHEN 'tickets' THEN 'ticket' WHEN 'trips' THEN 'trip' ELSE 'payment_transaction' END,
    v_entity_id, TG_OP, v_ticket_id, v_trip_id, v_changed,
    v_old, v_new, public.audit_actor_user_id(), public.audit_actor_role(), public.audit_request_id()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$function$;

-- Existing tickets cannot be reconstructed historically. Mark their first
-- revision explicitly as a backfill so staff never mistake it for proof of the
-- exact itinerary displayed before this migration.
INSERT INTO public.ticket_itinerary_revisions (
  ticket_id, ticket_number, event_type, source_trip_id, route_id,
  origin_city, origin_province, destination_city, destination_province,
  departure_time, arrival_time, bus_id, bus_license_plate, bus_make, bus_model,
  seat_number, seat_class, ticket_booking_time, is_historical_backfill,
  actor_role
)
SELECT
  ticket.id, ticket.ticket_number, 'backfill', trip.id, route.id,
  route.origin_city, route.origin_province, route.destination_city, route.destination_province,
  trip.departure_time, trip.arrival_time, bus.id, bus.license_plate, bus.make, bus.model,
  ticket.seat_number, ticket.seat_class, coalesce(ticket.booking_time, ticket.created_at), true,
  'migration'
FROM public.tickets ticket
JOIN public.trips trip ON trip.id = ticket.trip_id
JOIN public.routes route ON route.id = trip.route_id
JOIN public.buses bus ON bus.id = trip.bus_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.ticket_itinerary_revisions revision WHERE revision.ticket_id = ticket.id
);

DROP TRIGGER IF EXISTS capture_ticket_itinerary_revision ON public.tickets;
CREATE TRIGGER capture_ticket_itinerary_revision
AFTER INSERT OR UPDATE OF trip_id, seat_number, seat_class ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.capture_ticket_revision_trigger();

DROP TRIGGER IF EXISTS capture_trip_ticket_itinerary_revisions ON public.trips;
CREATE TRIGGER capture_trip_ticket_itinerary_revisions
AFTER UPDATE OF departure_time, arrival_time, bus_id, route_id ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.capture_trip_ticket_revisions_trigger();

DROP TRIGGER IF EXISTS audit_ticket_changes ON public.tickets;
CREATE TRIGGER audit_ticket_changes
AFTER INSERT OR UPDATE OR DELETE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.write_operational_audit_trigger();

DROP TRIGGER IF EXISTS audit_trip_changes ON public.trips;
CREATE TRIGGER audit_trip_changes
AFTER INSERT OR UPDATE OR DELETE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.write_operational_audit_trigger();

DROP TRIGGER IF EXISTS audit_payment_transaction_changes ON public.payment_transactions;
CREATE TRIGGER audit_payment_transaction_changes
AFTER INSERT OR UPDATE OR DELETE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.write_operational_audit_trigger();

DROP TRIGGER IF EXISTS protect_ticket_itinerary_revisions ON public.ticket_itinerary_revisions;
CREATE TRIGGER protect_ticket_itinerary_revisions
BEFORE UPDATE OR DELETE ON public.ticket_itinerary_revisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

DROP TRIGGER IF EXISTS protect_operational_audit_log ON public.operational_audit_log;
CREATE TRIGGER protect_operational_audit_log
BEFORE UPDATE OR DELETE ON public.operational_audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

DROP TRIGGER IF EXISTS protect_ticket_document_access_log ON public.ticket_document_access_log;
CREATE TRIGGER protect_ticket_document_access_log
BEFORE UPDATE OR DELETE ON public.ticket_document_access_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

ALTER TABLE public.ticket_itinerary_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_document_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read ticket itinerary revisions" ON public.ticket_itinerary_revisions;
CREATE POLICY "Staff read ticket itinerary revisions"
  ON public.ticket_itinerary_revisions FOR SELECT
  USING (public.get_user_role() IN ('admin', 'agent'));

DROP POLICY IF EXISTS "Passengers read own ticket itinerary revisions" ON public.ticket_itinerary_revisions;
CREATE POLICY "Passengers read own ticket itinerary revisions"
  ON public.ticket_itinerary_revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets ticket
      WHERE ticket.id = ticket_itinerary_revisions.ticket_id
        AND (ticket.passenger_id = auth.uid() OR ticket.booked_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Staff read operational audit log" ON public.operational_audit_log;
CREATE POLICY "Staff read operational audit log"
  ON public.operational_audit_log FOR SELECT
  USING (public.get_user_role() IN ('admin', 'agent'));

DROP POLICY IF EXISTS "Staff read ticket document access log" ON public.ticket_document_access_log;
CREATE POLICY "Staff read ticket document access log"
  ON public.ticket_document_access_log FOR SELECT
  USING (public.get_user_role() IN ('admin', 'agent'));

GRANT SELECT ON public.ticket_itinerary_revisions TO authenticated;
GRANT SELECT ON public.operational_audit_log TO authenticated;
GRANT SELECT ON public.ticket_document_access_log TO authenticated;
GRANT ALL ON public.ticket_itinerary_revisions TO service_role;
GRANT ALL ON public.operational_audit_log TO service_role;
GRANT ALL ON public.ticket_document_access_log TO service_role;

REVOKE EXECUTE ON FUNCTION public.capture_ticket_itinerary_revision(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.capture_ticket_revision_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.capture_trip_ticket_revisions_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_operational_audit_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_audit_mutation() FROM PUBLIC;

COMMENT ON TABLE public.ticket_itinerary_revisions IS
  'Append-only ticket itinerary snapshots. PDFs use the latest revision; the first non-backfill revision proves the itinerary captured when the ticket was issued.';
COMMENT ON TABLE public.operational_audit_log IS
  'Append-only database audit trail for ticket, trip and payment changes.';
COMMENT ON TABLE public.ticket_document_access_log IS
  'Append-only authorization log for passenger ticket-document requests; client IPs are stored only as keyed hashes.';
