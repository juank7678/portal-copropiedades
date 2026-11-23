-- Documentos al día en Drive, sin reemplazar archivos (cada versión lleva otro nombre):
--   hoja_vida  nueva versión cuando cambian los datos o el técnico de la copropiedad
--   interno    cotización del técnico, en una carpeta aparte de las de los clientes (se pueden compartir sin mostrarla)
--   informe    nueva versión del informe de visita cuando el administrador corrige el diagnóstico

alter table public.avisos drop constraint avisos_tipo_check;
alter table public.avisos add constraint avisos_tipo_check
  check (tipo in ('registro', 'visita', 'entrega', 'prueba', 'fotos_visita', 'fotos_entrega', 'cotizacion', 'hoja_vida', 'interno', 'informe'));

-- ---------- Hoja de vida ----------
-- Hay una sola fila por copropiedad: cada cambio la vuelve a poner en cola. En este tipo, `progreso` es el número de versión
-- (la 1 es la del registro). Varios cambios seguidos se juntan en una sola versión.
create function public.aviso_hoja_vida() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.avisos as a (tipo, ref_id, titulo, con_correo, progreso)
  values ('hoja_vida', new.id, 'Hoja de vida actualizada: ' || new.nombre, false, 2)
  on conflict (tipo, ref_id) where ref_id is not null do update
    set estado = 'pendiente', intentos = 0, error = '', titulo = excluded.titulo, creado_en = now(), actualizado_en = now(),
        progreso = a.progreso + case when a.estado = 'pendiente' then 0 else 1 end;
  return null;
end $$;
revoke execute on function public.aviso_hoja_vida() from public, anon, authenticated;
create trigger aviso_hoja_vida_au after update on public.copropiedades for each row
  when ((old.nombre, old.administrador, old.direccion, old.email, old.cel_admin, old.tel_porteria, old.nit, old.tecnico_id)
        is distinct from (new.nombre, new.administrador, new.direccion, new.email, new.cel_admin, new.tel_porteria, new.nit, new.tecnico_id))
  execute function public.aviso_hoja_vida();

-- ---------- Visita: la cotización del técnico sale en su propio aviso ----------
create or replace function public.aviso_cotizacion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := lpad(new.numero::text, 3, '0') || ' · ' || new.copropiedad_nombre;
begin
  insert into public.avisos (tipo, ref_id, titulo) values ('visita', new.id, 'Visita N.° ' || v_ref);
  if cardinality(new.fotos) + cardinality(new.fotos_extra) > 0 then
    insert into public.avisos (tipo, ref_id, titulo, con_correo) values ('fotos_visita', new.id, 'Fotos de la visita N.° ' || v_ref, false);
  end if;
  if jsonb_array_length(new.lineas) > 0 then
    insert into public.avisos (tipo, ref_id, titulo, con_correo) values ('interno', new.id, 'Cotización del técnico N.° ' || v_ref, false);
  end if;
  return null;
end $$;

-- ---------- Corrección del diagnóstico ----------
create table public.informe_versiones (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones(id) on delete cascade,
  version int not null,
  diagnostico text not null,
  recomendacion text not null,
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  unique (cotizacion_id, version)
);
alter table public.informe_versiones enable row level security;
revoke all on public.informe_versiones from anon, authenticated;
grant select on public.informe_versiones to authenticated;
create policy informe_versiones_select on public.informe_versiones for select to authenticated using ((select public.es_admin()));

-- La versión 1 (lo que escribió el técnico) se guarda la primera vez que se corrige
create function public.editar_diagnostico(p_id uuid, p_diagnostico text, p_recomendacion text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cot public.cotizaciones;
  v_diag text := left(trim(coalesce(p_diagnostico, '')), 2000);
  v_rec text := left(trim(coalesce(p_recomendacion, '')), 1000);
  v_version int;
  v_id uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede corregir el diagnóstico.' using errcode = '42501';
  end if;
  select * into v_cot from public.cotizaciones where id = p_id for update;
  if v_cot.id is null then
    raise exception 'La visita no existe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.entregas where cotizacion_id = p_id) then
    raise exception 'Esta visita ya tiene una entrega registrada.' using errcode = 'P0001';
  end if;
  if v_diag = '' then
    raise exception 'El diagnóstico no puede quedar vacío.' using errcode = 'P0001';
  end if;
  if v_diag = v_cot.diagnostico and v_rec = v_cot.recomendacion then return; end if;

  insert into public.informe_versiones (cotizacion_id, version, diagnostico, recomendacion, creado_por, creado_en)
  values (p_id, 1, v_cot.diagnostico, v_cot.recomendacion, v_cot.tecnico_id, v_cot.creado_en)
  on conflict (cotizacion_id, version) do nothing;
  select max(version) + 1 into v_version from public.informe_versiones where cotizacion_id = p_id;
  insert into public.informe_versiones (cotizacion_id, version, diagnostico, recomendacion, creado_por)
  values (p_id, v_version, v_diag, v_rec, auth.uid())
  returning id into v_id;

  update public.cotizaciones set diagnostico = v_diag, recomendacion = v_rec where id = p_id;
  insert into public.avisos (tipo, ref_id, titulo)
  values ('informe', v_id, 'Informe de visita N.° ' || lpad(v_cot.numero::text, 3, '0') || ' v' || v_version || ' · ' || v_cot.copropiedad_nombre);
end $$;
revoke execute on function public.editar_diagnostico(uuid, text, text) from public, anon, authenticated;
grant execute on function public.editar_diagnostico(uuid, text, text) to authenticated;

-- ---------- Lo ya registrado (sin correos) ----------
-- La cotización del técnico de todas las visitas, en la carpeta nueva
insert into public.avisos (tipo, ref_id, titulo, con_correo)
select 'interno', q.id, 'Cotización del técnico N.° ' || lpad(q.numero::text, 3, '0') || ' · ' || q.copropiedad_nombre, false
  from public.cotizaciones q where jsonb_array_length(q.lineas) > 0
on conflict do nothing;

-- Las hojas de vida que salieron al momento del registro, cuando aún no había técnico asignado
insert into public.avisos (tipo, ref_id, titulo, con_correo, progreso)
select 'hoja_vida', c.id, 'Hoja de vida actualizada: ' || c.nombre, false, 2
  from public.copropiedades c join public.avisos a on a.tipo = 'registro' and a.ref_id = c.id and a.con_correo
 where c.tecnico_id is not null
on conflict do nothing;
