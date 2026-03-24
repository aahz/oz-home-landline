import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
	AccessLevel,
	IGate,
	IGroup,
	ILandlineDatabaseParameters,
	IModemSerialFailureRecordResult,
	IModemSerialTransportState,
	ISeedParameters,
	IUpsertGateInput,
	IUpsertGroupInput,
	IUpsertUserInput,
	IUser,
	IUserRow,
} from './types';
import {createTables, migrateGroupsModel, migrateUsersTable, seedDefaultGroups, seedModemTransportState} from './migrations';
import {ensureGroupsExist, normalizeGroupIds, parseGatesRaw} from './utils';

export default class LandlineDatabase {
	private readonly _db: Database.Database;
	private static readonly DEFAULT_GATE_GROUP_ID = 'default';
	private static readonly MODEM_SERIAL_FAILURE_THRESHOLD = 10;
	private static readonly MODEM_SERIAL_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

	public constructor(parameters: ILandlineDatabaseParameters) {
		const directoryPath = path.dirname(parameters.path);

		fs.mkdirSync(directoryPath, {recursive: true});

		this._db = new Database(parameters.path);
		this._db.pragma('foreign_keys = ON');
	}

	public initialize(seed: ISeedParameters): void {
		createTables(this._db);
		migrateUsersTable(this._db);
		migrateGroupsModel(this._db);
		seedDefaultGroups(this._db);
		seedModemTransportState(this._db);
		this._seedAdmin(seed.adminUserId);
		this._seedGates(seed.gatesRawList);
	}

	public getModemSerialTransportState(now: Date = new Date()): IModemSerialTransportState {
		this._ensureModemTransportStateRow();

		const row = this._db
			.prepare(`
				SELECT
					failure_count AS failureCount,
					window_start_at AS windowStartAt,
					fallback_primary_since AS fallbackPrimarySince
				FROM modem_transport_state
				WHERE id = 1
				LIMIT 1
			`)
			.get() as {failureCount: number; windowStartAt: string | null; fallbackPrimarySince: string | null};

		const state = this._mapModemTransportStateRow(row);
		const shouldResetByWindow = !!state.windowStartAt
			&& (now.getTime() - state.windowStartAt.getTime()) > LandlineDatabase.MODEM_SERIAL_FAILURE_WINDOW_MS;
		const shouldResetByFallbackWindow = !!state.fallbackPrimarySince
			&& (now.getTime() - state.fallbackPrimarySince.getTime()) > LandlineDatabase.MODEM_SERIAL_FAILURE_WINDOW_MS;

		if (!shouldResetByWindow && !shouldResetByFallbackWindow) {
			return state;
		}

		this.resetModemSerialFailures();

		return {
			failureCount: 0,
		};
	}

	public recordModemSerialFailure(now: Date = new Date()): IModemSerialFailureRecordResult {
		const state = this.getModemSerialTransportState(now);
		const shouldStartNewWindow = !state.windowStartAt
			|| (now.getTime() - state.windowStartAt.getTime()) > LandlineDatabase.MODEM_SERIAL_FAILURE_WINDOW_MS;

		const nextFailureCount = shouldStartNewWindow
			? 1
			: state.failureCount + 1;
		const nextWindowStartAt = shouldStartNewWindow
			? now
			: (state.windowStartAt as Date);
		let nextFallbackPrimarySince = state.fallbackPrimarySince;
		let isPromoted = false;

		if (
			nextFailureCount >= LandlineDatabase.MODEM_SERIAL_FAILURE_THRESHOLD
			&& !nextFallbackPrimarySince
		) {
			nextFallbackPrimarySince = now;
			isPromoted = true;
		}

		this._db
			.prepare(`
				UPDATE modem_transport_state
				SET
					failure_count = @failureCount,
					window_start_at = @windowStartAt,
					fallback_primary_since = @fallbackPrimarySince,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = 1
			`)
			.run({
				failureCount: nextFailureCount,
				windowStartAt: nextWindowStartAt.toISOString(),
				fallbackPrimarySince: nextFallbackPrimarySince?.toISOString() || null,
			});

		return {
			state: {
				failureCount: nextFailureCount,
				windowStartAt: nextWindowStartAt,
				fallbackPrimarySince: nextFallbackPrimarySince,
			},
			isPromoted,
		};
	}

	public resetModemSerialFailures(): void {
		this._ensureModemTransportStateRow();

		this._db
			.prepare(`
				UPDATE modem_transport_state
				SET
					failure_count = 0,
					window_start_at = NULL,
					fallback_primary_since = NULL,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = 1
			`)
			.run();
	}

