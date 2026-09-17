-- Atomic trip-management operations for NAWASOFT.
-- A physical journey can contain several overlapping route rows. Every
-- operation below locks and changes the whole journey so its shared seat pool
-- can never be left half-updated.

CREATE OR REPLACE FUNCTION public.nawasoft_lock_bus_sales(p_bus_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_capacity integer;
  v_seat integer;
BEGIN
  SELECT capacity INTO v_capacity FROM public.buses WHERE id = p_bus_id FOR UPDATE;
  IF v_capacity IS NULL THEN RAISE EXCEPTION 'Bus not found' USING ERRCODE = 'P0002'; END IF;
  -- Use the same lock order as the booking triggers: seat first, sales cap
  -- second. Holding every seat lock prevents a concurrent sale from slipping
  -- between validation and the multi-ticket move.
  FOR v_seat IN 2..v_capacity LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_bus_id::text || ':' || v_seat::text, 0));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-cap:' || p_bus_id::text, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.nawasoft_cancel_empty_run(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_ids uuid[];
  v_count integer;
BEGIN
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF v_trip.id IS NULL THEN RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002'; END IF;
  IF v_trip.status NOT IN ('scheduled', 'boarding') THEN
    RAISE EXCEPTION 'Only active journeys can be removed' USING ERRCODE = '22023';
  END IF;
  PERFORM public.nawasoft_lock_bus_sales(v_trip.bus_id);

  SELECT array_agg(id ORDER BY id) INTO v_ids
  FROM public.trips
  WHERE bus_id = v_trip.bus_id
    AND status IN ('scheduled', 'boarding')
    AND departure_time < v_trip.arrival_time
    AND v_trip.departure_time < arrival_time;

  PERFORM 1 FROM public.trips WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT count(*) INTO v_count FROM public.tickets
  WHERE trip_id = ANY(v_ids) AND status IN ('active', 'pending', 'used');
  IF v_count > 0 THEN RAISE EXCEPTION 'Journey has passengers and cannot be removed' USING ERRCODE = '23503'; END IF;

  SELECT count(*) INTO v_count FROM public.online_bookings
  WHERE trip_id = ANY(v_ids) AND expires_at > now();
  IF v_count > 0 THEN RAISE EXCEPTION 'Journey has active seat holds' USING ERRCODE = '55P03'; END IF;

  SELECT count(*) INTO v_count FROM public.cargo_shipments
  WHERE trip_id = ANY(v_ids) AND status NOT IN ('cancelled', 'delivered');
  IF v_count > 0 THEN RAISE EXCEPTION 'Journey has active cargo and cannot be removed' USING ERRCODE = '23503'; END IF;

  UPDATE public.trips SET status = 'cancelled', available_seats = 0 WHERE id = ANY(v_ids);
  RETURN jsonb_build_object('cancelled_trip_ids', v_ids, 'cancelled_routes', cardinality(v_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.nawasoft_update_run_times(p_trip_id uuid, p_legs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_ids uuid[];
  v_bus_id uuid;
  v_driver_id uuid;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_count integer;
BEGIN
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF v_trip.id IS NULL THEN RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002'; END IF;
  IF v_trip.status NOT IN ('scheduled', 'boarding') THEN
    RAISE EXCEPTION 'Only active journeys can be edited' USING ERRCODE = '22023';
  END IF;
  PERFORM public.nawasoft_lock_bus_sales(v_trip.bus_id);

  SELECT array_agg(id ORDER BY id), (array_agg(bus_id))[1], (array_agg(driver_id))[1]
    INTO v_ids, v_bus_id, v_driver_id
  FROM public.trips
  WHERE bus_id = v_trip.bus_id
    AND status IN ('scheduled', 'boarding')
    AND departure_time < v_trip.arrival_time
    AND v_trip.departure_time < arrival_time;

  IF jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Every route in the journey must be supplied exactly once' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE tmp_nawasoft_legs(
    trip_id uuid PRIMARY KEY,
    departure_time timestamptz NOT NULL,
    arrival_time timestamptz NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO tmp_nawasoft_legs
  SELECT x.trip_id, x.departure_time, x.arrival_time
  FROM jsonb_to_recordset(p_legs) AS x(trip_id uuid, departure_time timestamptz, arrival_time timestamptz);

  IF EXISTS (SELECT 1 FROM tmp_nawasoft_legs WHERE trip_id <> ALL(v_ids) OR arrival_time <= departure_time) THEN
    RAISE EXCEPTION 'Invalid journey route or time window' USING ERRCODE = '22023';
  END IF;
  SELECT min(departure_time), max(arrival_time), count(*) INTO v_new_start, v_new_end, v_count FROM tmp_nawasoft_legs;
  IF v_count <> cardinality(v_ids) OR
     (SELECT max(departure_time) FROM tmp_nawasoft_legs) >= (SELECT min(arrival_time) FROM tmp_nawasoft_legs) THEN
    RAISE EXCEPTION 'Routes must overlap to share the same bus and seats' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.trips WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.trips other
    WHERE other.id <> ALL(v_ids)
      AND other.status IN ('scheduled', 'boarding')
      AND (other.bus_id = v_bus_id OR other.driver_id = v_driver_id)
      AND other.departure_time < v_new_end AND v_new_start < other.arrival_time
  ) THEN
    RAISE EXCEPTION 'Bus or driver is already assigned during the new time' USING ERRCODE = '23P01';
  END IF;

  UPDATE public.trips trip
  SET departure_time = edit.departure_time, arrival_time = edit.arrival_time
  FROM tmp_nawasoft_legs edit
  WHERE trip.id = edit.trip_id;

  RETURN jsonb_build_object('updated_trip_ids', v_ids, 'updated_routes', cardinality(v_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.nawasoft_replace_run_bus(p_trip_id uuid, p_new_bus_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_ids uuid[];
  v_start timestamptz;
  v_end timestamptz;
  v_new_capacity integer;
  v_new_company uuid;
  v_new_active boolean;
  v_used integer[] := ARRAY[]::integer[];
  v_reserved integer[] := ARRAY[]::integer[];
  v_new_seat integer;
  v_ticket record;
  v_assignments jsonb := '[]'::jsonb;
  v_ticket_count integer;
BEGIN
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF v_trip.id IS NULL THEN RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002'; END IF;
  IF v_trip.status NOT IN ('scheduled', 'boarding') THEN RAISE EXCEPTION 'Only active journeys can change buses' USING ERRCODE = '22023'; END IF;
  IF v_trip.bus_id = p_new_bus_id THEN RAISE EXCEPTION 'Journey already uses this bus' USING ERRCODE = '22023'; END IF;
  IF v_trip.bus_id::text < p_new_bus_id::text THEN
    PERFORM public.nawasoft_lock_bus_sales(v_trip.bus_id);
    PERFORM public.nawasoft_lock_bus_sales(p_new_bus_id);
  ELSE
    PERFORM public.nawasoft_lock_bus_sales(p_new_bus_id);
    PERFORM public.nawasoft_lock_bus_sales(v_trip.bus_id);
  END IF;

  SELECT array_agg(id ORDER BY id), min(departure_time), max(arrival_time)
    INTO v_ids, v_start, v_end
  FROM public.trips
  WHERE bus_id = v_trip.bus_id AND status IN ('scheduled', 'boarding')
    AND departure_time < v_trip.arrival_time AND v_trip.departure_time < arrival_time;
  PERFORM 1 FROM public.trips WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  SELECT capacity, company_id, is_active INTO v_new_capacity, v_new_company, v_new_active
  FROM public.buses WHERE id = p_new_bus_id FOR UPDATE;
  IF v_new_capacity IS NULL THEN RAISE EXCEPTION 'Replacement bus not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT v_new_active OR v_new_company IS DISTINCT FROM v_trip.company_id THEN
    RAISE EXCEPTION 'Replacement bus must be active and belong to the same company' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trips WHERE bus_id = p_new_bus_id AND status IN ('scheduled', 'boarding') AND departure_time < v_end AND v_start < arrival_time) THEN
    RAISE EXCEPTION 'Replacement bus is occupied at this time' USING ERRCODE = '23P01';
  END IF;
  IF EXISTS (SELECT 1 FROM public.online_bookings WHERE trip_id = ANY(v_ids) AND expires_at > now()) THEN
    RAISE EXCEPTION 'Wait for active online seat holds to expire before changing buses' USING ERRCODE = '55P03';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE trip_id = ANY(v_ids) AND status = 'used') OR
     EXISTS (SELECT 1 FROM public.ticket_scans scan JOIN public.tickets ticket ON ticket.id = scan.ticket_id WHERE ticket.trip_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'Passengers have already boarded this journey' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_ticket_count FROM public.tickets WHERE trip_id = ANY(v_ids) AND status IN ('active', 'pending');
  IF v_ticket_count > GREATEST(v_new_capacity - 1, 0) THEN
    RAISE EXCEPTION 'Replacement bus does not have enough passenger seats' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT seat_number ORDER BY seat_number), ARRAY[]::integer[])
    INTO v_reserved
  FROM public.tickets
  WHERE trip_id = ANY(v_ids) AND status IN ('active', 'pending')
    AND seat_number BETWEEN 2 AND v_new_capacity;
  v_used := v_reserved;

  FOR v_ticket IN
    SELECT id, seat_number FROM public.tickets
    WHERE trip_id = ANY(v_ids) AND status IN ('active', 'pending')
    ORDER BY seat_number, created_at, id FOR UPDATE
  LOOP
    IF v_ticket.seat_number = ANY(v_reserved) THEN
      v_new_seat := v_ticket.seat_number;
    ELSE
      SELECT seat INTO v_new_seat FROM generate_series(2, v_new_capacity) seat WHERE NOT (seat = ANY(v_used)) ORDER BY seat LIMIT 1;
    END IF;
    IF v_new_seat IS NULL THEN RAISE EXCEPTION 'Replacement bus does not have enough passenger seats' USING ERRCODE = '22023'; END IF;
    IF NOT (v_new_seat = ANY(v_used)) THEN v_used := array_append(v_used, v_new_seat); END IF;
    IF v_new_seat <> v_ticket.seat_number THEN
      UPDATE public.tickets SET seat_number = v_new_seat WHERE id = v_ticket.id;
    END IF;
    v_assignments := v_assignments || jsonb_build_array(jsonb_build_object('ticket_id', v_ticket.id, 'old_seat', v_ticket.seat_number, 'new_seat', v_new_seat));
  END LOOP;

  UPDATE public.trips
  SET bus_id = p_new_bus_id,
      sales_capacity_limit = CASE WHEN sales_capacity_limit IS NULL THEN NULL ELSE LEAST(sales_capacity_limit, GREATEST(v_new_capacity - 1, 0)) END,
      available_seats = GREATEST(GREATEST(v_new_capacity - 1, 0) - v_ticket_count, 0)
  WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('updated_trip_ids', v_ids, 'passengers', v_ticket_count, 'seat_assignments', v_assignments);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nawasoft_merge_runs(p_source_trip_id uuid, p_target_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source public.trips%ROWTYPE;
  v_target public.trips%ROWTYPE;
  v_source_ids uuid[];
  v_target_ids uuid[];
  v_capacity integer;
  v_bus_capacity integer;
  v_used integer[] := ARRAY[]::integer[];
  v_reserved integer[] := ARRAY[]::integer[];
  v_new_seat integer;
  v_target_leg uuid;
  v_ticket record;
  v_total integer;
  v_moved integer := 0;
  v_assignments jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_source FROM public.trips WHERE id = p_source_trip_id FOR UPDATE;
  SELECT * INTO v_target FROM public.trips WHERE id = p_target_trip_id FOR UPDATE;
  IF v_source.id IS NULL OR v_target.id IS NULL THEN RAISE EXCEPTION 'Journey not found' USING ERRCODE = 'P0002'; END IF;
  IF v_source.bus_id = v_target.bus_id THEN RAISE EXCEPTION 'Choose a journey on another bus' USING ERRCODE = '22023'; END IF;
  IF v_source.company_id IS DISTINCT FROM v_target.company_id OR v_source.status NOT IN ('scheduled','boarding') OR v_target.status NOT IN ('scheduled','boarding') THEN
    RAISE EXCEPTION 'Journeys must be active and belong to the same company' USING ERRCODE = '22023';
  END IF;
  IF v_source.bus_id::text < v_target.bus_id::text THEN
    PERFORM public.nawasoft_lock_bus_sales(v_source.bus_id);
    PERFORM public.nawasoft_lock_bus_sales(v_target.bus_id);
  ELSE
    PERFORM public.nawasoft_lock_bus_sales(v_target.bus_id);
    PERFORM public.nawasoft_lock_bus_sales(v_source.bus_id);
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_source_ids FROM public.trips
  WHERE bus_id = v_source.bus_id AND status IN ('scheduled','boarding')
    AND departure_time < v_source.arrival_time AND v_source.departure_time < arrival_time;
  SELECT array_agg(id ORDER BY id) INTO v_target_ids FROM public.trips
  WHERE bus_id = v_target.bus_id AND status IN ('scheduled','boarding')
    AND departure_time < v_target.arrival_time AND v_target.departure_time < arrival_time;
  PERFORM 1 FROM public.trips WHERE id = ANY(v_source_ids || v_target_ids) ORDER BY id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.trips source_leg
    JOIN public.routes source_route ON source_route.id = source_leg.route_id
    WHERE source_leg.id = ANY(v_source_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.trips target_leg
        JOIN public.routes target_route ON target_route.id = target_leg.route_id
        WHERE target_leg.id = ANY(v_target_ids)
          AND lower(trim(target_route.origin_city)) = lower(trim(source_route.origin_city))
          AND lower(trim(target_route.destination_city)) = lower(trim(source_route.destination_city))
      )
  ) THEN RAISE EXCEPTION 'Target journey does not contain every route from the source journey' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.online_bookings WHERE trip_id = ANY(v_source_ids || v_target_ids) AND expires_at > now()) THEN
    RAISE EXCEPTION 'Wait for active online seat holds to expire before merging' USING ERRCODE = '55P03';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE trip_id = ANY(v_source_ids) AND status = 'used') OR
     EXISTS (SELECT 1 FROM public.ticket_scans scan JOIN public.tickets ticket ON ticket.id = scan.ticket_id WHERE ticket.trip_id = ANY(v_source_ids)) THEN
    RAISE EXCEPTION 'Passengers have already boarded the source journey' USING ERRCODE = '22023';
  END IF;

  SELECT LEAST(GREATEST(bus.capacity - 1, 0), COALESCE(min(trip.sales_capacity_limit), GREATEST(bus.capacity - 1, 0))), bus.capacity
    INTO v_capacity, v_bus_capacity FROM public.trips trip JOIN public.buses bus ON bus.id = trip.bus_id WHERE trip.id = ANY(v_target_ids) GROUP BY bus.capacity;
  SELECT count(*) INTO v_total FROM public.tickets WHERE trip_id = ANY(v_source_ids || v_target_ids) AND status IN ('active','pending','used');
  IF v_total > v_capacity THEN RAISE EXCEPTION 'Passengers from both journeys do not fit in the selected bus' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(array_agg(DISTINCT seat_number ORDER BY seat_number), ARRAY[]::integer[]) INTO v_used
  FROM public.tickets WHERE trip_id = ANY(v_target_ids) AND status IN ('active','pending','used');

  SELECT COALESCE(array_agg(DISTINCT ticket.seat_number ORDER BY ticket.seat_number), ARRAY[]::integer[])
    INTO v_reserved
  FROM public.tickets ticket
  WHERE ticket.trip_id = ANY(v_source_ids) AND ticket.status IN ('active','pending')
    AND ticket.seat_number BETWEEN 2 AND v_bus_capacity
    AND NOT (ticket.seat_number = ANY(v_used));
  v_used := v_used || v_reserved;

  FOR v_ticket IN
    SELECT ticket.id, ticket.trip_id, ticket.seat_number, route.origin_city, route.destination_city
    FROM public.tickets ticket
    JOIN public.trips trip ON trip.id = ticket.trip_id
    JOIN public.routes route ON route.id = trip.route_id
    WHERE ticket.trip_id = ANY(v_source_ids) AND ticket.status IN ('active','pending')
    ORDER BY ticket.seat_number, ticket.created_at, ticket.id FOR UPDATE OF ticket
  LOOP
    SELECT target_trip.id INTO v_target_leg
    FROM public.trips target_trip
    JOIN public.routes target_route ON target_route.id = target_trip.route_id
    WHERE target_trip.id = ANY(v_target_ids)
      AND lower(trim(target_route.origin_city)) = lower(trim(v_ticket.origin_city))
      AND lower(trim(target_route.destination_city)) = lower(trim(v_ticket.destination_city))
    ORDER BY target_trip.departure_time LIMIT 1;
    IF v_ticket.seat_number = ANY(v_reserved) THEN
      v_new_seat := v_ticket.seat_number;
    ELSE
      SELECT seat INTO v_new_seat FROM generate_series(2, v_bus_capacity) seat WHERE NOT (seat = ANY(v_used)) ORDER BY seat LIMIT 1;
    END IF;
    IF v_new_seat IS NULL THEN RAISE EXCEPTION 'Passengers from both journeys do not fit in the selected bus' USING ERRCODE = '22023'; END IF;
    UPDATE public.tickets SET trip_id = v_target_leg, seat_number = v_new_seat WHERE id = v_ticket.id;
    IF NOT (v_new_seat = ANY(v_used)) THEN v_used := array_append(v_used, v_new_seat); END IF;
    v_moved := v_moved + 1;
    v_assignments := v_assignments || jsonb_build_array(jsonb_build_object('ticket_id', v_ticket.id, 'old_seat', v_ticket.seat_number, 'new_seat', v_new_seat));
  END LOOP;

  UPDATE public.trips SET status = 'cancelled', available_seats = 0 WHERE id = ANY(v_source_ids);
  UPDATE public.trips SET available_seats = GREATEST(v_capacity - cardinality(v_used), 0) WHERE id = ANY(v_target_ids);
  RETURN jsonb_build_object('source_trip_ids', v_source_ids, 'target_trip_ids', v_target_ids, 'moved_passengers', v_moved, 'seat_assignments', v_assignments);
END;
$function$;

REVOKE ALL ON FUNCTION public.nawasoft_cancel_empty_run(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nawasoft_lock_bus_sales(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nawasoft_update_run_times(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nawasoft_replace_run_bus(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nawasoft_merge_runs(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nawasoft_cancel_empty_run(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nawasoft_lock_bus_sales(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nawasoft_update_run_times(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nawasoft_replace_run_bus(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nawasoft_merge_runs(uuid, uuid) TO service_role;
