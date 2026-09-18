-- Boarding points and joining journeys for NAWASOFT.
--
-- nawasoft_add_run_legs: add more routes (boarding points) to a journey on the
--   same bus, e.g. Gamek -> Sumbe and Gamek -> Benguela onto a Kikolo -> Sumbe
--   journey. The new rows overlap the journey, so they share its seat pool.
--
-- nawasoft_merge_into_run: join a journey into another bus even when that bus
--   does not serve every route yet. Missing routes are added to the target
--   with the source's own times and fares, then nawasoft_merge_runs moves the
--   passengers. Everything happens in one transaction: all or nothing.
--
-- Both follow the locking pattern of 20260917_trip_operations.sql.

-- p_ignore_trip_ids: trips to leave out of the bus/driver conflict check.
-- nawasoft_merge_into_run passes the source journey here, because those trips
-- are cancelled in the same transaction and must not block their own merge.
DROP FUNCTION IF EXISTS public.nawasoft_add_run_legs(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.nawasoft_add_run_legs(p_trip_id uuid, p_legs jsonb, p_ignore_trip_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_ids uuid[];
  v_new_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
  v_leg record;
  v_start timestamptz;
  v_end timestamptz;
  v_latest_departure timestamptz;
  v_earliest_arrival timestamptz;
  v_limit integer;
  v_bus_capacity integer;
  v_capacity integer;
  v_occupied integer;
BEGIN
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF v_trip.id IS NULL THEN RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002'; END IF;
  IF v_trip.status NOT IN ('scheduled', 'boarding') THEN
    RAISE EXCEPTION 'Only active journeys can be edited' USING ERRCODE = '22023';
  END IF;
  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) = 0 THEN
    RAISE EXCEPTION 'Choose at least one route to add' USING ERRCODE = '22023';
  END IF;
  PERFORM public.nawasoft_lock_bus_sales(v_trip.bus_id);

  SELECT array_agg(id ORDER BY id) INTO v_ids
  FROM public.trips
  WHERE bus_id = v_trip.bus_id
    AND status IN ('scheduled', 'boarding')
    AND departure_time < v_trip.arrival_time
    AND v_trip.departure_time < arrival_time;
  PERFORM 1 FROM public.trips WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  DROP TABLE IF EXISTS tmp_nawasoft_new_legs;
  CREATE TEMP TABLE tmp_nawasoft_new_legs(
    route_id uuid,
    departure_time timestamptz,
    arrival_time timestamptz,
    price_usd numeric
  ) ON COMMIT DROP;
  INSERT INTO tmp_nawasoft_new_legs
  SELECT x.route_id, x.departure_time, x.arrival_time, x.price_usd
  FROM jsonb_to_recordset(p_legs) AS x(route_id uuid, departure_time timestamptz, arrival_time timestamptz, price_usd numeric);

  IF EXISTS (
    SELECT 1 FROM tmp_nawasoft_new_legs
    WHERE route_id IS NULL OR departure_time IS NULL OR arrival_time IS NULL
       OR arrival_time <= departure_time OR price_usd IS NULL OR price_usd <= 0
  ) THEN
    RAISE EXCEPTION 'Each new route needs a departure, a later arrival and a price above zero' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_nawasoft_new_legs leg
    LEFT JOIN public.routes route ON route.id = leg.route_id
    WHERE route.id IS NULL
       OR route.is_active IS NOT TRUE
       OR route.company_id IS DISTINCT FROM v_trip.company_id
  ) THEN
    RAISE EXCEPTION 'Route not found or not available for this company' USING ERRCODE = '22023';
  END IF;

  -- Selling and merging match routes by city names, so one row per
  -- origin/destination pair: among the new legs, and against the journey.
  IF EXISTS (
    SELECT 1
    FROM tmp_nawasoft_new_legs leg JOIN public.routes route ON route.id = leg.route_id
    GROUP BY lower(trim(route.origin_city)), lower(trim(route.destination_city))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same route was supplied twice' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM tmp_nawasoft_new_legs leg
    JOIN public.routes new_route ON new_route.id = leg.route_id
    JOIN public.trips existing ON existing.id = ANY(v_ids)
    JOIN public.routes existing_route ON existing_route.id = existing.route_id
    WHERE lower(trim(existing_route.origin_city)) = lower(trim(new_route.origin_city))
      AND lower(trim(existing_route.destination_city)) = lower(trim(new_route.destination_city))
  ) THEN
    RAISE EXCEPTION 'This journey already serves that route' USING ERRCODE = '22023';
  END IF;

  -- Every leg, old and new, must be on the road at one shared moment, or the
  -- rows stop being one bus load with one seat map.
  SELECT min(departure_time), max(arrival_time), max(departure_time), min(arrival_time)
    INTO v_start, v_end, v_latest_departure, v_earliest_arrival
  FROM (
    SELECT departure_time, arrival_time FROM public.trips WHERE id = ANY(v_ids)
    UNION ALL
    SELECT departure_time, arrival_time FROM tmp_nawasoft_new_legs
  ) all_legs;
  IF v_latest_departure >= v_earliest_arrival THEN
    RAISE EXCEPTION 'Routes must overlap to share the same bus and seats' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trips other
    WHERE other.id <> ALL(v_ids)
      AND (p_ignore_trip_ids IS NULL OR other.id <> ALL(p_ignore_trip_ids))
      AND other.status IN ('scheduled', 'boarding')
      AND (other.bus_id = v_trip.bus_id OR other.driver_id = v_trip.driver_id)
      AND other.departure_time < v_end AND v_start < other.arrival_time
  ) THEN
    RAISE EXCEPTION 'Bus or driver is already assigned during the new time' USING ERRCODE = '23P01';
  END IF;

  -- A sales limit on the journey applies to its new legs too.
  SELECT min(sales_capacity_limit) INTO v_limit FROM public.trips WHERE id = ANY(v_ids);

  FOR v_leg IN SELECT * FROM tmp_nawasoft_new_legs ORDER BY departure_time LOOP
    INSERT INTO public.trips (
      route_id, bus_id, driver_id, seat_class, departure_time, arrival_time,
      price_usd, available_seats, status, company_id, is_campaign, sales_capacity_limit
    ) VALUES (
      v_leg.route_id, v_trip.bus_id, v_trip.driver_id, v_trip.seat_class, v_leg.departure_time, v_leg.arrival_time,
      v_leg.price_usd, 0, 'scheduled', v_trip.company_id, false, v_limit
    )
    RETURNING id INTO v_new_id;
    v_new_ids := array_append(v_new_ids, v_new_id);
  END LOOP;

  -- Free seats for the whole journey, old and new legs alike.
  SELECT capacity INTO v_bus_capacity FROM public.buses WHERE id = v_trip.bus_id;
  v_capacity := LEAST(GREATEST(v_bus_capacity - 1, 0), COALESCE(v_limit, GREATEST(v_bus_capacity - 1, 0)));
  SELECT count(DISTINCT seat_number) INTO v_occupied
  FROM public.tickets
  WHERE trip_id = ANY(v_ids || v_new_ids)
    AND status IN ('active', 'pending', 'used')
    AND seat_number <> public.copilot_seat_number();
  UPDATE public.trips
  SET available_seats = GREATEST(v_capacity - v_occupied, 0)
  WHERE id = ANY(v_ids || v_new_ids);

  RETURN jsonb_build_object(
    'added_trip_ids', to_jsonb(v_new_ids),
    'journey_trip_ids', to_jsonb(v_ids || v_new_ids),
    'available_seats', GREATEST(v_capacity - v_occupied, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.nawasoft_merge_into_run(p_source_trip_id uuid, p_target_trip_id uuid)
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
  v_missing jsonb;
  v_added jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO v_source FROM public.trips WHERE id = p_source_trip_id;
  SELECT * INTO v_target FROM public.trips WHERE id = p_target_trip_id;
  IF v_source.id IS NULL OR v_target.id IS NULL THEN RAISE EXCEPTION 'Journey not found' USING ERRCODE = 'P0002'; END IF;
  IF v_source.bus_id = v_target.bus_id THEN RAISE EXCEPTION 'Choose a journey on another bus' USING ERRCODE = '22023'; END IF;
  IF v_source.company_id IS DISTINCT FROM v_target.company_id
     OR v_source.status NOT IN ('scheduled', 'boarding')
     OR v_target.status NOT IN ('scheduled', 'boarding') THEN
    RAISE EXCEPTION 'Journeys must be active and belong to the same company' USING ERRCODE = '22023';
  END IF;

  -- Take both bus locks in the canonical order nawasoft_merge_runs uses before
  -- the nested calls re-take them (re-entrant within this transaction), so
  -- this can never deadlock against another merge or bus change.
  IF v_source.bus_id::text < v_target.bus_id::text THEN
    PERFORM public.nawasoft_lock_bus_sales(v_source.bus_id);
    PERFORM public.nawasoft_lock_bus_sales(v_target.bus_id);
  ELSE
    PERFORM public.nawasoft_lock_bus_sales(v_target.bus_id);
    PERFORM public.nawasoft_lock_bus_sales(v_source.bus_id);
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_source_ids FROM public.trips
  WHERE bus_id = v_source.bus_id AND status IN ('scheduled', 'boarding')
    AND departure_time < v_source.arrival_time AND v_source.departure_time < arrival_time;
  SELECT array_agg(id ORDER BY id) INTO v_target_ids FROM public.trips
  WHERE bus_id = v_target.bus_id AND status IN ('scheduled', 'boarding')
    AND departure_time < v_target.arrival_time AND v_target.departure_time < arrival_time;

  -- Source routes the target bus does not serve yet, once per city pair,
  -- keeping the source's own times and fare.
  SELECT jsonb_agg(jsonb_build_object(
           'route_id', m.route_id,
           'departure_time', m.departure_time,
           'arrival_time', m.arrival_time,
           'price_usd', m.price_usd) ORDER BY m.departure_time)
    INTO v_missing
  FROM (
    SELECT DISTINCT ON (lower(trim(route.origin_city)), lower(trim(route.destination_city)))
      leg.route_id, leg.departure_time, leg.arrival_time, leg.price_usd
    FROM public.trips leg
    JOIN public.routes route ON route.id = leg.route_id
    WHERE leg.id = ANY(v_source_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.trips target_leg
        JOIN public.routes target_route ON target_route.id = target_leg.route_id
        WHERE target_leg.id = ANY(v_target_ids)
          AND lower(trim(target_route.origin_city)) = lower(trim(route.origin_city))
          AND lower(trim(target_route.destination_city)) = lower(trim(route.destination_city))
      )
    ORDER BY lower(trim(route.origin_city)), lower(trim(route.destination_city)), leg.departure_time
  ) m;

  IF v_missing IS NOT NULL THEN
    v_added := public.nawasoft_add_run_legs(p_target_trip_id, v_missing, v_source_ids) -> 'added_trip_ids';
  END IF;

  v_result := public.nawasoft_merge_runs(p_source_trip_id, p_target_trip_id);
  RETURN v_result || jsonb_build_object('added_trip_ids', v_added);
END;
$function$;

REVOKE ALL ON FUNCTION public.nawasoft_add_run_legs(uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nawasoft_merge_into_run(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nawasoft_add_run_legs(uuid, jsonb, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.nawasoft_merge_into_run(uuid, uuid) TO service_role;
