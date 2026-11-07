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
