import Database from 'better-sqlite3';
import {IParsedGate} from './types';

export function normalizeGroupIds(groupIds: string[]): string[] {
	const normalized = Array.from(
		new Set(
			groupIds
				.map((groupId) => String(groupId).trim())
				.filter((groupId) => groupId.length > 0)
		)
	);

	return normalized.length > 0 ? normalized : ['*'];
}

export function ensureGroupsExist(db: Database.Database, groupIds: string[]): void {
	const insert = db.prepare(`
		INSERT OR IGNORE INTO groups (id, name)
		VALUES (@id, @name)
	`);

	normalizeGroupIds(groupIds).forEach((groupId) => {
		insert.run({
			id: groupId,
			name: groupId === '*' ? 'All groups' : groupId,
		});
	});
}

export function parseGatesRaw(raw: string): IParsedGate[] {
	return String(raw)
		.split(';')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.split(',').map((value) => value.trim()).filter((value) => value.length > 0))
		.map((parts) => {
			const id = parts[0] || '';
			const title = parts[1] || '';
			const thirdValue = parts[2] || '';
			const isOldFormat = (/^[+0-9*#]/).test(thirdValue);

			if (isOldFormat) {
				return {
					id,
					title,
					groupId: '*',
					phoneNumbers: parts.slice(2),
				};
			}

			return {
				id,
				title,
				groupId: thirdValue || 'unknown',
				phoneNumbers: parts.slice(3),
			};
		})
		.filter((gate) => gate.id.length > 0 && gate.title.length > 0 && gate.phoneNumbers.length > 0);
}
