INSERT INTO candidate_workspaces (user_id, workspace, revision)
SELECT
  id,
  jsonb_build_object(
    'version', 1,
    'demo', false,
    'profile', jsonb_build_object(
      'firstName', first_name,
      'lastName', '',
      'email', '',
      'phone', '',
      'title', '',
      'city', '',
      'contract', '',
      'skills', '',
      'about', ''
    ),
    'jobs', jsonb_build_array(),
    'experiences', jsonb_build_array(),
    'education', jsonb_build_array()
  ),
  0
FROM users
ON CONFLICT (user_id) DO NOTHING;
