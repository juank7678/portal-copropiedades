-- Reglas de las visitas nuevas, que se activan cuando la app publicada ya las cumple.
-- Es un trigger de inserción y no un CHECK porque las visitas anteriores no tienen estos datos y se siguen actualizando.
create function public.cotizacion_validar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.requiere_oficial is null then
    raise exception 'Indica si la visita requiere oficial. Si no ves la pregunta, recarga la página.' using errcode = 'P0001';
  end if;
  if cardinality(new.fotos) = 0 then
    raise exception 'El informe lleva al menos 1 foto.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.cotizacion_validar() from public, anon, authenticated;
create trigger cotizacion_validar before insert on public.cotizaciones for each row execute function public.cotizacion_validar();
