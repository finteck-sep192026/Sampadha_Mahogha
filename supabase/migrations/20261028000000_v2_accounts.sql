-- Sampadha v2: real accounts. Logins are created by the accounts Edge Function (service role):
-- Admin invites staff, or creates the login for an approved client application. The person gets an
-- email with a link to set their own password; the link is never stored. This migration only links
-- an application to the client profile it produced, so a login is created once per application.
alter table v2.client_applications
  add column client_id uuid references v2.profiles (id) on delete set null;
create unique index v2_client_applications_client_idx on v2.client_applications (client_id)
  where client_id is not null;
