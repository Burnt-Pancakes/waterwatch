create or replace function nearest_water_temp(
  p_lat    double precision,
  p_lng    double precision,
  p_max_km double precision default 30.0
) returns table (temp_c double precision, observed_at timestamptz,
                 station_name text, source text, distance_km double precision)
language sql stable
set search_path = public
as $$
  with box as (
    select p_lat - (p_max_km / 111.0) as min_lat,
           p_lat + (p_max_km / 111.0) as max_lat,
           p_lng - (p_max_km / (111.0 * cos(radians(p_lat)))) as min_lng,
           p_lng + (p_max_km / (111.0 * cos(radians(p_lat)))) as max_lng
  ),
  latest as (
    select distinct on (source, station_code)
           source, station_code, station_name, lat, lng, temp_c, observed_at
    from water_temp_observations
    where observed_at > now() - interval '6 hours'
    order by source, station_code, observed_at desc
  ),
  candidates as (
    select l.temp_c, l.observed_at, l.station_name, l.source,
           6371 * 2 * asin(sqrt(
             power(sin(radians(l.lat - p_lat) / 2), 2) +
             cos(radians(p_lat)) * cos(radians(l.lat)) *
             power(sin(radians(l.lng - p_lng) / 2), 2)
           )) as distance_km
    from latest l, box b
    where l.lat between b.min_lat and b.max_lat
      and l.lng between b.min_lng and b.max_lng
  )
  select temp_c, observed_at, station_name, source, distance_km
  from candidates
  where distance_km <= p_max_km
  order by distance_km
  limit 1;
$$;