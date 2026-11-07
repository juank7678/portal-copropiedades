-- Todas las fotos de una visita o entrega llegan a Drive (`fotos` sigue siendo solo las elegidas para el informe)
-- y una visita reintentada desde un celular con mala señal no se registra dos veces (`lote`).

alter table public.cotizaciones
  add column fotos_extra text[] not null default '{}',
  add column lote uuid;
create unique index cotizaciones_lote_key on public.cotizaciones (lote) where lote is not null;

alter table public.entregas add column fotos_extra text[] not null default '{}';

-- Los avisos de fotos se envían por tandas: `progreso` es cuántas fotos ya llegaron a Drive
alter table public.avisos add column progreso int not null default 0;
alter table public.avisos drop constraint avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check
  check (tipo in ('registro', 'visita', 'entrega', 'prueba', 'fotos_visita', 'fotos_entrega'));

-- ---------- Entrega ----------
drop function public.crear_entrega(uuid, date, text, text, text[]);
create function public.crear_entrega(
  p_cotizacion_id uuid, p_fecha_inicio date, p_observaciones text, p_recibido_por text, p_fotos text[],
  p_fotos_extra text[] default '{}'
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
  select * into v_ent from public.entregas where cotizacion_id = v_cot.id;
  if v_ent.id is not null then
    -- Reintento de la misma entrega (se perdió la respuesta por mala señal)
    if v_ent.fotos && coalesce(p_fotos, '{}') then return to_jsonb(v_ent); end if;
    raise exception 'Esta cotización ya tiene una entrega registrada.' using errcode = 'P0001';
  end if;
  if p_fecha_inicio is not null and (p_fecha_inicio > v_hoy or p_fecha_inicio < (v_cot.creado_en at time zone 'America/Bogota')::date) then
    raise exception 'La fecha de inicio debe estar entre la visita y hoy.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_fotos, 1), 0) not between 1 and 4 then
    raise exception 'La entrega lleva entre 1 y 4 fotos del trabajo terminado.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_fotos, 1), 0) + coalesce(array_length(p_fotos_extra, 1), 0) > 30 then
    raise exception 'Una entrega lleva máximo 30 fotos.' using errcode = 'P0001';
  end if;
  foreach v_foto in array p_fotos || coalesce(p_fotos_extra, '{}') loop
    if v_foto !~ ('^' || v_cot.copropiedad_id::text || '/[0-9a-f-]{36}/[0-9]+\.jpg$') then
      raise exception 'Ruta de foto inválida.' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.entregas (cotizacion_id, copropiedad_id, tecnico_id, tecnico_nombre, fecha_inicio, fecha_entrega,
                               observaciones, recibido_por, garantia_meses, fotos, fotos_extra)
  values (v_cot.id, v_cot.copropiedad_id, v_perfil.id, v_perfil.nombre, p_fecha_inicio, v_hoy,
          left(trim(coalesce(p_observaciones, '')), 2000), upper(left(trim(coalesce(p_recibido_por, '')), 150)),
          (select garantia_meses from public.ajustes where id = 1), p_fotos, coalesce(p_fotos_extra, '{}'))
  returning * into v_ent;

  return to_jsonb(v_ent);
end $$;
revoke execute on function public.crear_entrega(uuid, date, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.crear_entrega(uuid, date, text, text, text[], text[]) to authenticated;

-- ---------- Avisos: además del informe, un aviso sin correo lleva todas las fotos a su carpeta ----------
create or replace function public.aviso_cotizacion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := lpad(new.numero::text, 3, '0') || ' · ' || new.copropiedad_nombre;
begin
  insert into public.avisos (tipo, ref_id, titulo) values ('visita', new.id, 'Visita N.° ' || v_ref);
  if cardinality(new.fotos) + cardinality(new.fotos_extra) > 0 then
    insert into public.avisos (tipo, ref_id, titulo, con_correo) values ('fotos_visita', new.id, 'Fotos de la visita N.° ' || v_ref, false);
  end if;
  return null;
end $$;

create or replace function public.aviso_entrega() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text;
begin
  select lpad(new.numero::text, 3, '0') || ' · ' || q.copropiedad_nombre into v_ref from public.cotizaciones q where q.id = new.cotizacion_id;
  insert into public.avisos (tipo, ref_id, titulo) values ('entrega', new.id, 'Entrega N.° ' || v_ref);
  insert into public.avisos (tipo, ref_id, titulo, con_correo) values ('fotos_entrega', new.id, 'Fotos de la entrega N.° ' || v_ref, false);
  return null;
end $$;
