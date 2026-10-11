# Gotchas and known issues

Tooling and environment traps worth knowing before you hit them yourself —
not bugs in Elpys's own code. For the site's own change history, see
`dev-log.md` in this folder.

## Supabase MCP connector: a semicolon inside a string value hangs the call silently

**What happens:** a `mcp__Supabase__execute_sql` call whose SQL contains a
**semicolon inside a string literal** (not a statement-separator semicolon —
one that's actually part of the text you're writing into a column) hangs for
the full 180-second tool timeout and never reaches Postgres. It does not
error, and it does not partially apply — it silently does nothing. Found
2026-10-05; cost about 12 minutes to diagnose.

**What was ruled out before landing on this**, so nobody has to redo the
work:
- The database was not read-only (`transaction_read_only` and
  `default_transaction_read_only` both `off`, connected as `postgres`).
- No blocking locks, no lingering transactions, no prepared transactions
  (`pg_locks`, `pg_stat_activity`, `pg_prepared_xacts` all clean).
- The statement never appeared in `pg_stat_activity` at all, and setting
  `statement_timeout = '20s'` did **not** produce a Postgres timeout error —
  proof the call was blocked client-side, before it ever reached the server.
- Not table-specific and not statement-type-specific: `UPDATE`s on other
  tables worked fine, and an `UPDATE` on the same `"Opportunities"` table
  worked fine once the semicolon was removed from the string value.

**Workaround:** keep semicolons out of string values in SQL sent through the
connector. Use a comma, a dash, or `chr(59)` if a literal semicolon is
genuinely required in the text. For multi-line text, build it with
`|| chr(10) ||` concatenation rather than embedding newlines and punctuation
in one long string literal.
