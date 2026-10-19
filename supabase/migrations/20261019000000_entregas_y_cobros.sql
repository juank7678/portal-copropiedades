-- Entregas de obra y cuentas de cobro.
-- Estado de una cotización (se deriva, no se guarda como texto):
--   cotizada → aprobada (aprobada_en) → entregada (tiene fila en entregas)
--   → cobrada (cuenta_cobro_id) → pagada (la cuenta de cobro está pagada).

-- ---------- Datos nuevos en tablas existentes ----------
alter table public.copropiedades add column nit text not null default '' check (length(nit) <= 30);

alter table public.ajustes add column garantia_meses int not null default 6 check (garantia_meses between 0 and 60);

-- Quién emite las cuentas de cobro (solo admin)
create table public.emisor (
  id int primary key default 1 check (id = 1),
  nombre text not null default '' check (length(nombre) <= 150),
  tipo_documento text not null default 'C.C.' check (tipo_documento in ('C.C.', 'NIT', 'C.E.')),
  documento text not null default '' check (length(documento) <= 30),
  celular text not null default '' check (length(celular) <= 30),
  email text not null default '' check (length(email) <= 150),
  direccion text not null default '' check (length(direccion) <= 200),
  ciudad text not null default 'Bogotá D.C.' check (length(ciudad) <= 80),
  banco text not null default '' check (length(banco) <= 80),
  tipo_cuenta text not null default 'Ahorros' check (tipo_cuenta in ('Ahorros', 'Corriente')),
  numero_cuenta text not null default '' check (length(numero_cuenta) <= 40),
  dias_vencimiento int not null default 15 check (dias_vencimiento between 0 and 120),
  declaracion text not null default 'Declaro que no soy responsable de IVA y que no estoy obligado a expedir factura electrónica. Para efectos de retención en la fuente, manifiesto que no he contratado ni vinculado dos o más trabajadores asociados a esta actividad.'
    check (length(declaracion) <= 1500)
);
insert into public.emisor default values;

create sequence public.cuenta_cobro_numero_seq;

create table public.cuentas_cobro (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.cuenta_cobro_numero_seq'),
  copropiedad_id uuid not null references public.copropiedades(id) on delete cascade,
  fecha date not null,
  vence date not null,
  concepto text not null check (length(concepto) between 1 and 1000),
  lineas jsonb not null,            -- [{cotizacion, concepto, cantidad, valor_cliente}]
  total bigint not null,
  cliente jsonb not null,           -- copia de los datos de la copropiedad al emitir
  emisor jsonb not null,            -- copia de los datos del prestador al emitir
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  pagada_en timestamptz,
  creado_en timestamptz not null default now()
);
create index on public.cuentas_cobro (copropiedad_id);

alter table public.cotizaciones
  add column aprobada_en timestamptz,
  add column cuenta_cobro_id uuid references public.cuentas_cobro(id) on delete set null;
create index on public.cotizaciones (cuenta_cobro_id);

create sequence public.entrega_numero_seq;

create table public.entregas (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.entrega_numero_seq'),
  cotizacion_id uuid not null unique references public.cotizaciones(id) on delete cascade,
  copropiedad_id uuid not null references public.copropiedades(id) on delete cascade,
  tecnico_id uuid references public.perfiles(id) on delete set null,
  tecnico_nombre text not null,
  fecha_inicio date,
  fecha_entrega date not null,
  observaciones text not null default '' check (length(observaciones) <= 2000),
  recibido_por text not null default '' check (length(recibido_por) <= 150),
  garantia_meses int not null,
  fotos text[] not null default '{}',
  creado_en timestamptz not null default now()
);
create index on public.entregas (copropiedad_id);
create index on public.entregas (tecnico_id);

