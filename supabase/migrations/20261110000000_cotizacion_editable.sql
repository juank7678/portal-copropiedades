-- El administrador revisa, edita y confirma la cotización del cliente antes de generar su PDF.
-- `cotizaciones_cliente` guarda siempre la versión vigente; `total_cliente` es el total final (ya con descuento).
-- Cada versión queda en `cotizacion_versiones`; la versión 1 es la que calculó el servidor al registrar la visita.

alter table public.cotizaciones_cliente
  add column subtotal bigint,
  add column descuento_pct int not null default 0 check (descuento_pct in (0, 3, 5, 10)),
  add column descuento_valor bigint not null default 0,
  add column version int not null default 1,
  add column confirmada_en timestamptz;

-- Las cotizaciones anteriores ya se generaron y se enviaron a Drive: quedan confirmadas tal como están
update public.cotizaciones_cliente c
   set subtotal = c.total_cliente, confirmada_en = q.creado_en
  from public.cotizaciones q where q.id = c.cotizacion_id;
alter table public.cotizaciones_cliente alter column subtotal set not null;

create table public.cotizacion_versiones (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones(id) on delete cascade,
  version int not null,
  lineas jsonb not null,
  subtotal bigint not null,
  descuento_pct int not null default 0,
  descuento_valor bigint not null default 0,
  total bigint not null,
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  unique (cotizacion_id, version)
);

insert into public.cotizacion_versiones (cotizacion_id, version, lineas, subtotal, total, creado_por, creado_en)
select c.cotizacion_id, 1, c.lineas, c.subtotal, c.total_cliente, q.tecnico_id, q.creado_en
  from public.cotizaciones_cliente c join public.cotizaciones q on q.id = c.cotizacion_id;

alter table public.cotizacion_versiones enable row level security;
revoke all on public.cotizacion_versiones from anon, authenticated;
grant select on public.cotizacion_versiones to authenticated;
create policy versiones_select on public.cotizacion_versiones for select to authenticated using ((select public.es_admin()));

-- Toda cotización nueva nace sin confirmar y con su versión 1
create function public.cotizacion_cliente_bi() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.subtotal := coalesce(new.subtotal, new.total_cliente);
  return new;
end $$;
create trigger cotizacion_cliente_bi before insert on public.cotizaciones_cliente for each row execute function public.cotizacion_cliente_bi();

create function public.cotizacion_cliente_ai() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cotizacion_versiones (cotizacion_id, version, lineas, subtotal, total, creado_por)
  values (new.cotizacion_id, 1, new.lineas, new.subtotal, new.total_cliente, auth.uid());
  return null;
end $$;
create trigger cotizacion_cliente_ai after insert on public.cotizaciones_cliente for each row execute function public.cotizacion_cliente_ai();
revoke execute on function public.cotizacion_cliente_bi(), public.cotizacion_cliente_ai() from public, anon, authenticated;

-- ---------- Confirmación ----------
alter table public.avisos drop constraint avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check
  check (tipo in ('registro', 'visita', 'entrega', 'prueba', 'fotos_visita', 'fotos_entrega', 'cotizacion'));

