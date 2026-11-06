-- Avisos al administrador: cada registro, visita o entrega deja una fila en `avisos` (bandeja de salida).
-- La base de datos llama a la función `avisos` (pg_net), que arma los PDF y los envía al script de Google
-- de la cuenta del cliente: ese script guarda los archivos en su Drive y le manda el correo desde su Gmail.
-- La llamada sale al confirmar la transacción, así que no depende del celular de quien registra.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- Diagnóstico de la visita (texto de los informes tipo carta) ----------
alter table public.cotizaciones
  add column diagnostico text not null default '' check (length(diagnostico) <= 2000),
  add column recomendacion text not null default '' check (length(recomendacion) <= 1000);

drop function public.crear_cotizacion(uuid, int, int, jsonb, text[]);
create function public.crear_cotizacion(
  p_copropiedad_id uuid, p_torre int, p_piso int, p_lineas jsonb, p_fotos text[],
  p_diagnostico text default '', p_recomendacion text default ''
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

  if p_torre not between 1 and 50 or not (p_piso between 1 and 50 or p_piso between 90 and 99) then
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

  insert into public.cotizaciones (copropiedad_id, copropiedad_nombre, tecnico_id, tecnico_nombre, torre, piso, lineas, total_tecnico, fotos, diagnostico, recomendacion)
  values (v_cop.id, v_cop.nombre, v_perfil.id, v_perfil.nombre, p_torre, p_piso, v_lineas, v_total, coalesce(p_fotos, '{}'),
          left(trim(coalesce(p_diagnostico, '')), 2000), left(trim(coalesce(p_recomendacion, '')), 1000))
  returning * into v_cot;

  insert into public.cotizaciones_cliente (cotizacion_id, lineas, total_cliente)
  values (v_cot.id, v_lineas_cliente, v_total_cliente);

  return to_jsonb(v_cot);
end $$;
revoke execute on function public.crear_cotizacion(uuid, int, int, jsonb, text[], text, text) from public, anon, authenticated;
grant execute on function public.crear_cotizacion(uuid, int, int, jsonb, text[], text, text) to authenticated;

-- ---------- Conexión con la cuenta de Google del cliente (nunca sale al navegador) ----------
alter table public.ajustes_privados
  add column avisos_url text not null default '',
  add column avisos_token text not null default '',
  add column avisos_correo text not null default 'cprado2001+shut@gmail.com',
  add column avisos_carpeta_url text not null default '',
  add column avisos_secreto text not null default encode(extensions.gen_random_bytes(32), 'hex');

-- Archivos de marca (fondo, cabecera y firma): sin políticas, solo los lee el servidor
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', false, 2097152, array['image/jpeg', 'image/png']);

-- ---------- Bandeja de salida ----------
create table public.avisos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('registro', 'visita', 'entrega', 'prueba')),
  ref_id uuid,
  titulo text not null,
  con_correo boolean not null default true,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'error', 'descartado')),
  intentos int not null default 0,
  error text not null default '',
  carpeta_url text not null default '',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  enviado_en timestamptz
);
create unique index on public.avisos (tipo, ref_id) where ref_id is not null;
create index on public.avisos (estado, creado_en);

alter table public.avisos enable row level security;
revoke all on public.avisos from anon, authenticated;
grant select on public.avisos to authenticated;
create policy avisos_select on public.avisos for select to authenticated using ((select public.es_admin()));

create function public.avisos_despachar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.ajustes_privados;
begin
  select * into v_cfg from public.ajustes_privados where id = 1;
  if v_cfg.avisos_url = '' then return; end if;  -- sin conexión: queda en la bandeja hasta conectar
  perform net.http_post(
    url := 'https://gfmzotkzubbgsqzhkmic.supabase.co/functions/v1/avisos',
    body := jsonb_build_object('id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avisos-secreto', v_cfg.avisos_secreto),
    timeout_milliseconds := 120000);
end $$;

-- Los avisos con correo salen de una vez; los demás (copia del histórico) los va sacando el cron de a pocos
create function public.avisos_tras_insertar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.con_correo then perform public.avisos_despachar(new.id); end if;
  return null;
end $$;
create trigger avisos_ai after insert on public.avisos for each row execute function public.avisos_tras_insertar();

-- El formulario de registro es público: más de 20 registros en una hora no generan correo (sí quedan en la carpeta)
create function public.aviso_copropiedad() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.avisos (tipo, ref_id, titulo, con_correo)
  values ('registro', new.id, 'Nuevo registro: ' || new.nombre,
          (select count(*) from public.avisos where tipo = 'registro' and creado_en > now() - interval '1 hour') < 20);
  return null;
end $$;
create trigger aviso_ai after insert on public.copropiedades for each row execute function public.aviso_copropiedad();

create function public.aviso_cotizacion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.avisos (tipo, ref_id, titulo)
  values ('visita', new.id, 'Visita N.° ' || lpad(new.numero::text, 3, '0') || ' · ' || new.copropiedad_nombre);
  return null;
end $$;
create trigger aviso_ai after insert on public.cotizaciones for each row execute function public.aviso_cotizacion();

create function public.aviso_entrega() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.avisos (tipo, ref_id, titulo)
  select 'entrega', new.id, 'Entrega N.° ' || lpad(new.numero::text, 3, '0') || ' · ' || q.copropiedad_nombre
  from public.cotizaciones q where q.id = new.cotizacion_id;
  return null;
end $$;
create trigger aviso_ai after insert on public.entregas for each row execute function public.aviso_entrega();