-- ---------- Registro público: ahora con NIT (opcional) ----------
drop function public.registrar_copropiedad(text, text, text, text, text, text, boolean);
create or replace function public.registrar_copropiedad(
  p_nombre text, p_administrador text, p_direccion text, p_email text,
  p_cel_admin text, p_tel_porteria text, p_autoriza boolean, p_nit text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_anio int := extract(year from now() at time zone 'America/Bogota')::int;
  v_row public.copropiedades;
begin
  if not coalesce(p_autoriza, false) then
    raise exception 'Debes autorizar el tratamiento de datos personales para continuar.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_administrador), '') = '' then
    raise exception 'Falta el nombre de la copropiedad o del administrador.' using errcode = 'P0001';
  end if;
  if public.slugify(p_nombre) = '' then
    raise exception 'El nombre de la copropiedad no es válido.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_nit, ''))) > 30 then
    raise exception 'El NIT es demasiado largo.' using errcode = 'P0001';
  end if;

  insert into public.copropiedades (slug, anio, nombre, administrador, direccion, email, cel_admin, tel_porteria, nit, autoriza_datos)
  values (public.slugify(p_nombre), v_anio, upper(trim(p_nombre)), upper(trim(p_administrador)),
          upper(trim(coalesce(p_direccion, ''))), lower(trim(coalesce(p_email, ''))),
          trim(coalesce(p_cel_admin, '')), trim(coalesce(p_tel_porteria, '')), upper(trim(coalesce(p_nit, ''))), true)
  on conflict (slug, anio) do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Esta copropiedad ya está registrada este año. Para actualizar sus datos, comunícate con el administrador.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'nombre', v_row.nombre, 'anio', v_row.anio, 'administrador', v_row.administrador,
    'direccion', v_row.direccion, 'email', v_row.email, 'cel_admin', v_row.cel_admin,
    'tel_porteria', v_row.tel_porteria, 'nit', v_row.nit, 'creado_en', v_row.creado_en);
end $$;

