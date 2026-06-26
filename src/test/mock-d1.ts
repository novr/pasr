type BoundStatement = {
  sql: string;
  params: unknown[];
};

type RunResult = {
  success: boolean;
  meta: { changes?: number; last_row_id?: number; duration?: number };
};

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").trim();

type AbsenceStore = {
  id: string;
  target_user: string;
  start_date: string;
  end_date: string;
  absence_type: string;
  notify_channels: string;
  notify_users: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type MasterStore = {
  target_user: string;
  active: number;
  default_notify_channels: string;
  default_notify_users: string;
  default_registration_notify: string;
  updated_at: string;
};

export const createMockD1 = (): D1Database => {
  const absences = new Map<string, AbsenceStore>();
  const memberMaster = new Map<string, MasterStore>();
  let tablesInitialized = true;

  const execute = (statement: BoundStatement): { results: unknown[]; run: RunResult } => {
    const sql = normalizeSql(statement.sql);
    const p = statement.params;

    if (sql.includes("FROM sqlite_master")) {
      const tables = [];
      if (tablesInitialized && absences) tables.push({ name: "absences" });
      if (tablesInitialized && memberMaster) tables.push({ name: "member_master" });
      return { results: tables, run: { success: true, meta: {} } };
    }

    if (sql.startsWith("SELECT COUNT(*) AS count FROM absences")) {
      return { results: [{ count: absences.size }], run: { success: true, meta: {} } };
    }
    if (sql.startsWith("SELECT COUNT(*) AS count FROM member_master")) {
      return { results: [{ count: memberMaster.size }], run: { success: true, meta: {} } };
    }
    if (sql.startsWith("SELECT id FROM absences WHERE end_date < ?")) {
      const today = String(p[0]);
      return {
        results: [...absences.values()].filter((row) => row.end_date < today).map((row) => ({ id: row.id })),
        run: { success: true, meta: {} }
      };
    }
    if (sql.startsWith("SELECT * FROM absences WHERE id = ?")) {
      const row = absences.get(String(p[0]));
      return { results: row ? [row] : [], run: { success: true, meta: {} } };
    }
    if (sql.includes("FROM absences WHERE target_user = ? AND end_date >= ?")) {
      const userId = String(p[0]);
      const today = String(p[1]);
      const results = [...absences.values()]
        .filter((row) => row.target_user === userId && row.end_date >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
      return { results, run: { success: true, meta: {} } };
    }
    if (sql.startsWith("SELECT * FROM absences WHERE start_date <= ? AND end_date >= ?")) {
      const today = String(p[0]);
      const results = [...absences.values()]
        .filter((row) => row.start_date <= today && row.end_date >= today)
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
      return { results, run: { success: true, meta: {} } };
    }
    if (sql.startsWith("SELECT * FROM absences ORDER BY")) {
      const results = [...absences.values()].sort(
        (a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id)
      );
      return { results, run: { success: true, meta: {} } };
    }
    if (sql.startsWith("SELECT * FROM member_master WHERE target_user = ?")) {
      const row = memberMaster.get(String(p[0]));
      return { results: row ? [row] : [], run: { success: true, meta: {} } };
    }
    if (sql.startsWith("SELECT target_user, active FROM member_master")) {
      return { results: [...memberMaster.values()].map((row) => ({ target_user: row.target_user, active: row.active })), run: { success: true, meta: {} } };
    }

    if (sql.startsWith("INSERT INTO absences") || sql.startsWith("INSERT OR IGNORE INTO absences")) {
      const ignore = sql.includes("OR IGNORE");
      const id = String(p[0]);
      if (ignore && absences.has(id)) {
        return { results: [], run: { success: true, meta: { changes: 0 } } };
      }
      const row: AbsenceStore = {
        id,
        target_user: String(p[1]),
        start_date: String(p[2]),
        end_date: String(p[3]),
        absence_type: String(p[4]),
        notify_channels: String(p[5]),
        notify_users: String(p[6]),
        note: p[7] == null ? null : String(p[7]),
        created_at: String(p[8]),
        updated_at: String(p[9])
      };
      absences.set(id, row);
      return { results: [], run: { success: true, meta: { changes: 1 } } };
    }

    if (sql.startsWith("UPDATE absences SET")) {
      const id = String(p[8]);
      const existing = absences.get(id);
      if (!existing) return { results: [], run: { success: true, meta: { changes: 0 } } };
      absences.set(id, {
        id,
        target_user: String(p[0]),
        start_date: String(p[1]),
        end_date: String(p[2]),
        absence_type: String(p[3]),
        notify_channels: String(p[4]),
        notify_users: String(p[5]),
        note: p[6] == null ? null : String(p[6]),
        created_at: existing.created_at,
        updated_at: String(p[7])
      });
      return { results: [], run: { success: true, meta: { changes: 1 } } };
    }

    if (sql.startsWith("DELETE FROM absences WHERE id = ?")) {
      const deleted = absences.delete(String(p[0]));
      return { results: [], run: { success: true, meta: { changes: deleted ? 1 : 0 } } };
    }

    if (sql.startsWith("INSERT INTO member_master") || sql.startsWith("INSERT OR IGNORE INTO member_master")) {
      const ignore = sql.includes("OR IGNORE");
      const targetUser = String(p[0]);
      if (ignore && memberMaster.has(targetUser)) {
        return { results: [], run: { success: true, meta: { changes: 0 } } };
      }
      memberMaster.set(targetUser, {
        target_user: targetUser,
        active: Number(p[1]),
        default_notify_channels: String(p[2]),
        default_notify_users: String(p[3]),
        default_registration_notify: String(p[4]),
        updated_at: String(p[5])
      });
      return { results: [], run: { success: true, meta: { changes: 1 } } };
    }

    if (sql.includes("ON CONFLICT(target_user) DO UPDATE SET")) {
      const targetUser = String(p[0]);
      memberMaster.set(targetUser, {
        target_user: targetUser,
        active: Number(p[1]),
        default_notify_channels: String(p[2]),
        default_notify_users: String(p[3]),
        default_registration_notify: String(p[4]),
        updated_at: String(p[5])
      });
      return { results: [], run: { success: true, meta: { changes: 1 } } };
    }

    throw new Error(`mock-d1 unsupported sql: ${sql}`);
  };

  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const statement: BoundStatement = { sql, params: [] };
    const bound = {
      bind: (...args: unknown[]) => {
        params = args;
        statement.params = args;
        return bound;
      },
      all: async <T>() => {
        const { results } = execute(statement);
        return { results: results as T[], success: true, meta: {} };
      },
      first: async <T>() => {
        const { results } = execute(statement);
        return (results[0] as T | undefined) ?? null;
      },
      run: async () => {
        const { run } = execute(statement);
        return run;
      }
    };
    return bound;
  };

  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => {
      const results = [];
      for (const stmt of statements) {
        const bound = stmt as unknown as { __mock?: BoundStatement };
        if (bound.__mock) {
          results.push(execute(bound.__mock).run);
        } else {
          results.push(await stmt.run());
        }
      }
      return results;
    },
    exec: async () => ({ count: 0, duration: 0 })
  } as unknown as D1Database;
};

export const createMockPreparedStatement = (sql: string, params: unknown[]): D1PreparedStatement => {
  const statement = { sql, params };
  const bound = {
    __mock: statement,
    bind: (...args: unknown[]) => createMockPreparedStatement(sql, args),
    run: async () => {
      const db = createMockD1();
      return db.prepare(sql).bind(...params).run();
    },
    all: async () => createMockD1().prepare(sql).bind(...params).all(),
    first: async () => createMockD1().prepare(sql).bind(...params).first()
  };
  return bound as unknown as D1PreparedStatement;
};
