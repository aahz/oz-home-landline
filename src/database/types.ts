export type AccessLevel = 'admin' | 'user';

export interface IGroup {
	id: string;
	name: string;
}

export interface IUser {
	telegramId: number;
	name: string;
	accessLevel: AccessLevel;
	isNotifications: boolean;
	groups: IGroup[];
}

export interface IGate {
	id: string;
	title: string;
	group: IGroup;
	phoneNumbers: string[];
}

export interface IParsedGate {
	id: string;
	title: string;
	groupId: string;
	phoneNumbers: string[];
}

export interface ILandlineDatabaseParameters {
	path: string;
}

export interface ISeedParameters {
	adminUserId?: number;
	gatesRawList: string;
}

export interface IUpsertUserInput {
	telegramId: number;
	name: string;
	groupIds: string[];
	accessLevel: AccessLevel;
	isNotifications: boolean;
}

export interface IUpsertGateInput {
	id: string;
	title: string;
	groupId: string;
	phoneNumbers: string[];
}

export interface IUpsertGroupInput {
	id: string;
	name: string;
}

export interface IUserRow {
	id: number;
	telegramId: number;
	name: string;
	accessLevel: AccessLevel;
	isNotifications: number;
}

export interface IModemSerialTransportState {
	failureCount: number;
	windowStartAt?: Date;
	fallbackPrimarySince?: Date;
}

export interface IModemSerialFailureRecordResult {
	state: IModemSerialTransportState;
	isPromoted: boolean;
}
