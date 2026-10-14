-- Portal de copropiedades: esquema, permisos (RLS) y lógica de servidor.
-- Roles de la app (tabla perfiles): 'admin' y 'tecnico'. El registro de clientes es público vía RPC.

-- ---------- Tablas ----------
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  rol text not null check (rol in ('admin', 'tecnico')),
  usuario text not null unique check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  cedula text not null default '' check (length(cedula) <= 30),
  celular text not null default '' check (length(celular) <= 30),
  foto_path text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.copropiedades (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  anio int not null,
  nombre text not null check (length(trim(nombre)) between 1 and 150),
  administrador text not null check (length(trim(administrador)) between 1 and 150),
  direccion text not null default '' check (length(direccion) <= 200),
  email text not null default '' check (length(email) <= 150),
  cel_admin text not null default '' check (length(cel_admin) <= 30),
  tel_porteria text not null default '' check (length(tel_porteria) <= 30),
  tecnico_id uuid references public.perfiles(id) on delete set null,
  autoriza_datos boolean not null default false,
  creado_en timestamptz not null default now(),
  unique (slug, anio)
);
create index on public.copropiedades (tecnico_id);

create table public.precios (
  clave text primary key,
  etiqueta text not null,
  valor int not null check (valor >= 0),
  tipo text not null check (tipo in ('cantidad', 'piso', 'rociador')),
  permite_romper boolean not null default false,
  orden int not null
);

-- Parámetros visibles para usuarios autenticados
create table public.ajustes (
  id int primary key default 1 check (id = 1),
  valor_romper int not null default 300000 check (valor_romper >= 0)
);

-- Parámetros solo para el servidor/admin (margen del cliente, código de configuración inicial)
create table public.ajustes_privados (
  id int primary key default 1 check (id = 1),
  factor_cliente numeric(6, 3) not null default 1.45 check (factor_cliente > 0),
  codigo_inicial_hash text
);

create sequence public.cotizacion_numero_seq;

create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.cotizacion_numero_seq'),
  copropiedad_id uuid not null references public.copropiedades(id) on delete cascade,
  copropiedad_nombre text not null,
  tecnico_id uuid references public.perfiles(id) on delete set null,
  tecnico_nombre text not null,
  torre int not null,
  piso int not null,
  lineas jsonb not null,            -- [{concepto, cantidad, valor_tecnico}]
  total_tecnico bigint not null,
  fotos text[] not null default '{}',
  creado_en timestamptz not null default now()
);
create index on public.cotizaciones (copropiedad_id);
create index on public.cotizaciones (tecnico_id);

-- Precio al cliente: separado para que los técnicos nunca puedan leerlo
create table public.cotizaciones_cliente (
  cotizacion_id uuid primary key references public.cotizaciones(id) on delete cascade,
  lineas jsonb not null,            -- [{concepto, cantidad, valor_cliente}]
  total_cliente bigint not null
);

insert into public.ajustes default values;
insert into public.ajustes_privados default values;
insert into public.precios (clave, etiqueta, valor, tipo, permite_romper, orden) values
  ('tramo3040',  'Tramo cuarto de basuras (Ø 30-40 cm)',              500000, 'cantidad', true,  1),
  ('tramo5060',  'Tramo cuarto de basuras (Ø 50-60 cm)',              600000, 'cantidad', true,  2),
  ('fibraPiso',  'Reparación por piso de fibra',                       50000, 'piso',     true,  3),
  ('reparTapas', 'Reparación de tapas',                                50000, 'piso',     true,  4),
  ('reductores', 'Reparación de reductores de velocidad',             130000, 'piso',     true,  5),
  ('instalTapas','Instalación de tapas shut en acero inoxidable',      50000, 'piso',     true,  6),
  ('rociadores', 'Instalación de rociadores contra incendios',        450000, 'rociador', false, 7);

-- ---------- Funciones auxiliares ----------
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin' and activo);
$$;

create or replace function public.es_tecnico() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'tecnico' and activo);
$$;