-- Cada 2 minutos: rescata envíos colgados, reintenta errores con espera creciente y saca pendientes de a 3
create function public.avisos_reintentar() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select avisos_url from public.ajustes_privados where id = 1) = '' then return; end if;
  update public.avisos set estado = 'error', error = 'El envío no terminó a tiempo.', actualizado_en = now()
   where estado = 'enviando' and actualizado_en < now() - interval '5 minutes';
  for v_id in
    select id from public.avisos
     where (estado = 'pendiente' and actualizado_en < now() - interval '1 minute')
        or (estado = 'error' and intentos < 6 and actualizado_en < now() - make_interval(mins => 5 * intentos))
     order by creado_en limit 3
  loop
    update public.avisos set actualizado_en = now() where id = v_id;
    perform public.avisos_despachar(v_id);
  end loop;
end $$;
select cron.schedule('avisos-reintentos', '*/2 * * * *', 'select public.avisos_reintentar()');

-- ---------- Acciones del administrador ----------
create function public.avisos_conexion() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg public.ajustes_privados;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver esta configuración.' using errcode = '42501';
  end if;
  select * into v_cfg from public.ajustes_privados where id = 1;
  return jsonb_build_object('conectado', v_cfg.avisos_url <> '', 'url', v_cfg.avisos_url,
                            'correo', v_cfg.avisos_correo, 'carpeta_url', v_cfg.avisos_carpeta_url);
end $$;

-- La clave en blanco conserva la que ya estaba guardada
create function public.guardar_conexion_avisos(p_url text, p_token text, p_correo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := trim(coalesce(p_url, ''));
  v_token text := trim(coalesce(p_token, ''));
  v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede cambiar esta configuración.' using errcode = '42501';
  end if;
  if v_url !~ '^https://script\.google\.com/macros/(a/[^/]+/)?s/[A-Za-z0-9_-]+/exec$' then
    raise exception 'La dirección debe ser la de la aplicación web de Google y terminar en /exec.' using errcode = 'P0001';
  end if;
  if v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_correo) > 150 then
    raise exception 'El correo no es válido.' using errcode = 'P0001';
  end if;
  update public.ajustes_privados
     set avisos_url = v_url, avisos_correo = v_correo,
         avisos_token = case when v_token = '' then avisos_token else v_token end
   where id = 1;
  if (select avisos_token from public.ajustes_privados where id = 1) = '' then
    raise exception 'Falta la clave que muestra el script de Google.' using errcode = 'P0001';
  end if;
end $$;

create function public.enviar_prueba_aviso() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede enviar pruebas.' using errcode = '42501';
  end if;
  if (select avisos_url from public.ajustes_privados where id = 1) = '' then
    raise exception 'Primero conecta la cuenta de Google.' using errcode = 'P0001';
  end if;
  insert into public.avisos (tipo, titulo) values ('prueba', 'Prueba de conexión');
end $$;

create function public.reintentar_aviso(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede reintentar envíos.' using errcode = '42501';
  end if;
  update public.avisos set estado = 'pendiente', intentos = 0, error = '', actualizado_en = now()
   where id = p_id and estado in ('error', 'pendiente');
  if found then perform public.avisos_despachar(p_id); end if;
end $$;

-- Copia a la carpeta (sin correos) todo lo registrado antes de conectar. Devuelve cuántos elementos agregó.
create function public.copiar_historico_a_nube() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := 0;
  v_m int;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede hacer esta copia.' using errcode = '42501';
  end if;
  insert into public.avisos (tipo, ref_id, titulo, con_correo)
  select 'registro', c.id, 'Registro: ' || c.nombre, false from public.copropiedades c
  on conflict do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  insert into public.avisos (tipo, ref_id, titulo, con_correo)
  select 'visita', q.id, 'Visita N.° ' || lpad(q.numero::text, 3, '0') || ' · ' || q.copropiedad_nombre, false from public.cotizaciones q
  on conflict do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  insert into public.avisos (tipo, ref_id, titulo, con_correo)
  select 'entrega', e.id, 'Entrega N.° ' || lpad(e.numero::text, 3, '0') || ' · ' || q.copropiedad_nombre, false
  from public.entregas e join public.cotizaciones q on q.id = e.cotizacion_id
  on conflict do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  return v_n;
end $$;

revoke execute on function
  public.avisos_despachar(uuid), public.avisos_tras_insertar(), public.aviso_copropiedad(), public.aviso_cotizacion(),
  public.aviso_entrega(), public.avisos_reintentar(), public.avisos_conexion(), public.guardar_conexion_avisos(text, text, text),
  public.enviar_prueba_aviso(), public.reintentar_aviso(uuid), public.copiar_historico_a_nube()
  from public, anon, authenticated;
grant execute on function
  public.avisos_conexion(), public.guardar_conexion_avisos(text, text, text), public.enviar_prueba_aviso(),
  public.reintentar_aviso(uuid), public.copiar_historico_a_nube()
  to authenticated;

-- ---------- Riesgos del informe ----------
-- Una copropiedad con cuentas de cobro ya no se puede borrar (el borrado arrastraría documentos de cobro)
drop policy cop_delete on public.copropiedades;
create policy cop_delete on public.copropiedades for delete to authenticated
  using ((select public.es_admin()) and not exists (select 1 from public.cuentas_cobro cc where cc.copropiedad_id = copropiedades.id));

-- Datos del prestador tomados de los informes del cliente (solo si siguen vacíos; se editan en la app)
update public.emisor
   set nombre = 'CARLOS ALBERTO PRADO', tipo_documento = 'C.C.', documento = '71.749.150',
       celular = '311 739 7041', email = 'cprado2001+shut@gmail.com', direccion = 'Calle 12 # 73 184', ciudad = 'Medellín'
 where id = 1 and trim(nombre) = '';