-- p_lineas = [{ concepto, cantidad, valor_cliente, origen? }]. El total se calcula aquí, no en el navegador.
create function public.confirmar_cotizacion(p_id uuid, p_lineas jsonb, p_descuento int default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cot public.cotizaciones;
  v_cli public.cotizaciones_cliente;
  v_linea jsonb;
  v_concepto text;
  v_cantidad bigint;
  v_valor bigint;
  v_lineas jsonb := '[]'::jsonb;
  v_trabajos jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_descuento bigint;
  v_version int;
  v_version_id uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede confirmar cotizaciones.' using errcode = '42501';
  end if;
  select * into v_cot from public.cotizaciones where id = p_id for update;
  if v_cot.id is null then
    raise exception 'La cotización no existe.' using errcode = 'P0001';
  end if;
  if v_cot.aprobada_en is not null or v_cot.cuenta_cobro_id is not null then
    raise exception 'Esta cotización ya está aprobada. Quita la aprobación para editarla.' using errcode = 'P0001';
  end if;
  if coalesce(p_descuento, -1) not in (0, 3, 5, 10) then
    raise exception 'El descuento debe ser 0, 3, 5 o 10 %%.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) not between 1 and 100 then
    raise exception 'La cotización debe tener entre 1 y 100 conceptos.' using errcode = 'P0001';
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_concepto := left(trim(v_linea ->> 'concepto'), 1000);
    v_cantidad := (v_linea ->> 'cantidad')::bigint;
    v_valor := (v_linea ->> 'valor_cliente')::bigint;
    if coalesce(v_concepto, '') = '' or v_cantidad is null or v_cantidad not between 1 and 10000
       or v_valor is null or v_valor not between 0 and 1000000000 then
      raise exception 'Hay un concepto con datos inválidos.' using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + v_cantidad * v_valor;
    v_lineas := v_lineas || (jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad, 'valor_cliente', v_valor)
                || case when v_linea ->> 'origen' = 'oficial' then jsonb_build_object('origen', 'oficial') else '{}'::jsonb end);
    v_trabajos := v_trabajos || jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad);
  end loop;
  if v_subtotal <= 0 then
    raise exception 'El total de la cotización debe ser mayor a cero.' using errcode = 'P0001';
  end if;
  v_descuento := round(v_subtotal * p_descuento / 100.0)::bigint;

  select * into v_cli from public.cotizaciones_cliente where cotizacion_id = p_id for update;
  if v_lineas = v_cli.lineas and p_descuento = v_cli.descuento_pct then
    -- Sin cambios: si ya estaba confirmada no hay nada que hacer; si no, se confirma la versión vigente
    if v_cli.confirmada_en is not null then return to_jsonb(v_cli); end if;
    v_version := v_cli.version;
    select id into v_version_id from public.cotizacion_versiones where cotizacion_id = p_id and version = v_version;
  else
    v_version := v_cli.version + 1;
    insert into public.cotizacion_versiones (cotizacion_id, version, lineas, subtotal, descuento_pct, descuento_valor, total, creado_por)
    values (p_id, v_version, v_lineas, v_subtotal, p_descuento, v_descuento, v_subtotal - v_descuento, auth.uid())
    returning id into v_version_id;
  end if;

  update public.cotizaciones_cliente
     set lineas = v_lineas, subtotal = v_subtotal, descuento_pct = p_descuento, descuento_valor = v_descuento,
         total_cliente = v_subtotal - v_descuento, version = v_version, confirmada_en = now()
   where cotizacion_id = p_id
  returning * into v_cli;
  update public.cotizaciones set trabajos = v_trabajos where id = p_id;

  insert into public.avisos (tipo, ref_id, titulo)
  values ('cotizacion', v_version_id, 'Cotización N.° ' || lpad(v_cot.numero::text, 3, '0') || ' v' || v_version || ' · ' || v_cot.copropiedad_nombre);

  return to_jsonb(v_cli);
