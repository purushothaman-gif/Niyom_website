-- mf_nav_tracked_result returned void → PostgREST answers with an empty body →
-- sbRpc's JSON parse threw AFTER a successful load, and the catch then logged a
-- bogus "Unexpected end of JSON input" failure on top of the success. Return a
-- boolean so the call has a JSON body, and clear the bogus errors.
drop function if exists public.mf_nav_tracked_result(text, boolean, date, integer, text);
create function public.mf_nav_tracked_result(
  p_isin text, p_ok boolean, p_first_date date, p_rows integer, p_error text)
returns boolean
language sql security definer
set search_path = public
as $$
  update mf_nav_tracked set
    history_loaded_at  = case when p_ok then now() else history_loaded_at end,
    history_first_date = case when p_ok then p_first_date else history_first_date end,
    history_rows       = case when p_ok then p_rows else history_rows end,
    attempts           = attempts + 1,
    last_attempt_at    = now(),
    last_error         = case when p_ok then null else left(p_error, 500) end
  where isin = p_isin
  returning true;
$$;
revoke all on function public.mf_nav_tracked_result(text, boolean, date, integer, text) from public, anon, authenticated;
grant execute on function public.mf_nav_tracked_result(text, boolean, date, integer, text) to service_role;

update public.mf_nav_tracked set last_error = null, attempts = 1
where history_loaded_at is not null and last_error = 'Unexpected end of JSON input';