	public hasUser(telegramId: number): boolean {
		const result = this._db
			.prepare('SELECT 1 FROM users WHERE telegram_id = ? LIMIT 1')
			.get(telegramId);

		return !!result;
	}

	public isAdmin(telegramId: number): boolean {
		const result = this._db
			.prepare("SELECT 1 FROM users WHERE telegram_id = ? AND access_level = 'admin' LIMIT 1")
			.get(telegramId);

		return !!result;
	}

	public getAdmins(): IUser[] {
		const rows = this._db
			.prepare(`
				SELECT
					id AS id,
					telegram_id AS telegramId,
					name AS name,
					access_level AS accessLevel,
					is_notifications AS isNotifications
				FROM users
				WHERE access_level = 'admin'
				ORDER BY id ASC
			`)
			.all() as IUserRow[];

		return rows.map((row) => this._mapUserRow(row));
	}

	public getNotifiableAdmins(): IUser[] {
		const rows = this._db
			.prepare(`
				SELECT
					id AS id,
					telegram_id AS telegramId,
					name AS name,
					access_level AS accessLevel,
					is_notifications AS isNotifications
				FROM users
				WHERE access_level = 'admin' AND is_notifications = 1
				ORDER BY id ASC
			`)
			.all() as IUserRow[];

		return rows.map((row) => this._mapUserRow(row));
	}

	public listUsers(): IUser[] {
		const rows = this._db
			.prepare(`
				SELECT
					id AS id,
					telegram_id AS telegramId,
					name AS name,
					access_level AS accessLevel,
					is_notifications AS isNotifications
				FROM users
				ORDER BY id ASC
			`)
			.all() as IUserRow[];

		return rows.map((row) => this._mapUserRow(row));
	}

	public getUserByTelegramId(telegramId: number): IUser | undefined {
		const row = this._db
			.prepare(`
				SELECT
					id AS id,
					telegram_id AS telegramId,
					name AS name,
					access_level AS accessLevel,
					is_notifications AS isNotifications
				FROM users
				WHERE telegram_id = ?
				LIMIT 1
			`)
			.get(telegramId) as IUserRow | undefined;

		return row ? this._mapUserRow(row) : undefined;
	}

	public listGroups(): IGroup[] {
		return this._db
			.prepare(`
				SELECT
					id AS id,
					name AS name
				FROM groups
				ORDER BY CASE WHEN id = '*' THEN 0 ELSE 1 END, name ASC
			`)
			.all() as IGroup[];
	}

	public getGroupById(groupId: string): IGroup | undefined {
		return this._db
			.prepare(`
				SELECT
					id AS id,
					name AS name
				FROM groups
				WHERE id = ?
				LIMIT 1
			`)
			.get(groupId) as IGroup | undefined;
	}

	public addGroup(input: IUpsertGroupInput): void {
		this._db
			.prepare(`
				INSERT INTO groups (id, name)
				VALUES (@id, @name)
			`)
			.run({
				id: input.id,
				name: input.name,
			});
	}

	public updateGroup(input: IUpsertGroupInput): void {
		const result = this._db
			.prepare(`
				UPDATE groups
				SET name = @name
				WHERE id = @id
			`)
			.run({
				id: input.id,
				name: input.name,
			});

		if (result.changes < 1) {
			throw new Error(`Group ${input.id} is not found`);
		}
	}

	public deleteGroup(groupId: string): void {
		if (groupId === '*') {
			throw new Error('Group "*" cannot be deleted');
		}

		const group = this.getGroupById(groupId);

		if (!group) {
			throw new Error(`Group ${groupId} is not found`);
		}

		const deleteUserGroups = this._db.prepare('DELETE FROM user_groups WHERE group_id = ?');
		const resetGates = this._db.prepare("UPDATE gates SET group_id = ? WHERE group_id = ?");
		const deleteGroup = this._db.prepare('DELETE FROM groups WHERE id = ?');

		this._db.transaction(() => {
			deleteUserGroups.run(groupId);
			resetGates.run(LandlineDatabase.DEFAULT_GATE_GROUP_ID, groupId);
			deleteGroup.run(groupId);
		})();
	}