end $$;
revoke execute on function public.confirmar_cotizacion(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.confirmar_cotizacion(uuid, jsonb, int) to authenticated;

-- ---------- Aprobar exige la cotización confirmada ----------
create or replace function public.aprobar_cotizacion(p_id uuid, p_aprobada boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede aprobar cotizaciones.' using errcode = '42501';
  end if;
  if exists (select 1 from public.entregas where cotizacion_id = p_id) then
    raise exception 'Esta cotización ya tiene una entrega registrada.' using errcode = 'P0001';
  end if;
  if p_aprobada and exists (select 1 from public.cotizaciones_cliente where cotizacion_id = p_id and confirmada_en is null) then
    raise exception 'Confirma la cotización antes de aprobarla.' using errcode = 'P0001';
  end if;
  if p_aprobada and exists (select 1 from public.cotizaciones where id = p_id and requiere_oficial is true and oficial_id is null) then
    raise exception 'Esta visita requiere oficial: asígnalo antes de aprobar.' using errcode = 'P0001';
  end if;
  update public.cotizaciones set aprobada_en = case when p_aprobada then now() end where id = p_id;
  if not found then
    raise exception 'La cotización no existe.' using errcode = 'P0001';
  end if;
end $$;

-- ---------- La cuenta de cobro muestra el descuento como una línea negativa, para que las líneas sumen el total ----------
create or replace function public.crear_cuenta_cobro(p_copropiedad_id uuid, p_cotizaciones uuid[], p_concepto text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cop public.copropiedades;
  v_emi public.emisor;
  v_ids uuid[];
  v_validas int;
  v_cots text;
  v_ents text;
  v_varias boolean;
  v_lineas jsonb;
  v_total bigint;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_cuenta public.cuentas_cobro;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede emitir cuentas de cobro.' using errcode = '42501';
  end if;

  select * into v_cop from public.copropiedades where id = p_copropiedad_id;
  if v_cop.id is null then
    raise exception 'La copropiedad no existe.' using errcode = 'P0001';
  end if;
  select * into v_emi from public.emisor where id = 1;
  if trim(v_emi.nombre) = '' or trim(v_emi.documento) = '' then
    raise exception 'Completa los datos del prestador (nombre y documento) antes de emitir cuentas de cobro.' using errcode = 'P0001';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_cotizaciones) as x;
  if coalesce(array_length(v_ids, 1), 0) not between 1 and 50 then
    raise exception 'Elige entre 1 y 50 cotizaciones para la cuenta de cobro.' using errcode = 'P0001';
  end if;

  perform 1 from public.cotizaciones where id = any (v_ids) for update;
  select count(*) into v_validas
  from public.cotizaciones q join public.entregas e on e.cotizacion_id = q.id
  where q.id = any (v_ids) and q.copropiedad_id = v_cop.id and q.cuenta_cobro_id is null;
  if v_validas <> array_length(v_ids, 1) then
    raise exception 'Solo se pueden cobrar cotizaciones entregadas de esta copropiedad que aún no tengan cuenta de cobro.' using errcode = 'P0001';
  end if;

  select string_agg(lpad(q.numero::text, greatest(3, length(q.numero::text)), '0'), ', ' order by q.numero),
         string_agg(lpad(e.numero::text, greatest(3, length(e.numero::text)), '0'), ', ' order by q.numero),
         count(*) > 1
    into v_cots, v_ents, v_varias
  from public.cotizaciones q join public.entregas e on e.cotizacion_id = q.id
  where q.id = any (v_ids);

  select jsonb_agg(z.l order by z.num, z.ord) into v_lineas from (
    select q.numero as num, x.ord, x.l || jsonb_build_object('cotizacion', q.numero) as l
    from public.cotizaciones q
    join public.cotizaciones_cliente c on c.cotizacion_id = q.id
    cross join lateral jsonb_array_elements(c.lineas) with ordinality as x(l, ord)
    where q.id = any (v_ids)
    union all
    select q.numero, 1000000, jsonb_build_object('concepto', 'Descuento ' || c.descuento_pct || ' %', 'cantidad', 1,
                                                 'valor_cliente', -c.descuento_valor, 'cotizacion', q.numero)
    from public.cotizaciones q
    join public.cotizaciones_cliente c on c.cotizacion_id = q.id
    where q.id = any (v_ids) and c.descuento_valor > 0
  ) z;
  select sum(total_cliente) into v_total from public.cotizaciones_cliente where cotizacion_id = any (v_ids);

  insert into public.cuentas_cobro (copropiedad_id, fecha, vence, concepto, lineas, total, cliente, emisor)
  values (
    v_cop.id, v_hoy, v_hoy + v_emi.dias_vencimiento,
    coalesce(nullif(left(trim(p_concepto), 1000), ''),
      'Servicio técnico de shuts de basura según ' ||
      case when v_varias then 'cotizaciones N.° ' else 'cotización N.° ' end || v_cots ||
      case when v_varias then ' e informes de entrega N.° ' else ' e informe de entrega N.° ' end || v_ents || '.'),
    v_lineas, v_total,
    jsonb_build_object('nombre', v_cop.nombre, 'nit', v_cop.nit, 'administrador', v_cop.administrador,
                       'direccion', v_cop.direccion, 'email', v_cop.email, 'cel_admin', v_cop.cel_admin),
    to_jsonb(v_emi) - 'id')
  returning * into v_cuenta;

  update public.cotizaciones set cuenta_cobro_id = v_cuenta.id where id = any (v_ids);
  return to_jsonb(v_cuenta);
end $$;
