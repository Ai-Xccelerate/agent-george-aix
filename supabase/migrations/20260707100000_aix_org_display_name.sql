-- Rebrand default org display name for AIX George (local + fresh installs).
update public.orgs
set name = 'AIX'
where id = '00000000-0000-0000-0000-000000000001'
  and name = 'Onyx';