	public listGates(): IGate[] {
		const rows = this._db
			.prepare(`
				SELECT
					g.gate_key AS id,
					g.title AS title,
					g.group_id AS groupId,
					gr.name AS groupName,
					p.phone_number AS phoneNumber,
					p.position AS position
				FROM gates g
				LEFT JOIN groups gr ON gr.id = g.group_id
				LEFT JOIN gate_phone_numbers p ON p.gate_id = g.id
				ORDER BY g.id ASC, p.position ASC
			`)
			.all() as {id: string; title: string; groupId: string; groupName: string | null; phoneNumber: string | null; position: number | null}[];

		return rows.reduce((result, row) => {
			const existingGate = result.find((gate) => gate.id === row.id);
			const group = {
				id: row.groupId || '*',
				name: row.groupName || 'All groups',
			};

			if (!existingGate) {
				result.push({
					id: row.id,
					title: row.title,
					group,
					phoneNumbers: row.phoneNumber ? [row.phoneNumber] : [],
				});

				return result;
			}

			if (!!row.phoneNumber) {
				existingGate.phoneNumbers.push(row.phoneNumber);
			}

			return result;
		}, [] as IGate[]);
	}

	public getGateById(gateId: string): IGate | undefined {
		return this.listGates().find((gate) => gate.id === gateId);
	}

	public addUser(input: IUpsertUserInput): void {
		const insertUser = this._db.prepare(`
			INSERT INTO users (telegram_id, name, group_name, access_level, is_notifications)
			VALUES (@telegramId, @name, @legacyGroupName, @accessLevel, @isNotifications)
		`);

		const insertUserGroup = this._db.prepare(`
			INSERT INTO user_groups (user_id, group_id)
			VALUES (@userId, @groupId)
		`);

		this._db.transaction(() => {
			ensureGroupsExist(this._db, input.groupIds);

			const insertResult = insertUser.run({
				telegramId: input.telegramId,
				name: input.name,
				legacyGroupName: input.groupIds.join(','),
				accessLevel: input.accessLevel,
				isNotifications: input.isNotifications ? 1 : 0,
			});

			normalizeGroupIds(input.groupIds).forEach((groupId) => {
				insertUserGroup.run({
					userId: insertResult.lastInsertRowid,
					groupId,
				});
			});
		})();
	}

	public updateUser(input: IUpsertUserInput): void {
		const user = this._db
			.prepare('SELECT id FROM users WHERE telegram_id = ? LIMIT 1')
			.get(input.telegramId) as {id: number} | undefined;

		if (!user) {
			throw new Error(`User ${input.telegramId} is not found`);
		}

		const updateUser = this._db.prepare(`
			UPDATE users
			SET
				name = @name,
				group_name = @legacyGroupName,
				access_level = @accessLevel,
				is_notifications = @isNotifications
			WHERE telegram_id = @telegramId
		`);

		const deleteUserGroups = this._db.prepare('DELETE FROM user_groups WHERE user_id = ?');
		const insertUserGroup = this._db.prepare(`
			INSERT INTO user_groups (user_id, group_id)
			VALUES (@userId, @groupId)
		`);

		this._db.transaction(() => {
			ensureGroupsExist(this._db, input.groupIds);

			updateUser.run({
				telegramId: input.telegramId,
				name: input.name,
				legacyGroupName: input.groupIds.join(','),
				accessLevel: input.accessLevel,
				isNotifications: input.isNotifications ? 1 : 0,
			});

			deleteUserGroups.run(user.id);

			normalizeGroupIds(input.groupIds).forEach((groupId) => {
				insertUserGroup.run({
					userId: user.id,
					groupId,
				});
			});
		})();
	}

	public deleteUser(telegramId: number): void {
		const result = this._db
			.prepare('DELETE FROM users WHERE telegram_id = ?')
			.run(telegramId);

		if (result.changes < 1) {
			throw new Error(`User ${telegramId} is not found`);
		}
	}

	public addGate(input: IUpsertGateInput): void {
		this._assertGateGroupId(input.groupId);
		ensureGroupsExist(this._db, [input.groupId]);

		const insertGate = this._db.prepare(`
			INSERT INTO gates (gate_key, title, group_name, group_id)
			VALUES (@id, @title, @legacyGroupName, @groupId)
		`);

		const insertPhoneNumber = this._db.prepare(`
			INSERT INTO gate_phone_numbers (gate_id, phone_number, position)
			VALUES (@gateId, @phoneNumber, @position)
		`);

		this._db.transaction(() => {
			const insertResult = insertGate.run({
				id: input.id,
				title: input.title,
				legacyGroupName: input.groupId,
				groupId: input.groupId,
			});

			input.phoneNumbers.forEach((phoneNumber, index) => {
				insertPhoneNumber.run({
					gateId: insertResult.lastInsertRowid,
					phoneNumber,
					position: index,
				});
			});
		})();
	}

