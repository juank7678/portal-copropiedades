-- Rol Oficial: la visita indica si lo requiere y registra hasta 3 actividades con su valor.
-- Esos valores van a la cotización del cliente (una sola vez, aquí en el servidor) y no al pago del técnico.

alter table public.perfiles drop constraint perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check check (rol in ('admin', 'tecnico', 'oficial'));

create function public.es_oficial() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'oficial' and activo);
$$;
revoke execute on function public.es_oficial() from public, anon;
grant execute on function public.es_oficial() to authenticated;

alter table public.cotizaciones
  add column requiere_oficial boolean,                      -- null: visita anterior a esta pregunta
  add column oficial_id uuid references public.perfiles(id) on delete set null,
  add column oficial_nombre text not null default '',
  add column lineas_oficial jsonb not null default '[]',    -- [{concepto, valor}]
  add column total_oficial bigint not null default 0,
  add column trabajos jsonb;                                -- [{concepto, cantidad}] sin precios, para los informes; null: usar `lineas`
create index on public.cotizaciones (oficial_id);

-- Decisión pendiente del cliente: si el valor del oficial lleva margen. Se cambia desde la app.
alter table public.ajustes_privados add column oficial_con_margen boolean not null default true;

create function public.config_oficial(p_con_margen boolean default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v boolean;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver esta configuración.' using errcode = '42501';
  end if;
  if p_con_margen is not null then
    update public.ajustes_privados set oficial_con_margen = p_con_margen where id = 1;
  end if;
  select oficial_con_margen into v from public.ajustes_privados where id = 1;
  return v;
end $$;

-- ---------- Visita ----------
drop function public.crear_cotizacion(uuid, int, int, jsonb, text[], text, text, text[], uuid);
create function public.crear_cotizacion(
  p_copropiedad_id uuid, p_torre int, p_piso int, p_lineas jsonb, p_fotos text[],
  p_diagnostico text default '', p_recomendacion text default '',
  p_fotos_extra text[] default '{}', p_lote uuid default null,
  p_requiere_oficial boolean default null, p_actividades jsonb default '[]'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfiles;
  v_cop public.copropiedades;
  v_cfg public.ajustes_privados;
  v_factor numeric;
  v_linea jsonb;
  v_concepto text;
  v_cantidad bigint;
  v_valor bigint;
  v_total bigint := 0;
  v_total_oficial bigint := 0;
  v_total_cliente bigint := 0;
  v_lineas jsonb := '[]'::jsonb;
  v_lineas_oficial jsonb := '[]'::jsonb;
  v_lineas_cliente jsonb := '[]'::jsonb;
  v_trabajos jsonb := '[]'::jsonb;
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
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_typeof(p_actividades) <> 'array' or jsonb_array_length(p_lineas) > 100
     or (jsonb_array_length(p_lineas) = 0 and jsonb_array_length(p_actividades) = 0) then
    raise exception 'La cotización no tiene ítems válidos.' using errcode = 'P0001';
  end if;
  if p_requiere_oficial is true and jsonb_array_length(p_actividades) not between 1 and 3 then
    raise exception 'Registra entre 1 y 3 actividades del oficial.' using errcode = 'P0001';
  end if;
  if p_requiere_oficial is not true and jsonb_array_length(p_actividades) > 0 then
    raise exception 'Hay actividades de oficial en una visita que no lo requiere.' using errcode = 'P0001';
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

  select * into v_cfg from public.ajustes_privados where id = 1;
  v_factor := v_cfg.factor_cliente;

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
    v_trabajos := v_trabajos || jsonb_build_object('concepto', v_concepto, 'cantidad', v_cantidad);
  end loop;

  for v_linea in select * from jsonb_array_elements(p_actividades) loop
    v_concepto := left(trim(v_linea ->> 'concepto'), 200);
    v_valor := (v_linea ->> 'valor')::bigint;
    if coalesce(v_concepto, '') = '' or v_valor is null or v_valor < 1 or v_valor > 1000000000 then
      raise exception 'Hay una actividad del oficial con datos inválidos.' using errcode = 'P0001';
    end if;
    v_valor_cliente := case when v_cfg.oficial_con_margen then (round(v_valor * v_factor / 5000) * 5000)::bigint else v_valor end;
    v_total_oficial := v_total_oficial + v_valor;
    v_total_cliente := v_total_cliente + v_valor_cliente;
    v_lineas_oficial := v_lineas_oficial || jsonb_build_object('concepto', v_concepto, 'valor', v_valor);
    v_lineas_cliente := v_lineas_cliente || jsonb_build_object('concepto', v_concepto, 'cantidad', 1, 'valor_cliente', v_valor_cliente, 'origen', 'oficial');
    v_trabajos := v_trabajos || jsonb_build_object('concepto', v_concepto, 'cantidad', 1);
  end loop;

  if v_total + v_total_oficial <= 0 then
    raise exception 'El total de la cotización debe ser mayor a cero.' using errcode = 'P0001';
  end if;

  insert into public.cotizaciones (copropiedad_id, copropiedad_nombre, tecnico_id, tecnico_nombre, torre, piso, lineas, total_tecnico, fotos, fotos_extra, lote,
                                   diagnostico, recomendacion, requiere_oficial, lineas_oficial, total_oficial, trabajos)
  values (v_cop.id, v_cop.nombre, v_perfil.id, v_perfil.nombre, p_torre, p_piso, v_lineas, v_total, coalesce(p_fotos, '{}'), coalesce(p_fotos_extra, '{}'), p_lote,
          left(trim(coalesce(p_diagnostico, '')), 2000), left(trim(coalesce(p_recomendacion, '')), 1000), p_requiere_oficial, v_lineas_oficial, v_total_oficial, v_trabajos)
  returning * into v_cot;

  insert into public.cotizaciones_cliente (cotizacion_id, lineas, total_cliente)
  values (v_cot.id, v_lineas_cliente, v_total_cliente);

  return to_jsonb(v_cot);
end $$;

-- ---------- Asignación (administrador) ----------
create function public.asignar_oficial(p_id uuid, p_oficial uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cot public.cotizaciones;
  v_of public.perfiles;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede asignar oficiales.' using errcode = '42501';
  end if;
  select * into v_cot from public.cotizaciones where id = p_id for update;
  if v_cot.id is null or v_cot.requiere_oficial is not true then
    raise exception 'Esta visita no requiere oficial.' using errcode = 'P0001';
  end if;
  if v_cot.aprobada_en is not null and p_oficial is null then
    raise exception 'Una cotización aprobada debe tener oficial. Quita primero la aprobación.' using errcode = 'P0001';
  end if;
  if p_oficial is not null then
    select * into v_of from public.perfiles where id = p_oficial and rol = 'oficial' and activo;
    if v_of.id is null then
      raise exception 'Elige un oficial activo.' using errcode = 'P0001';
    end if;
  end if;
  update public.cotizaciones set oficial_id = v_of.id, oficial_nombre = coalesce(v_of.nombre, '') where id = p_id;
end $$;

create or replace function public.aprobar_cotizacion(p_id uuid, p_aprobada boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede aprobar cotizaciones.' using errcode = '42501';
  end if;
  if exists (select 1 from public.entregas where cotizacion_id = p_id) then
    raise exception 'Esta cotización ya tiene una entrega registrada.' using errcode = 'P0001';
  end if;
  if p_aprobada and exists (select 1 from public.cotizaciones where id = p_id and requiere_oficial is true and oficial_id is null) then
    raise exception 'Esta visita requiere oficial: asígnalo antes de aprobar.' using errcode = 'P0001';
  end if;
  update public.cotizaciones set aprobada_en = case when p_aprobada then now() end where id = p_id;
  if not found then
    raise exception 'La cotización no existe.' using errcode = 'P0001';
  end if;
end $$;

-- ---------- Lo que ve el oficial: sus trabajos, sin ningún valor ----------
create function public.mis_trabajos_oficial() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.es_oficial() then
    raise exception 'Solo un oficial activo puede ver esta lista.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'numero', q.numero, 'creado_en', q.creado_en, 'copropiedad', q.copropiedad_nombre,
      'direccion', c.direccion, 'administrador', c.administrador, 'tel_porteria', c.tel_porteria,
      'torre', q.torre, 'piso', q.piso, 'tecnico', q.tecnico_nombre, 'aprobada_en', q.aprobada_en,
      'entregada_en', e.fecha_entrega,
      'actividades', (select coalesce(jsonb_agg(a ->> 'concepto'), '[]'::jsonb) from jsonb_array_elements(q.lineas_oficial) a)
    ) order by q.creado_en desc)
    from public.cotizaciones q
    join public.copropiedades c on c.id = q.copropiedad_id
    left join public.entregas e on e.cotizacion_id = q.id
    where q.oficial_id = auth.uid()), '[]'::jsonb);
end $$;

-- El oficial descarga su propio carnet con su foto
create policy tecnicos_oficial_propia on storage.objects for select to authenticated
  using (bucket_id = 'tecnicos' and (select public.es_oficial())
         and name = (select p.foto_path from public.perfiles p where p.id = (select auth.uid())));

revoke execute on function
  public.crear_cotizacion(uuid, int, int, jsonb, text[], text, text, text[], uuid, boolean, jsonb),
  public.asignar_oficial(uuid, uuid), public.mis_trabajos_oficial(), public.config_oficial(boolean)
  from public, anon, authenticated;
grant execute on function
  public.crear_cotizacion(uuid, int, int, jsonb, text[], text, text, text[], uuid, boolean, jsonb),
  public.asignar_oficial(uuid, uuid), public.mis_trabajos_oficial(), public.config_oficial(boolean)
  to authenticated;
