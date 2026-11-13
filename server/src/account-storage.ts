/** New reads use the separated tables. Legacy account columns are a SQL-managed
 * compatibility projection for staged deployments and previous Worker releases. */
export const accountFields = 'a.id,a.username,a.role,a.active,a.deleted_at,a.created_at,' +
    'profile.display_name,credentials.password_hash,credentials.must_change_password,credentials.temporary_expires_at';
export const accountTables = ' FROM accounts a' +
    ' JOIN account_profiles profile ON profile.account_id=a.id' +
    ' JOIN account_credentials credentials ON credentials.account_id=a.id';