	public updateGate(input: IUpsertGateInput): void {
		this._assertGateGroupId(input.groupId);
		ensureGroupsExist(this._db, [input.groupId]);

		const updateGate = this._db.prepare(`
			UPDATE gates
			SET title = @title, group_name = @legacyGroupName, group_id = @groupId
			WHERE gate_key = @id
		`);

		const gate = this._db
			.prepare('SELECT id FROM gates WHERE gate_key = ? LIMIT 1')
			.get(input.id) as {id: number} | undefined;

		if (!gate) {
			throw new Error(`Gate ${input.id} is not found`);
		}

		const deletePhoneNumbers = this._db.prepare('DELETE FROM gate_phone_numbers WHERE gate_id = ?');
		const insertPhoneNumber = this._db.prepare(`
			INSERT INTO gate_phone_numbers (gate_id, phone_number, position)
			VALUES (@gateId, @phoneNumber, @position)
		`);

		this._db.transaction(() => {
			updateGate.run({
				id: input.id,
				title: input.title,
				legacyGroupName: input.groupId,
				groupId: input.groupId,
			});

			deletePhoneNumbers.run(gate.id);

			input.phoneNumbers.forEach((phoneNumber, index) => {
				insertPhoneNumber.run({
					gateId: gate.id,
					phoneNumber,
					position: index,
				});
			});
		})();
	}

	public deleteGate(gateId: string): void {
		const result = this._db
			.prepare('DELETE FROM gates WHERE gate_key = ?')
			.run(gateId);

		if (result.changes < 1) {
			throw new Error(`Gate ${gateId} is not found`);
		}
	}

	private _seedAdmin(adminUserId?: number): void {
		if (!Number.isFinite(adminUserId)) {
			return;
		}

		const userExists = this.hasUser(adminUserId as number);

		if (userExists) {
			return;
		}

		this.addUser({
			telegramId: adminUserId as number,
			name: 'Administrator',
			groupIds: ['*'],
			accessLevel: 'admin',
			isNotifications: true,
		});
	}

	private _seedGates(gatesRawList: string): void {
		const gatesCount = this._db
			.prepare('SELECT COUNT(1) AS count FROM gates')
			.get() as {count: number};

		if (gatesCount.count > 0) {
			return;
		}

		const gates = parseGatesRaw(gatesRawList);

		if (gates.length === 0) {
			return;
		}

		gates.forEach((gate) => {
			const groupId = gate.groupId === '*'
				? LandlineDatabase.DEFAULT_GATE_GROUP_ID
				: gate.groupId;

			if (!this.getGroupById(groupId)) {
				this.addGroup({
					id: groupId,
					name: this._formatSeedGroupName(groupId),
				});
			}

			this.addGate({
				id: gate.id,
				title: gate.title,
				groupId: groupId,
				phoneNumbers: gate.phoneNumbers,
			});
		});
	}

	private _formatSeedGroupName(groupId: string): string {
		const normalized = String(groupId || '').trim();

		if (normalized === '*') {
			return 'All groups';
		}

		return normalized.length > 0
			? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
			: 'Unknown';
	}

	private _assertGateGroupId(groupId: string): void {
		if (String(groupId).trim() === '*') {
			throw new Error('Gate cannot be assigned to "*" group');
		}
	}

	private _mapUserRow(row: IUserRow): IUser {
		const groups = this._db
			.prepare(`
				SELECT
					g.id AS id,
					g.name AS name
				FROM user_groups ug
				INNER JOIN groups g ON g.id = ug.group_id
				WHERE ug.user_id = ?
				ORDER BY CASE WHEN g.id = '*' THEN 0 ELSE 1 END, g.name ASC
			`)
			.all(row.id) as IGroup[];

		return {
			telegramId: row.telegramId,
			name: row.name,
			accessLevel: row.accessLevel,
			isNotifications: Boolean(row.isNotifications),
			groups,
		};
	}

	private _ensureModemTransportStateRow(): void {
		seedModemTransportState(this._db);
	}

	private _mapModemTransportStateRow(row: {failureCount: number; windowStartAt: string | null; fallbackPrimarySince: string | null}): IModemSerialTransportState {
		return {
			failureCount: Number.isFinite(row.failureCount) ? row.failureCount : 0,
			windowStartAt: row.windowStartAt ? new Date(row.windowStartAt) : undefined,
			fallbackPrimarySince: row.fallbackPrimarySince ? new Date(row.fallbackPrimarySince) : undefined,
		};
	}
}
