-- Precios base del administrador: precio al cliente por ítem, independiente de los precios base del técnico.
-- Valor vacío = se sigue calculando como siempre. Los técnicos no pueden leer esta tabla.

create table public.precios_admin (
  clave text primary key,
  valor int check (valor is null or valor between 0 and 1000000000),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id) on delete set null
);
insert into public.precios_admin (clave) select clave from public.precios;
insert into public.precios_admin (clave) values ('rotura');

alter table public.precios_admin enable row level security;
revoke all on public.precios_admin from anon, authenticated;

-- Precio al cliente de una línea. Solo lo usan funciones del servidor.
create function public.precio_cliente(p_clave text, p_valor bigint, p_factor numeric) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select valor::bigint from public.precios_admin where clave = p_clave),
    (round(p_valor * p_factor / 5000) * 5000)::bigint);
$$;
revoke execute on function public.precio_cliente(text, bigint, numeric) from public, anon, authenticated;

-- Lista para la tarjeta del administrador, con lo que se cobra hoy por cada ítem
create function public.precios_admin_lista() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_factor numeric;
  v_romper bigint;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver estos precios.' using errcode = '42501';
  end if;
  select factor_cliente into v_factor from public.ajustes_privados where id = 1;
  select valor_romper into v_romper from public.ajustes where id = 1;
  return (
    select jsonb_agg(x.fila order by x.orden) from (
      select p.orden, jsonb_build_object('clave', p.clave, 'etiqueta', p.etiqueta, 'valor', a.valor,
               'valor_tecnico', p.valor, 'calculado', (round(p.valor * v_factor / 5000) * 5000)::bigint) as fila
        from public.precios p join public.precios_admin a on a.clave = p.clave
      union all
      select 1000, jsonb_build_object('clave', 'rotura', 'etiqueta', 'Rotura (¿Se debe romper?)', 'valor', a.valor,
               'valor_tecnico', v_romper, 'calculado', (round(v_romper * v_factor / 5000) * 5000)::bigint)
        from public.precios_admin a where a.clave = 'rotura'
    ) x);
end $$;

-- p_precios = [{ clave, valor }], con valor null para volver al cálculo automático
create function public.guardar_precios_admin(p_precios jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fila jsonb;
  v_valor bigint;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede cambiar estos precios.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_precios) <> 'array' then
    raise exception 'Datos de precios no válidos.' using errcode = 'P0001';
  end if;
  for v_fila in select * from jsonb_array_elements(p_precios) loop
    v_valor := (v_fila ->> 'valor')::bigint;
    if v_valor is not null and v_valor not between 0 and 1000000000 then
      raise exception 'Hay un precio fuera de rango.' using errcode = 'P0001';
    end if;
    update public.precios_admin
       set valor = v_valor, actualizado_en = now(), actualizado_por = auth.uid()
     where clave = v_fila ->> 'clave' and valor is distinct from v_valor;
  end loop;
end $$;

revoke execute on function public.precios_admin_lista(), public.guardar_precios_admin(jsonb) from public, anon, authenticated;
grant execute on function public.precios_admin_lista(), public.guardar_precios_admin(jsonb) to authenticated;