-- ---------- Aprobación (admin) ----------
create or replace function public.aprobar_cotizacion(p_id uuid, p_aprobada boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede aprobar cotizaciones.' using errcode = '42501';
  end if;
  if exists (select 1 from public.entregas where cotizacion_id = p_id) then
    raise exception 'Esta cotización ya tiene una entrega registrada.' using errcode = 'P0001';
  end if;
  update public.cotizaciones set aprobada_en = case when p_aprobada then now() end where id = p_id;
  if not found then
    raise exception 'La cotización no existe.' using errcode = 'P0001';
  end if;
end $$;

-- ---------- Entrega de obra (técnico de la cotización) ----------
create or replace function public.crear_entrega(
  p_cotizacion_id uuid, p_fecha_inicio date, p_observaciones text, p_recibido_por text, p_fotos text[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfiles;
  v_cot public.cotizaciones;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_foto text;
  v_ent public.entregas;
begin
  select * into v_perfil from public.perfiles where id = auth.uid() and rol = 'tecnico' and activo;
  if v_perfil.id is null then
    raise exception 'Solo un técnico activo puede registrar entregas.' using errcode = '42501';
  end if;

  select * into v_cot from public.cotizaciones where id = p_cotizacion_id for update;
  if v_cot.id is null or v_cot.tecnico_id is distinct from v_perfil.id
     or not exists (select 1 from public.copropiedades where id = v_cot.copropiedad_id and tecnico_id = v_perfil.id) then
    raise exception 'No tienes autorización para esta cotización.' using errcode = '42501';
  end if;
  if v_cot.aprobada_en is null then
    raise exception 'El administrador aún no ha aprobado esta cotización.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.entregas where cotizacion_id = v_cot.id) then
    raise exception 'Esta cotización ya tiene una entrega registrada.' using errcode = 'P0001';
  end if;
  if p_fecha_inicio is not null and (p_fecha_inicio > v_hoy or p_fecha_inicio < (v_cot.creado_en at time zone 'America/Bogota')::date) then
    raise exception 'La fecha de inicio debe estar entre la visita y hoy.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_fotos, 1), 0) not between 1 and 4 then
    raise exception 'La entrega lleva entre 1 y 4 fotos del trabajo terminado.' using errcode = 'P0001';
  end if;
  foreach v_foto in array p_fotos loop
    if v_foto !~ ('^' || v_cot.copropiedad_id::text || '/[0-9a-f-]{36}/[0-9]+\.jpg$') then
      raise exception 'Ruta de foto inválida.' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.entregas (cotizacion_id, copropiedad_id, tecnico_id, tecnico_nombre, fecha_inicio, fecha_entrega,
                               observaciones, recibido_por, garantia_meses, fotos)
  values (v_cot.id, v_cot.copropiedad_id, v_perfil.id, v_perfil.nombre, p_fecha_inicio, v_hoy,
          left(trim(coalesce(p_observaciones, '')), 2000), upper(left(trim(coalesce(p_recibido_por, '')), 150)),
          (select garantia_meses from public.ajustes where id = 1), p_fotos)
  returning * into v_ent;

  return to_jsonb(v_ent);
end $$;

-- ---------- Cuentas de cobro (admin) ----------
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

  select jsonb_agg(x.l || jsonb_build_object('cotizacion', q.numero) order by q.numero, x.ord) into v_lineas
  from public.cotizaciones q
  join public.cotizaciones_cliente c on c.cotizacion_id = q.id
  cross join lateral jsonb_array_elements(c.lineas) with ordinality as x(l, ord)
  where q.id = any (v_ids);
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

create or replace function public.marcar_cuenta_pagada(p_id uuid, p_pagada boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede cambiar el estado de una cuenta de cobro.' using errcode = '42501';
  end if;
  update public.cuentas_cobro
     set estado = case when p_pagada then 'pagada' else 'pendiente' end,
         pagada_en = case when p_pagada then now() end
   where id = p_id and estado <> 'anulada';
  if not found then
    raise exception 'La cuenta de cobro no existe o está anulada.' using errcode = 'P0001';
  end if;
end $$;

-- Anular conserva el consecutivo y libera las cotizaciones para cobrarlas de nuevo
create or replace function public.anular_cuenta_cobro(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede anular cuentas de cobro.' using errcode = '42501';
  end if;
  update public.cuentas_cobro set estado = 'anulada' where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'Solo se pueden anular cuentas de cobro pendientes de pago.' using errcode = 'P0001';
  end if;
  update public.cotizaciones set cuenta_cobro_id = null where cuenta_cobro_id = p_id;
end $$;

-- ---------- Permisos ----------
revoke all on public.emisor, public.cuentas_cobro, public.entregas from anon, authenticated;
revoke all on sequence public.cuenta_cobro_numero_seq, public.entrega_numero_seq from anon, authenticated;
revoke execute on function
  public.registrar_copropiedad(text, text, text, text, text, text, boolean, text),
  public.aprobar_cotizacion(uuid, boolean),
  public.crear_entrega(uuid, date, text, text, text[]),
  public.crear_cuenta_cobro(uuid, uuid[], text),
  public.marcar_cuenta_pagada(uuid, boolean),
  public.anular_cuenta_cobro(uuid)
  from public, anon, authenticated;

grant execute on function public.registrar_copropiedad(text, text, text, text, text, text, boolean, text) to anon, authenticated;
grant execute on function
  public.aprobar_cotizacion(uuid, boolean),
  public.crear_entrega(uuid, date, text, text, text[]),
  public.crear_cuenta_cobro(uuid, uuid[], text),
  public.marcar_cuenta_pagada(uuid, boolean),
  public.anular_cuenta_cobro(uuid)
  to authenticated;

grant select on public.emisor to authenticated;
grant update (nombre, tipo_documento, documento, celular, email, direccion, ciudad, banco, tipo_cuenta,
              numero_cuenta, dias_vencimiento, declaracion) on public.emisor to authenticated;
grant select on public.cuentas_cobro to authenticated;
grant select, delete on public.entregas to authenticated;
grant update (nit) on public.copropiedades to authenticated;
grant update (garantia_meses) on public.ajustes to authenticated;

alter table public.emisor enable row level security;
alter table public.cuentas_cobro enable row level security;
alter table public.entregas enable row level security;

create policy emisor_select on public.emisor for select to authenticated using ((select public.es_admin()));
create policy emisor_update on public.emisor for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create policy ajustes_update on public.ajustes for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create policy cuentas_select on public.cuentas_cobro for select to authenticated using ((select public.es_admin()));

create policy ent_select on public.entregas for select to authenticated
  using ((select public.es_admin()) or (tecnico_id = (select auth.uid()) and (select public.es_tecnico())));
-- El admin puede borrar una entrega para corregirla mientras no esté cobrada
create policy ent_delete on public.entregas for delete to authenticated
  using ((select public.es_admin()) and not exists (
    select 1 from public.cotizaciones q where q.id = entregas.cotizacion_id and q.cuenta_cobro_id is not null));

-- Una cotización cobrada ya no se puede borrar
drop policy cot_delete on public.cotizaciones;
create policy cot_delete on public.cotizaciones for delete to authenticated
  using ((select public.es_admin()) and cuenta_cobro_id is null);

-- El técnico también ve las fotos de sus entregas
drop policy visitas_select on storage.objects;
create policy visitas_select on storage.objects for select to authenticated
  using (
    bucket_id = 'visitas' and (
      (select public.es_admin())
      or ((select public.es_tecnico()) and (
        exists (select 1 from public.cotizaciones q where q.tecnico_id = (select auth.uid()) and storage.objects.name = any (q.fotos))
        or exists (select 1 from public.entregas e where e.tecnico_id = (select auth.uid()) and storage.objects.name = any (e.fotos))))));
