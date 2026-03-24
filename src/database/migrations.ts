import Database from 'better-sqlite3';
import {AccessLevel} from './types';
import {ensureGroupsExist, normalizeGroupIds} from './utils';

export function createTables(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			telegram_id INTEGER NOT NULL UNIQUE,
			name TEXT NOT NULL,
			group_name TEXT NOT NULL,
			access_level TEXT NOT NULL CHECK (access_level IN ('admin', 'user')),
			is_notifications INTEGER NOT NULL DEFAULT 1 CHECK (is_notifications IN (0, 1)),
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS groups (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS gates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			gate_key TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			group_name TEXT NOT NULL,
			group_id TEXT NOT NULL DEFAULT '*',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT
		);

		CREATE TABLE IF NOT EXISTS gate_phone_numbers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			gate_id INTEGER NOT NULL,
			phone_number TEXT NOT NULL,
			position INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (gate_id, position),
			FOREIGN KEY (gate_id) REFERENCES gates(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS user_groups (
			user_id INTEGER NOT NULL,
			group_id TEXT NOT NULL,
			PRIMARY KEY (user_id, group_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS modem_transport_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			failure_count INTEGER NOT NULL DEFAULT 0,
			window_start_at TEXT NULL,
			fallback_primary_since TEXT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`);
}

export function migrateUsersTable(db: Database.Database): void {
	const columns = db
		.prepare('PRAGMA table_info(users)')
		.all() as {name: string}[];

	if (!columns.some((column) => column.name === 'is_notifications')) {
		db.exec(`
			ALTER TABLE users
			ADD COLUMN is_notifications INTEGER NOT NULL DEFAULT 1 CHECK (is_notifications IN (0, 1))
		`);
	}
}

export function seedDefaultGroups(db: Database.Database): void {
	db
		.prepare(`
			INSERT OR IGNORE INTO groups (id, name)
			VALUES ('*', 'All groups')
		`)
		.run();

	db
		.prepare(`
			INSERT OR IGNORE INTO groups (id, name)
			VALUES ('default', 'Default')
		`)
		.run();
}

export function seedModemTransportState(db: Database.Database): void {
	db
		.prepare(`
			INSERT OR IGNORE INTO modem_transport_state (
				id, failure_count, window_start_at, fallback_primary_since, updated_at
			) VALUES (1, 0, NULL, NULL, CURRENT_TIMESTAMP)
		`)
		.run();
}

export function migrateGroupsModel(db: Database.Database): void {
	const gateColumns = db
		.prepare('PRAGMA table_info(gates)')
		.all() as {name: string}[];

	if (!gateColumns.some((column) => column.name === 'group_id')) {
		db.exec(`
			ALTER TABLE gates
			ADD COLUMN group_id TEXT NOT NULL DEFAULT '*'
		`);
	}

	seedDefaultGroups(db);

	const legacyGateGroups = db
		.prepare(`SELECT DISTINCT TRIM(group_name) AS groupName FROM gates WHERE TRIM(group_name) != ''`)
		.all() as {groupName: string}[];

	legacyGateGroups.forEach(({groupName}) => {
		const groupId = groupName || '*';

		if (groupId === '*') {
			return;
		}

		db
			.prepare(`INSERT OR IGNORE INTO groups (id, name) VALUES (?, ?)`)
			.run(groupId, groupName);
	});

	db.exec(`
		UPDATE gates
		SET group_id = CASE
			WHEN TRIM(group_name) = '' OR TRIM(group_name) = '*' THEN 'default'
			ELSE TRIM(group_name)
		END
	`);

	const hasUserGroupsData = (db
		.prepare('SELECT COUNT(1) AS count FROM user_groups')
		.get() as {count: number}).count > 0;

	if (hasUserGroupsData) {
		return;
	}

	const users = db
		.prepare(`
			SELECT
				id AS id,
				group_name AS groupName,
				access_level AS accessLevel
			FROM users
		`)
		.all() as {id: number; groupName: string; accessLevel: AccessLevel}[];

	const insertUserGroup = db.prepare(`
		INSERT OR IGNORE INTO user_groups (user_id, group_id)
		VALUES (?, ?)
	`);

	db.transaction(() => {
		users.forEach((user) => {
			const legacyGroupIds = normalizeGroupIds(
				String(user.groupName || '')
					.split(',')
					.map((group) => group.trim())
					.filter((group) => group.length > 0)
			);

			if (user.accessLevel === 'admin') {
				insertUserGroup.run(user.id, '*');

				return;
			}

			if (!legacyGroupIds.length) {
				insertUserGroup.run(user.id, '*');

				return;
			}

			ensureGroupsExist(db, legacyGroupIds);

			legacyGroupIds.forEach((groupId) => {
				insertUserGroup.run(user.id, groupId);
			});
		});
	})();
}