-- La visita indica de qué ítem viene cada línea para buscar su precio (`clave`; sin clave, cálculo automático)
create or replace function public.crear_cotizacion(
  p_copropiedad_id uuid, p_torre int, p_piso int, p_lineas jsonb, p_fotos text[],
  p_diagnostico text default '', p_recomendacion text default '',
  p_fotos_extra text[] default '{}', p_lote uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfiles;
  v_cop public.copropiedades;
  v_factor numeric;
  v_linea jsonb;
  v_concepto text;
  v_cantidad bigint;
  v_valor bigint;
  v_total bigint := 0;
  v_total_cliente bigint := 0;
  v_lineas jsonb := '[]'::jsonb;
  v_lineas_cliente jsonb := '[]'::jsonb;
  v_valor_cliente bigint;
  v_foto text;
  v_cot public.cotizaciones;
begin
  select * into v_perfil from public.perfiles where id = auth.uid() and rol = 'tecnico' and activo;
  if v_perfil.id is null then
    raise exception 'Solo un técnico activo puede registrar visitas.' using errcode = '42501';
  end if;

  select * into v_cop from public.copropiedades where id = p_copropiedad_id;
  if v_cop.id is null or v_cop.tecnico_id is distinct from v_perfil.id then
    raise exception 'No tienes autorización para esta copropiedad.' using errcode = '42501';
  end if;

  if p_lote is not null then
    select * into v_cot from public.cotizaciones where lote = p_lote and tecnico_id = v_perfil.id;
    if v_cot.id is not null then return to_jsonb(v_cot); end if;
  end if;

  if p_torre not between 1 and 50 or not (p_piso between 1 and 50 or p_piso between 90 and 99) then
    raise exception 'Torre o piso fuera de rango.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 100 then
    raise exception 'La cotización no tiene ítems válidos.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_fotos, 1), 0) > 4 then
    raise exception 'El informe lleva máximo 4 fotos.' using errcode = 'P0001';
  end if;
  if p_lote is not null and coalesce(array_length(p_fotos, 1), 0) = 0 then
    raise exception 'El informe lleva al menos 1 foto.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_fotos, 1), 0) + coalesce(array_length(p_fotos_extra, 1), 0) > 30 then
    raise exception 'Una visita lleva máximo 30 fotos.' using errcode = 'P0001';
  end if;
  foreach v_foto in array coalesce(p_fotos, '{}') || coalesce(p_fotos_extra, '{}') loop
    if v_foto !~ ('^' || p_copropiedad_id::text || '/[0-9a-f-]{36}/[0-9]+\.jpg$') then
      raise exception 'Ruta de foto inválida.' using errcode = 'P0001';
    end if;
  end loop;

  select factor_cliente into v_factor from public.ajustes_privados where id = 1;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_concepto := left(trim(v_linea ->> 'concepto'), 1000);
    v_cantidad := (v_linea ->> 'cantidad')::bigint;
    v_valor := (v_linea ->> 'valor_tecnico')::bigint;
    if coalesce(v_concepto, '') = '' or v_cantidad is null or v_cantidad < 1 or v_cantidad > 10000
       or v_valor is null or v_valor < 0 or v_valor > 1000000000 then
      raise exception 'Hay un ítem con datos inválidos.' using errcode = 'P0001';
    end if;
    v_valor_cliente := public.precio_cliente(v_linea ->> 'clave', v_valor, v_factor);
    v_total := v_total + v_cantidad * v_valor;
    v_total_cliente := v_total_cliente + v_cantidad * v_valor_cliente;
    v_lineas := v_lineas || jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad, 'valor_tecnico', v_valor);
    v_lineas_cliente := v_lineas_cliente || jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad, 'valor_cliente', v_valor_cliente);
  end loop;

  if v_total <= 0 then
    raise exception 'El total de la cotización debe ser mayor a cero.' using errcode = 'P0001';
  end if;

  insert into public.cotizaciones (copropiedad_id, copropiedad_nombre, tecnico_id, tecnico_nombre, torre, piso, lineas, total_tecnico, fotos, fotos_extra, lote, diagnostico, recomendacion)
  values (v_cop.id, v_cop.nombre, v_perfil.id, v_perfil.nombre, p_torre, p_piso, v_lineas, v_total, coalesce(p_fotos, '{}'), coalesce(p_fotos_extra, '{}'), p_lote,
          left(trim(coalesce(p_diagnostico, '')), 2000), left(trim(coalesce(p_recomendacion, '')), 1000))
  returning * into v_cot;

  insert into public.cotizaciones_cliente (cotizacion_id, lineas, total_cliente)
  values (v_cot.id, v_lineas_cliente, v_total_cliente);

  return to_jsonb(v_cot);
end $$;