create or replace function public.slugify(s text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(
    translate(lower(trim(s)), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------- Registro público de copropiedades ----------
create or replace function public.registrar_copropiedad(
  p_nombre text, p_administrador text, p_direccion text, p_email text,
  p_cel_admin text, p_tel_porteria text, p_autoriza boolean
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

  insert into public.copropiedades (slug, anio, nombre, administrador, direccion, email, cel_admin, tel_porteria, autoriza_datos)
  values (public.slugify(p_nombre), v_anio, upper(trim(p_nombre)), upper(trim(p_administrador)),
          upper(trim(coalesce(p_direccion, ''))), lower(trim(coalesce(p_email, ''))),
          trim(coalesce(p_cel_admin, '')), trim(coalesce(p_tel_porteria, '')), true)
  on conflict (slug, anio) do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Esta copropiedad ya está registrada este año. Para actualizar sus datos, comunícate con el administrador.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'nombre', v_row.nombre, 'anio', v_row.anio, 'administrador', v_row.administrador,
    'direccion', v_row.direccion, 'email', v_row.email, 'cel_admin', v_row.cel_admin,
    'tel_porteria', v_row.tel_porteria, 'creado_en', v_row.creado_en);
end $$;

-- ---------- Creación de cotizaciones (solo el técnico asignado) ----------
-- El servidor calcula totales y el precio al cliente; el factor nunca sale al navegador del técnico.
create or replace function public.crear_cotizacion(
  p_copropiedad_id uuid, p_torre int, p_piso int, p_lineas jsonb, p_fotos text[]
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

  if p_torre not between 1 and 50 or p_piso not between 1 and 50 then
    raise exception 'Torre o piso fuera de rango.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 100 then
    raise exception 'La cotización no tiene ítems válidos.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_fotos, 1), 0) > 4 then
    raise exception 'El informe lleva máximo 4 fotos.' using errcode = 'P0001';
  end if;
  foreach v_foto in array coalesce(p_fotos, '{}') loop
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
    v_valor_cliente := (round(v_valor * v_factor / 5000) * 5000)::bigint;
    v_total := v_total + v_cantidad * v_valor;
    v_total_cliente := v_total_cliente + v_cantidad * v_valor_cliente;
    v_lineas := v_lineas || jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad, 'valor_tecnico', v_valor);
    v_lineas_cliente := v_lineas_cliente || jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad, 'valor_cliente', v_valor_cliente);
  end loop;

  if v_total <= 0 then
    raise exception 'El total de la cotización debe ser mayor a cero.' using errcode = 'P0001';
  end if;

  insert into public.cotizaciones (copropiedad_id, copropiedad_nombre, tecnico_id, tecnico_nombre, torre, piso, lineas, total_tecnico, fotos)
  values (v_cop.id, v_cop.nombre, v_perfil.id, v_perfil.nombre, p_torre, p_piso, v_lineas, v_total, coalesce(p_fotos, '{}'))
  returning * into v_cot;

  insert into public.cotizaciones_cliente (cotizacion_id, lineas, total_cliente)
  values (v_cot.id, v_lineas_cliente, v_total_cliente);

  return to_jsonb(v_cot);
end $$;

-- ---------- Permisos ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.registrar_copropiedad(text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.crear_cotizacion(uuid, int, int, jsonb, text[]) to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.es_tecnico() to authenticated;

grant select, update on public.perfiles to authenticated;
grant select, update, delete on public.copropiedades to authenticated;
grant select, update on public.precios to authenticated;
grant select on public.ajustes to authenticated;
grant select, delete on public.cotizaciones to authenticated;
grant select on public.cotizaciones_cliente to authenticated;

alter table public.perfiles enable row level security;
alter table public.copropiedades enable row level security;
alter table public.precios enable row level security;
alter table public.ajustes enable row level security;
alter table public.ajustes_privados enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.cotizaciones_cliente enable row level security;

create policy perfiles_select on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()));
create policy perfiles_update on public.perfiles for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create policy cop_select on public.copropiedades for select to authenticated
  using ((select public.es_admin()) or (tecnico_id = (select auth.uid()) and (select public.es_tecnico())));
create policy cop_update on public.copropiedades for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy cop_delete on public.copropiedades for delete to authenticated
  using ((select public.es_admin()));

create policy precios_select on public.precios for select to authenticated
  using ((select public.es_admin()) or (select public.es_tecnico()));
create policy precios_update on public.precios for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create policy ajustes_select on public.ajustes for select to authenticated
  using ((select public.es_admin()) or (select public.es_tecnico()));

create policy cot_select on public.cotizaciones for select to authenticated
  using ((select public.es_admin()) or (tecnico_id = (select auth.uid()) and (select public.es_tecnico())));
create policy cot_delete on public.cotizaciones for delete to authenticated
  using ((select public.es_admin()));

create policy cotcli_select on public.cotizaciones_cliente for select to authenticated
  using ((select public.es_admin()));

-- Columnas que el admin puede editar (el rol, usuario y activo solo cambian desde la función de servidor)
revoke update on public.perfiles from authenticated;
grant update (nombre, cedula, celular, foto_path) on public.perfiles to authenticated;
revoke update on public.copropiedades from authenticated;
grant update (nombre, administrador, direccion, email, cel_admin, tel_porteria, tecnico_id) on public.copropiedades to authenticated;
revoke update on public.precios from authenticated;
grant update (valor) on public.precios to authenticated;

-- ---------- Almacenamiento de fotos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('visitas',  'visitas',  false, 5242880, array['image/jpeg']),
  ('tecnicos', 'tecnicos', false, 5242880, array['image/jpeg']);

-- Fotos de visitas: {copropiedad_id}/{lote}/{n}.jpg
create policy visitas_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'visitas' and (select public.es_tecnico()) and exists (
      select 1 from public.copropiedades c
      where c.id::text = (storage.foldername(name))[1] and c.tecnico_id = (select auth.uid())));
create policy visitas_select on storage.objects for select to authenticated
  using (
    bucket_id = 'visitas' and (
      (select public.es_admin())
      or ((select public.es_tecnico()) and exists (
        select 1 from public.cotizaciones q where q.tecnico_id = (select auth.uid()) and storage.objects.name = any (q.fotos)))));
create policy visitas_delete on storage.objects for delete to authenticated
  using (bucket_id = 'visitas' and (select public.es_admin()));

-- Fotos de técnicos: {perfil_id}.jpg (solo admin)
create policy tecnicos_all on storage.objects for all to authenticated
  using (bucket_id = 'tecnicos' and (select public.es_admin()))
  with check (bucket_id = 'tecnicos' and (select public.es_admin()));
