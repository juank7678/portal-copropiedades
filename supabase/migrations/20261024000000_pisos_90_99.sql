-- Pisos válidos: 90-99 (así los numera el cliente) y 1-50. Solo cambia la validación de crear_cotizacion.
do $$
declare
  v_def text := pg_get_functiondef('public.crear_cotizacion(uuid, int, int, jsonb, text[])'::regprocedure);
  v_viejo constant text := 'p_torre not between 1 and 50 or p_piso not between 1 and 50';
  v_nuevo constant text := 'p_torre not between 1 and 50 or not (p_piso between 1 and 50 or p_piso between 90 and 99)';
begin
  if position(v_viejo in v_def) = 0 then
    raise exception 'crear_cotizacion no tiene la validación de pisos esperada';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
